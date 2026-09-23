import Dexie, { type Table } from 'dexie'
import { INTERVAL_DAYS } from '../constants'
import type { Attempt, QuestionStats, TagStats, Session } from '../types/question'
import type { SettingsMap, SettingsKey } from '../types/settings'

export function createDefaultStats(
  questionId: string,
  overrides: Partial<QuestionStats> = {},
): QuestionStats {
  return {
    questionId,
    attemptCount: 0,
    correctCount: 0,
    wrongCount: 0,
    lastSelectedKey: '',
    lastCorrect: false,
    lastAttemptAt: '',
    masteryLevel: 0,
    reviewDueAt: '',
    isBookmarked: false,
    ...overrides,
  }
}

export class QuizDatabase extends Dexie {
  attempts!: Table<Attempt, number>
  questionStats!: Table<QuestionStats>
  tagStats!: Table<TagStats>
  sessions!: Table<Session, number>
  settings!: Table<{ key: string; value: string }, string>

  constructor() {
    super('JapaneseQuizDB')
    // Version 2: 基础表结构
    this.version(2).stores({
      attempts: '++id, questionId, sessionId, isCorrect, createdAt, mode',
      questionStats: 'questionId, masteryLevel, reviewDueAt, isBookmarked',
      tagStats: 'tag, correctCount, wrongCount',
      sessions: '++id, mode, startedAt',
      settings: 'key',
    })
    // Version 3: 为 attempts 添加 category 索引，优化按学科查询
    this.version(3)
      .stores({
        attempts: '++id, questionId, sessionId, isCorrect, createdAt, mode, category',
        questionStats: 'questionId, masteryLevel, reviewDueAt, isBookmarked',
        tagStats: 'tag, correctCount, wrongCount',
        sessions: '++id, mode, startedAt',
        settings: 'key',
      })
      .upgrade(async (tx) => {
        // 为现有 attempts 记录添加 category 字段
        // 通过 questionId 前缀推断 category
        const attempts = tx.table('attempts')
        await attempts.toCollection().modify((attempt: any) => {
          if (!attempt.category) {
            // 根据 questionId 前缀推断 category
            const id = attempt.questionId || ''
            if (id.startsWith('hist-') || id.startsWith('hist')) {
              attempt.category = 'history'
            } else if (id.startsWith('party-') || id.startsWith('party')) {
              attempt.category = 'party'
            } else if (id.startsWith('mil-') || id.startsWith('mil')) {
              attempt.category = 'military'
            } else {
              attempt.category = 'japanese2'
            }
          }
        })
      })
  }
}

export const db = new QuizDatabase()

// --- Settings helpers ---
export async function getSetting<K extends SettingsKey>(
  key: K,
  defaultValue: SettingsMap[K],
): Promise<SettingsMap[K]> {
  const entry = await db.settings.get(key as string)
  if (!entry) return defaultValue
  try {
    return JSON.parse(entry.value) as SettingsMap[K]
  } catch {
    console.warn(`设置项 ${key} 的值不是有效 JSON，已使用默认值`)
    return defaultValue
  }
}

export async function setSetting<K extends SettingsKey>(
  key: K,
  value: SettingsMap[K],
): Promise<void> {
  await db.settings.put({ key: key as string, value: JSON.stringify(value) })
}

// --- 每日统计 ---
export async function getDailyAttemptCount(date: Date = new Date()): Promise<number> {
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)
  const startStr = startOfDay.toISOString()

  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)
  const endStr = endOfDay.toISOString()

  // 使用 createdAt 索引范围查询，避免加载全表
  return db.attempts.where('createdAt').between(startStr, endStr, true, true).count()
}

// --- Attempt helpers ---

function calcReviewDueAt(lastAttemptAt: string, masteryLevel: number): string {
  if (!lastAttemptAt) return ''
  const days = INTERVAL_DAYS[masteryLevel] ?? 1
  return new Date(new Date(lastAttemptAt).getTime() + days * 86_400_000).toISOString()
}

export async function recordAttempt(
  a: Omit<Attempt, 'id'>,
  options?: { wrongRedo?: boolean },
): Promise<number> {
  return db.transaction('rw', db.attempts, db.questionStats, async () => {
    const id = await db.attempts.add(a as Attempt)
    // Update question stats
    const stat = await db.questionStats.get(a.questionId)
    if (stat) {
      let newMastery: number
      let newWrongCount: number
      if (options?.wrongRedo && a.isCorrect) {
        // 重做错题模式：答对时直接清零 wrongCount、提升 masteryLevel
        newWrongCount = 0
        newMastery = Math.max(3, Math.min(5, stat.masteryLevel + 1))
      } else {
        newMastery = a.isCorrect
          ? Math.min(5, stat.masteryLevel < 1 ? 2 : stat.masteryLevel + 1)
          : 1
        newWrongCount = stat.wrongCount + (a.isCorrect ? 0 : 1)
      }
      await db.questionStats.update(a.questionId, {
        attemptCount: stat.attemptCount + 1,
        correctCount: stat.correctCount + (a.isCorrect ? 1 : 0),
        wrongCount: newWrongCount,
        lastSelectedKey: a.selectedKey,
        lastCorrect: a.isCorrect,
        lastAttemptAt: a.createdAt,
        masteryLevel: newMastery,
        reviewDueAt: calcReviewDueAt(a.createdAt, newMastery),
      })
    } else {
      const initialMastery = a.isCorrect ? (options?.wrongRedo ? 3 : 2) : 1
      await db.questionStats.put(
        createDefaultStats(a.questionId, {
          attemptCount: 1,
          correctCount: a.isCorrect ? 1 : 0,
          wrongCount: a.isCorrect ? 0 : 1,
          lastSelectedKey: a.selectedKey,
          lastCorrect: a.isCorrect,
          lastAttemptAt: a.createdAt,
          masteryLevel: initialMastery,
          reviewDueAt: calcReviewDueAt(a.createdAt, initialMastery),
        }),
      )
    }
    return id
  })
}

export function createSession(input: Omit<Session, 'id'>): Session {
  return { ...input }
}

// --- Tag stats ---
// 把整批 tag 的读改写包进单个事务：每题 3-5 个 tag 不再触发 3-5 个隐式事务。
export async function updateTagStats(tags: string[], isCorrect: boolean): Promise<void> {
  if (tags.length === 0) return
  await db.transaction('rw', db.tagStats, async () => {
    const existing = await db.tagStats.bulkGet(tags)
    const upserts = tags.map((tag, i) => {
      const cur = existing[i]
      if (cur) {
        return {
          tag,
          attemptCount: cur.attemptCount + 1,
          correctCount: cur.correctCount + (isCorrect ? 1 : 0),
          wrongCount: cur.wrongCount + (isCorrect ? 0 : 1),
        }
      }
      return {
        tag,
        attemptCount: 1,
        correctCount: isCorrect ? 1 : 0,
        wrongCount: isCorrect ? 0 : 1,
      }
    })
    await db.tagStats.bulkPut(upserts)
  })
}

// --- Export/Import ---
export async function exportData(): Promise<string> {
  // 使用 each() 流式迭代代替 toArray()，避免大量数据一次性加载到内存
  const parts: string[] = []
  const push = (s: string) => parts.push(s)

  push('{"version":2')
  push(`,"exportedAt":"${new Date().toISOString()}"`)

  // attempts 流式处理
  push(',"attempts":[')
  let first = true
  await db.attempts.each((item) => {
    push(first ? JSON.stringify(item) : ',' + JSON.stringify(item))
    first = false
  })
  push(']')

  // questionStats 流式处理
  push(',"questionStats":[')
  first = true
  await db.questionStats.each((item) => {
    push(first ? JSON.stringify(item) : ',' + JSON.stringify(item))
    first = false
  })
  push(']')

  // tagStats 流式处理
  push(',"tagStats":[')
  first = true
  await db.tagStats.each((item) => {
    push(first ? JSON.stringify(item) : ',' + JSON.stringify(item))
    first = false
  })
  push(']')

  // sessions 流式处理
  push(',"sessions":[')
  first = true
  await db.sessions.each((item) => {
    push(first ? JSON.stringify(item) : ',' + JSON.stringify(item))
    first = false
  })
  push(']')

  // settings 流式处理
  push(',"settings":[')
  first = true
  await db.settings.each((item) => {
    push(first ? JSON.stringify(item) : ',' + JSON.stringify(item))
    first = false
  })
  push(']')

  push('}')
  return parts.join('')
}

export async function importData(json: string, options: { merge?: boolean } = {}): Promise<void> {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('备份文件不是有效的 JSON')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('备份格式错误：根对象缺失')
  }
  const obj = data as Record<string, unknown>
  if (typeof obj.version !== 'number') {
    throw new Error('备份格式错误：缺少 version 字段')
  }
  // 已知表名 → 必须是数组（如果存在）。任何未知顶层字段直接忽略。
  const tableKeys = ['attempts', 'questionStats', 'tagStats', 'sessions', 'settings'] as const
  for (const k of tableKeys) {
    if (k in obj && !Array.isArray(obj[k])) {
      throw new Error(`备份格式错误：${k} 应为数组`)
    }
  }
  // ── 逐条记录形状校验 ──
  // 顶层是数组不代表数组元素是合法记录。不校验的实测后果（merge 路径）：
  //   attempts: [5] → 静默入库一条空记录（数据污染）
  //   attemptCount: "5" → existing.attemptCount + "5" = "105"（字符串拼接污染统计）
  //   settings 缺 key → 泄漏 Dexie 内部错误信息
  // 校验失败统一抛「备份格式错误」，fail-closed，不落任何脏数据。
  // 规则为最小完整性（关键字段类型），与 exportData 的输出完全兼容。
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  const allNumber = (rec: Record<string, unknown>, keys: string[]) =>
    keys.every((k) => typeof rec[k] === 'number')
  const recordChecks: Partial<Record<(typeof tableKeys)[number], (item: unknown) => boolean>> = {
    attempts: (it) => isRecord(it) && typeof it.questionId === 'string',
    questionStats: (it) =>
      isRecord(it) &&
      typeof it.questionId === 'string' &&
      allNumber(it, ['attemptCount', 'correctCount', 'wrongCount', 'masteryLevel']),
    tagStats: (it) =>
      isRecord(it) &&
      typeof it.tag === 'string' &&
      allNumber(it, ['attemptCount', 'correctCount', 'wrongCount']),
    sessions: (it) =>
      isRecord(it) && typeof it.mode === 'string' && typeof it.startedAt === 'string',
    settings: (it) => isRecord(it) && typeof it.key === 'string' && typeof it.value === 'string',
  }
  for (const k of tableKeys) {
    const arr = obj[k]
    const check = recordChecks[k]
    if (Array.isArray(arr) && check) {
      arr.forEach((item, i) => {
        if (!check(item)) {
          throw new Error(`备份格式错误：${k} 第 ${i + 1} 条记录缺失关键字段或类型不符`)
        }
      })
    }
  }

  // 先创建当前数据的备份，防止导入中途失败导致数据丢失
  let backupJson: string | null = null
  try {
    backupJson = await exportData()
  } catch {
    // 备份创建失败不阻止导入，但记录警告
    console.warn('导入前备份创建失败，继续导入')
  }

  try {
    if (options.merge) {
      await doMergeImport(obj)
    } else {
      await doImportTables(obj)
    }
  } catch (importError) {
    // 导入失败时尝试恢复备份
    if (backupJson) {
      console.error('导入失败，尝试恢复备份数据...')
      try {
        await doImportTables(JSON.parse(backupJson))
        console.log('备份数据恢复成功')
      } catch (restoreError) {
        console.error('备份恢复也失败了，请手动导入备份文件:', restoreError)
      }
    }
    throw new Error(`导入失败: ${importError instanceof Error ? importError.message : '未知错误'}`)
  }
}

/**
 * 剥离记录中的自增主键：合并导入时让 Dexie 重新分配 id，
 * 避免同一份备份重复导入时因主键冲突（ConstraintError）导致整个事务回滚。
 */
function stripAutoIncrementId<T extends { id?: number | string }>(
  item: T,
): Omit<T, 'id'> & { id?: undefined } {
  const { id: _ignored, ...rest } = item
  return { ...rest, id: undefined }
}

// 合并导入：保留现有数据，合并导入的数据
async function doMergeImport(data: Record<string, unknown>): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    // attempts: 追加（不去重，保留所有历史记录；主键由 Dexie 自增重新分配）
    if (data.attempts) {
      await db.attempts.bulkAdd(
        (data.attempts as Attempt[]).map((item) => stripAutoIncrementId(item)),
      )
    }
    // questionStats: 批量读取后批量合并，大幅减少 IndexedDB 操作次数
    if (data.questionStats) {
      const imported = data.questionStats as QuestionStats[]
      const ids = imported.map((item) => item.questionId)
      const existingList = await db.questionStats.bulkGet(ids)
      const upserts: QuestionStats[] = []
      for (let i = 0; i < imported.length; i++) {
        const item = imported[i]
        const existing = existingList[i]
        if (existing) {
          upserts.push({
            ...existing,
            attemptCount: existing.attemptCount + item.attemptCount,
            correctCount: existing.correctCount + item.correctCount,
            wrongCount: existing.wrongCount + item.wrongCount,
            masteryLevel: Math.max(existing.masteryLevel, item.masteryLevel),
            isBookmarked: existing.isBookmarked || item.isBookmarked,
            lastSelectedKey:
              item.lastAttemptAt > existing.lastAttemptAt
                ? item.lastSelectedKey
                : existing.lastSelectedKey,
            lastCorrect:
              item.lastAttemptAt > existing.lastAttemptAt ? item.lastCorrect : existing.lastCorrect,
            lastAttemptAt:
              item.lastAttemptAt > existing.lastAttemptAt
                ? item.lastAttemptAt
                : existing.lastAttemptAt,
            reviewDueAt:
              item.lastAttemptAt > existing.lastAttemptAt ? item.reviewDueAt : existing.reviewDueAt,
          })
        } else {
          upserts.push(item)
        }
      }
      await db.questionStats.bulkPut(upserts)
    }
    // tagStats: 批量读取后批量合并
    if (data.tagStats) {
      const imported = data.tagStats as TagStats[]
      const tags = imported.map((item) => item.tag)
      const existingList = await db.tagStats.bulkGet(tags)
      const upserts: TagStats[] = []
      for (let i = 0; i < imported.length; i++) {
        const item = imported[i]
        const existing = existingList[i]
        if (existing) {
          upserts.push({
            tag: item.tag,
            attemptCount: existing.attemptCount + item.attemptCount,
            correctCount: existing.correctCount + item.correctCount,
            wrongCount: existing.wrongCount + item.wrongCount,
          })
        } else {
          upserts.push(item)
        }
      }
      await db.tagStats.bulkPut(upserts)
    }
    // sessions: 追加（主键同样由自增重新分配）
    if (data.sessions) {
      await db.sessions.bulkAdd(
        (data.sessions as Session[]).map((item) => stripAutoIncrementId(item)),
      )
    }
    // settings: 合并，导入的设置覆盖现有
    if (data.settings) {
      await db.settings.bulkPut(data.settings as { key: string; value: string }[])
    }
  })
}

// 内部导入函数，供 importData 和 restoreFromBackup 复用
async function doImportTables(data: Record<string, unknown>): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    if (data.attempts) {
      await db.attempts.clear()
      await db.attempts.bulkAdd(data.attempts as Attempt[])
    }
    if (data.questionStats) {
      await db.questionStats.clear()
      await db.questionStats.bulkPut(data.questionStats as QuestionStats[])
    }
    if (data.tagStats) {
      await db.tagStats.clear()
      await db.tagStats.bulkPut(data.tagStats as TagStats[])
    }
    if (data.sessions) {
      await db.sessions.clear()
      await db.sessions.bulkAdd(data.sessions as Session[])
    }
    if (data.settings) {
      await db.settings.clear()
      await db.settings.bulkPut(data.settings as { key: string; value: string }[])
    }
  })
}

/**
 * 清空指定题目集合的答题记录和统计（用于"重置题单"功能）。
 * @param questionIds 需要重置的题目 ID 列表
 * @param affectedTags 这些题目涉及的标签（用于清理 tagStats），由调用方从 Question 对象中收集
 */
export async function resetQuestionStats(
  questionIds: string[],
  affectedTags?: string[],
): Promise<void> {
  if (questionIds.length === 0) return
  await db.transaction('rw', db.attempts, db.questionStats, db.tagStats, async () => {
    // 删除 attempts
    await db.attempts.where('questionId').anyOf(questionIds).delete()
    // 删除 questionStats
    await db.questionStats.bulkDelete(questionIds)
    // 清理受影响的 tagStats（如有提供）
    if (affectedTags && affectedTags.length > 0) {
      await db.tagStats.bulkDelete(affectedTags)
    }
  })
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await db.attempts.clear()
    await db.questionStats.clear()
    await db.tagStats.clear()
    await db.sessions.clear()
    // 清除会话记录（按试卷分开存的那张表 + 旧版单条），避免恢复不存在的会话
    await db.settings.delete('activeSession')
    await db.settings.delete('activeSessions')
  })
}
