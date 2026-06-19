import { describe, it, expect } from 'vitest'
import { createDefaultStats, createSession } from './database'

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
