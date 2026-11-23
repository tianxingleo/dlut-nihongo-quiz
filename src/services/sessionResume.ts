import { db, getSetting, setSetting } from '../db/database'
import { STORAGE_KEYS, SESSION } from '../constants'
import type { ActiveSession } from '../types/question'

export type { ActiveSession }

/** paperKey → 未完成的会话记录 */
export type ActiveSessionMap = Record<string, ActiveSession>

/** 试卷标识里代表「整个学科」的那一段 */
const WHOLE_CATEGORY = 'all'

const LEGACY_KEY = STORAGE_KEYS.ACTIVE_SESSION
const KEY = STORAGE_KEYS.ACTIVE_SESSIONS

/**
 * 试卷（题集）标识：学科 + 子题库/题单 + 标签，**不含练习方式** ——
 * 同一套题的顺序与随机练习共用一条记录，不同试卷各存一条、互不覆盖。
 * 形如 `japanese2|g21,g22,…|`（2024 真题整套）、`history|t0|`（某个刷题单）、`history|all|`（整科）。
 */
export function buildPaperKey(parts: {
  category?: string
  groups?: string
  group?: string
  tag?: string
  questionType?: string
  ids?: string
  source?: string
}): string {
  const normalize = (value: string) =>
    [...new Set(value.split(',').filter(Boolean))].sort().join(',')
  const category = parts.category || ''
  if (parts.ids) {
    if (parts.source === 'single' || (!parts.source && !parts.ids.includes(','))) return ''
    return [category, 'review', parts.source || 'legacy', normalize(parts.ids)].join('|')
  }
  const set = normalize(parts.groups || parts.group || WHOLE_CATEGORY)
  return [category, set, parts.tag || '', ...(parts.questionType ? [parts.questionType] : [])].join(
    '|',
  )
}

/** 从入口签名（category|mode|group|groups|tag|ids|shuffle）还原出试卷标识 */
export function paperKeyFromEntryKey(entryKey: string): string {
  const [category, , group, groups, tag, ids, , questionType, source] = entryKey.split('|')
  return buildPaperKey({ category, group, groups, tag, ids, questionType, source })
}

/** 取一条会话所属的试卷标识：新记录直接用 paperKey，旧记录用 entryKey 兜底 */
export function paperKeyOf(session: ActiveSession): string {
  if (session.entryKey) {
    const parts = session.entryKey.split('|')
    if (parts[5]) {
      if (session.wrongRedo && !parts[8]) parts[8] = 'wrong-redo'
      return paperKeyFromEntryKey(parts.join('|'))
    }
  }
  if (session.paperKey) return session.paperKey
  return session.entryKey ? paperKeyFromEntryKey(session.entryKey) : ''
}

export function sessionActivityMs(session: ActiveSession): number {
  return Date.parse(session.lastActivityAt || '') || Date.parse(session.startedAt) || 0
}

/**
 * 挑出「当前正在看的这套题」该展示的记录：同学科，且（选了子题库时）属于该子题库的题组范围，
 * 在未完成的记录里取最近开始的一条。返回 null 表示这套题没有可续的记录。
 */
export function pickSessionForScope(
  map: ActiveSessionMap,
  scope: { category: string; groups?: string[] | null },
): { key: string; session: ActiveSession } | null {
  const allowed = scope.groups && scope.groups.length ? new Set(scope.groups) : null
  let best: { key: string; session: ActiveSession } | null = null

  for (const [key, session] of Object.entries(map)) {
    if (!isSessionInProgress(session)) continue
    const [category = '', set = ''] = key.split('|')
    if (category !== scope.category || set === 'review') continue
    if (allowed) {
      // 选了子题库就不展示整个学科的记录（那是「刷整套」之外的入口）
      if (set === WHOLE_CATEGORY) continue
      if (!set.split(',').every((groupId) => allowed.has(groupId))) continue
    }
    if (!best || sessionActivityMs(session) > sessionActivityMs(best.session))
      best = { key, session }
  }

  return best
}

/** 读取全部会话记录；首次读取时把旧版单条记录迁移到对应试卷下 */
export async function loadActiveSessions(): Promise<ActiveSessionMap> {
  return db.transaction('rw', db.settings, readSessions)
}

async function readSessions(): Promise<ActiveSessionMap> {
  const stored = await getSetting(KEY, {} as ActiveSessionMap)
  const legacy = await getSetting(LEGACY_KEY, null as ActiveSession | null)
  const entries =
    stored && 'sessionId' in stored
      ? [stored as unknown as ActiveSession]
      : Object.values(stored || {})
  if (legacy) entries.push(legacy)
  const map: ActiveSessionMap = {}
  for (const session of entries) {
    if (!session?.questionIds) continue
    const key = paperKeyOf(session)
    if (key && (!map[key] || sessionActivityMs(session) >= sessionActivityMs(map[key]))) {
      map[key] = { ...session, paperKey: key }
    }
  }
  if (
    legacy ||
    Object.keys(stored || {}).some((key) => stored[key]?.paperKey !== key || !map[key])
  ) {
    await setSetting(KEY, map)
    if (legacy) await setSetting(LEGACY_KEY, null)
  }
  return map
}

export async function saveActiveSessions(map: ActiveSessionMap): Promise<void> {
  await setSetting(KEY, map)
}

export async function saveActiveSession(session: ActiveSession): Promise<void> {
  const key = paperKeyOf(session)
  if (!key) return
  await db.transaction('rw', db.settings, async () => {
    const map = await readSessions()
    map[key] = { ...session, paperKey: key }
    await saveActiveSessions(map)
  })
}

export async function loadActiveSession(paperKey: string): Promise<ActiveSession | null> {
  if (!paperKey) return null
  return (await loadActiveSessions())[paperKey] ?? null
}

export async function clearActiveSession(paperKey: string): Promise<void> {
  if (!paperKey) return
  await db.transaction('rw', db.settings, async () => {
    const map = await readSessions()
    if (!(paperKey in map)) return
    delete map[paperKey]
    await saveActiveSessions(map)
  })
}

export async function pruneInactiveSessions(): Promise<ActiveSessionMap> {
  return db.transaction('rw', db.settings, async () => {
    const map = await readSessions()
    const kept = Object.fromEntries(
      Object.entries(map).filter(([, session]) => isSessionInProgress(session)),
    )
    if (Object.keys(kept).length !== Object.keys(map).length) await saveActiveSessions(kept)
    return kept
  })
}

export function isSessionInProgress(s: ActiveSession | null): s is ActiveSession {
  if (!s) return false
  if (!s.questionIds || s.questionIds.length === 0) return false

  // 检查会话是否过期
  const sessionAge = Date.now() - new Date(s.startedAt).getTime()
  if (!Number.isFinite(sessionAge) || sessionAge > SESSION.MAX_AGE_MS) return false

  const nextIndex = s.submitted ? s.currentIndex + 1 : s.currentIndex
  return nextIndex < s.totalQuestions
}
