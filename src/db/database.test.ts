import { describe, it, expect } from 'vitest'
import { createDefaultStats, createSession, importData } from './database'

describe('createDefaultStats', () => {
  it('returns a QuestionStats with the given id and safe defaults', () => {
    const s = createDefaultStats('q1')
    expect(s.questionId).toBe('q1')
    expect(s.attemptCount).toBe(0)
    expect(s.correctCount).toBe(0)
    expect(s.wrongCount).toBe(0)
    expect(s.masteryLevel).toBe(0)
    expect(s.isBookmarked).toBe(false)
    expect(s.lastAttemptAt).toBe('')
  })

  it('applies overrides without losing other defaults', () => {
    const s = createDefaultStats('q2', { attemptCount: 5, correctCount: 3, masteryLevel: 2 })
    expect(s.questionId).toBe('q2')
    expect(s.attemptCount).toBe(5)
    expect(s.correctCount).toBe(3)
    expect(s.wrongCount).toBe(0) // 未覆盖
    expect(s.masteryLevel).toBe(2)
  })
})

describe('createSession', () => {
  it('builds a Session with required fields', () => {
    const sess = createSession({
      mode: 'sequential',
      totalQuestions: 10,
      correctCount: 7,
      wrongCount: 3,
      startedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(sess.mode).toBe('sequential')
    expect(sess.totalQuestions).toBe(10)
    expect(sess.correctCount).toBe(7)
    expect(sess.wrongCount).toBe(3)
    expect(sess.startedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(sess.id).toBeUndefined()
  })
})

describe('importData', () => {
  // importData 内部会用真实 Dexie 表，这里只验证 schema 校验路径会尽早抛错，
  // 不会触发到 db.transaction 那一步。
  it('rejects invalid JSON', async () => {
    await expect(importData('{ not json')).rejects.toThrow(/有效的 JSON/)
  })

  it('rejects non-object root', async () => {
    await expect(importData('[]')).rejects.toThrow(/根对象/)
    await expect(importData('"hello"')).rejects.toThrow(/根对象/)
    await expect(importData('null')).rejects.toThrow(/根对象/)
  })

  it('rejects missing version field', async () => {
    await expect(importData(JSON.stringify({ attempts: [] }))).rejects.toThrow(/version/)
  })

  it('rejects when a known table is not an array', async () => {
    await expect(importData(JSON.stringify({ version: 2, attempts: 'oops' }))).rejects.toThrow(
      /应为数组/,
    )
    await expect(importData(JSON.stringify({ version: 2, sessions: { a: 1 } }))).rejects.toThrow(
      /应为数组/,
    )
  })
})
