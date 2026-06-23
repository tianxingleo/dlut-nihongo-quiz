import Dexie, { type Table } from 'dexie'
import type { Attempt, QuestionStats, TagStats, Session } from '../types/question'

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
    this.version(2).stores({
      attempts: '++id, questionId, sessionId, isCorrect, createdAt, mode',
      questionStats: 'questionId, masteryLevel, reviewDueAt, isBookmarked',
      tagStats: 'tag, correctCount, wrongCount',
      sessions: '++id, mode, startedAt',
      settings: 'key',
    })
  }
}

export const db = new QuizDatabase()

// --- Settings helpers ---
export async function getSetting<T = string>(key: string, defaultValue: T): Promise<T> {
  const entry = await db.settings.get(key)
  if (!entry) return defaultValue
  try {
    return JSON.parse(entry.value) as T
  } catch {
    return entry.value as unknown as T
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value: JSON.stringify(value) })
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
// 间隔重复天数表：mastery 0-5 对应的复习间隔天数
export const INTERVAL_DAYS = [1, 1, 3, 7, 14, 30]

function calcReviewDueAt(lastAttemptAt: string, masteryLevel: number): string {
  if (!lastAttemptAt) return ''
  const days = INTERVAL_DAYS[masteryLevel] ?? 1
  return new Date(new Date(lastAttemptAt).getTime() + days * 86_400_000).toISOString()
}

export async function recordAttempt(a: Omit<Attempt, 'id'>): Promise<number> {
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
  return JSON.stringify(
    {
      version: 2,
      exportedAt: new Date().toISOString(),
      attempts,
      questionStats,
      tagStats,
      sessions,
      settings,
    },
    null,
    2,
  )
}

export async function importData(json: string): Promise<void> {
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
  await db.transaction('rw', db.tables, async () => {
    if (obj.attempts) {
      await db.attempts.clear()
      await db.attempts.bulkAdd(obj.attempts as Attempt[])
    }
    if (obj.questionStats) {
      await db.questionStats.clear()
      await db.questionStats.bulkPut(obj.questionStats as QuestionStats[])
    }
    if (obj.tagStats) {
      await db.tagStats.clear()
      await db.tagStats.bulkPut(obj.tagStats as TagStats[])
    }
    if (obj.sessions) {
      await db.sessions.clear()
      await db.sessions.bulkAdd(obj.sessions as Session[])
    }
    if (obj.settings) {
      await db.settings.clear()
      await db.settings.bulkPut(obj.settings as { key: string; value: string }[])
    }
  })
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await db.attempts.clear()
    await db.questionStats.clear()
    await db.tagStats.clear()
    await db.sessions.clear()
  })
}
