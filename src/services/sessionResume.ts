import { getSetting, setSetting } from '../db/database'
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
 * 同一套题的顺序/随机/错题共用一条记录，不同试卷各存一条、互不覆盖。
 * 形如 `japanese2|g21,g22,…|`（2024 真题整套）、`history|t0|`（某个刷题单）、`history|all|`（整科）。
 */
export function buildPaperKey(parts: {
  category?: string
  groups?: string
  group?: string
  tag?: string
}): string {
  const set = parts.groups || parts.group || WHOLE_CATEGORY
  return [parts.category || '', set, parts.tag || ''].join('|')
}

/** 从入口签名（category|mode|group|groups|tag|ids|shuffle）还原出试卷标识 */
export function paperKeyFromEntryKey(entryKey: string): string {
  const [category, , group, groups, tag] = entryKey.split('|')
  return buildPaperKey({ category, group, groups, tag })
}

/** 取一条会话所属的试卷标识：新记录直接用 paperKey，旧记录用 entryKey 兜底 */
export function paperKeyOf(session: ActiveSession): string {
  if (session.paperKey) return session.paperKey
  return session.entryKey ? paperKeyFromEntryKey(session.entryKey) : ''
}

function startedAtMs(session: ActiveSession): number {
  const ms = new Date(session.startedAt).getTime()
  return Number.isNaN(ms) ? 0 : ms
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
    if (category !== scope.category) continue
    if (allowed) {
      // 选了子题库就不展示整个学科的记录（那是「刷整套」之外的入口）
      if (set === WHOLE_CATEGORY) continue
      if (!set.split(',').every((groupId) => allowed.has(groupId))) continue
    }
    if (!best || startedAtMs(session) > startedAtMs(best.session)) best = { key, session }
  }

  return best
}

/** 读取全部会话记录；首次读取时把旧版单条记录迁移到对应试卷下 */
export async function loadActiveSessions(): Promise<ActiveSessionMap> {
  const stored = await getSetting(KEY, {} as ActiveSessionMap)
  const usable =
    stored && typeof stored === 'object' && !('sessionId' in stored) ? { ...stored } : {}

  if (Object.keys(usable).length > 0) return usable

  const legacy = await getSetting(LEGACY_KEY, null as ActiveSession | null)
  if (!legacy) return usable

  const key = paperKeyOf(legacy)
  if (!key) return usable

  const migrated: ActiveSessionMap = { [key]: { ...legacy, paperKey: key } }
  await setSetting(KEY, migrated)
  await setSetting(LEGACY_KEY, null)
  return migrated
}

export async function saveActiveSessions(map: ActiveSessionMap): Promise<void> {
  await setSetting(KEY, map)
}

/** 保存一条会话：按它自己的试卷标识落位，不会影响其它试卷的记录 */
export async function saveActiveSession(session: ActiveSession): Promise<void> {
  const key = paperKeyOf(session)
  if (!key) return
  const map = await loadActiveSessions()
  map[key] = { ...session, paperKey: key }
  await saveActiveSessions(map)
}

/** 读取指定试卷的记录 */
export async function loadActiveSession(paperKey: string): Promise<ActiveSession | null> {
  const map = await loadActiveSessions()
  return map[paperKey] ?? null
}

/** 清掉指定试卷的记录（只影响这一份试卷；清空全部请用 clearAllData） */
export async function clearActiveSession(paperKey: string): Promise<void> {
  const map = await loadActiveSessions()
  if (!(paperKey in map)) return
  delete map[paperKey]
  await saveActiveSessions(map)
}

/** 丢掉已经答完 / 过期的记录，返回剩余的记录表（有变化才会写回） */
export async function pruneInactiveSessions(): Promise<ActiveSessionMap> {
  const map = await loadActiveSessions()
  const kept: ActiveSessionMap = {}
  for (const [key, session] of Object.entries(map)) {
    if (isSessionInProgress(session)) kept[key] = session
  }
  if (Object.keys(kept).length !== Object.keys(map).length) await saveActiveSessions(kept)
  return kept
}

export function isSessionInProgress(s: ActiveSession | null): s is ActiveSession {
  if (!s) return false
  if (!s.questionIds || s.questionIds.length === 0) return false

  // 检查会话是否过期
  const sessionAge = Date.now() - new Date(s.startedAt).getTime()
  if (sessionAge > SESSION.MAX_AGE_MS) return false

  const nextIndex = s.submitted ? s.currentIndex + 1 : s.currentIndex
  return nextIndex < s.totalQuestions
}
