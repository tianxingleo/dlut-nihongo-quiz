import Dexie, { type Table } from 'dexie'
import type { Attempt, QuestionStats, TagStats, Session } from '../types/question'

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
  try { return JSON.parse(entry.value) as T } catch { return entry.value as unknown as T }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value: JSON.stringify(value) })
}

// --- Attempt helpers ---
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
    })
  } else {
    await db.questionStats.put({
      questionId: a.questionId,
      attemptCount: 1,
      correctCount: a.isCorrect ? 1 : 0,
      wrongCount: a.isCorrect ? 0 : 1,
      lastSelectedKey: a.selectedKey,
      lastCorrect: a.isCorrect,
      lastAttemptAt: a.createdAt,
      masteryLevel: a.isCorrect ? 2 : 1,
      reviewDueAt: '',
      isBookmarked: false,
    })
  }
  return id
}

// --- Tag stats ---
export async function updateTagStats(tags: string[], isCorrect: boolean): Promise<void> {
  for (const tag of tags) {
    const existing = await db.tagStats.get(tag)
    if (existing) {
      await db.tagStats.update(tag, {
        attemptCount: existing.attemptCount + 1,
        correctCount: existing.correctCount + (isCorrect ? 1 : 0),
        wrongCount: existing.wrongCount + (isCorrect ? 0 : 1),
      })
    } else {
      await db.tagStats.put({
        tag,
        attemptCount: 1,
        correctCount: isCorrect ? 1 : 0,
        wrongCount: isCorrect ? 0 : 1,
      })
    }
  }
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
  return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), attempts, questionStats, tagStats, sessions, settings }, null, 2)
}

export async function importData(json: string): Promise<void> {
  const data = JSON.parse(json)
  await db.transaction('rw', db.tables, async () => {
    if (data.attempts) { await db.attempts.clear(); await db.attempts.bulkAdd(data.attempts) }
    if (data.questionStats) { await db.questionStats.clear(); await db.questionStats.bulkPut(data.questionStats) }
    if (data.tagStats) { await db.tagStats.clear(); await db.tagStats.bulkPut(data.tagStats) }
    if (data.sessions) { await db.sessions.clear(); await db.sessions.bulkAdd(data.sessions) }
    if (data.settings) { await db.settings.clear(); await db.settings.bulkPut(data.settings) }
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
