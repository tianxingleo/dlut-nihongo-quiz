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
    return entry.value as unknown as SettingsMap[K]
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

export async function recordAttempt(a: Omit<Attempt, 'id'>): Promise<number> {
  return db.transaction('rw', db.attempts, db.questionStats, async () => {
    const id = await db.attempts.add(a as Attempt)
    // Update question stats
    const stat = await db.questionStats.get(a.questionId)
    if (stat) {
      const newMastery = a.isCorrect
        ? Math.min(5, stat.masteryLevel < 1 ? 2 : stat.masteryLevel + 1)
        : 1
      await db.questionStats.update(a.questionId, {
        attemptCount: stat.attemptCount + 1,
        correctCount: stat.correctCount + (a.isCorrect ? 1 : 0),
        wrongCount: stat.wrongCount + (a.isCorrect ? 0 : 1),
        lastSelectedKey: a.selectedKey,
        lastCorrect: a.isCorrect,
        lastAttemptAt: a.createdAt,
        masteryLevel: newMastery,
        reviewDueAt: calcReviewDueAt(a.createdAt, newMastery),
      })
    } else {
      const initialMastery = a.isCorrect ? 2 : 1
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
  const [attempts, questionStats, tagStats, sessions, settings] = await Promise.all([
    db.attempts.toArray(),
    db.questionStats.toArray(),
    db.tagStats.toArray(),
    db.sessions.toArray(),
    db.settings.toArray(),
  ])
  return JSON.stringify({
    version: 2,
    exportedAt: new Date().toISOString(),
    attempts,
    questionStats,
    tagStats,
    sessions,
    settings,
  })
}

export async function importData(
  json: string,
  options: { merge?: boolean } = {},
): Promise<void> {
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

// 合并导入：保留现有数据，合并导入的数据
async function doMergeImport(data: Record<string, unknown>): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    // attempts: 追加（不去重，保留所有历史记录）
    if (data.attempts) {
      await db.attempts.bulkAdd(data.attempts as Attempt[])
    }
    // questionStats: 按 questionId 合并，保留更高的 masteryLevel
    if (data.questionStats) {
      const imported = data.questionStats as QuestionStats[]
      for (const item of imported) {
        const existing = await db.questionStats.get(item.questionId)
        if (existing) {
          // 合并策略：保留更高的 masteryLevel，累加 attemptCount
          await db.questionStats.update(item.questionId, {
            attemptCount: existing.attemptCount + item.attemptCount,
            correctCount: existing.correctCount + item.correctCount,
            wrongCount: existing.wrongCount + item.wrongCount,
            masteryLevel: Math.max(existing.masteryLevel, item.masteryLevel),
            isBookmarked: existing.isBookmarked || item.isBookmarked,
            // 保留最新的答题记录
            lastSelectedKey: item.lastAttemptAt > existing.lastAttemptAt ? item.lastSelectedKey : existing.lastSelectedKey,
            lastCorrect: item.lastAttemptAt > existing.lastAttemptAt ? item.lastCorrect : existing.lastCorrect,
            lastAttemptAt: item.lastAttemptAt > existing.lastAttemptAt ? item.lastAttemptAt : existing.lastAttemptAt,
            reviewDueAt: item.lastAttemptAt > existing.lastAttemptAt ? item.reviewDueAt : existing.reviewDueAt,
          })
        } else {
          await db.questionStats.put(item)
        }
      }
    }
    // tagStats: 按 tag 合并，累加计数
    if (data.tagStats) {
      const imported = data.tagStats as TagStats[]
      for (const item of imported) {
        const existing = await db.tagStats.get(item.tag)
        if (existing) {
          await db.tagStats.update(item.tag, {
            attemptCount: existing.attemptCount + item.attemptCount,
            correctCount: existing.correctCount + item.correctCount,
            wrongCount: existing.wrongCount + item.wrongCount,
          })
        } else {
          await db.tagStats.put(item)
        }
      }
    }
    // sessions: 追加
    if (data.sessions) {
      await db.sessions.bulkAdd(data.sessions as Session[])
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

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await db.attempts.clear()
    await db.questionStats.clear()
    await db.tagStats.clear()
    await db.sessions.clear()
    // 清除 settings 中的 activeSession，避免恢复不存在的会话
    await db.settings.delete('activeSession')
  })
}
