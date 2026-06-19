import { describe, it, expect } from 'vitest'
import { isWrong, deriveReviewDueAt, isReviewDue } from './reviewScheduler'
import type { QuestionStats } from '../types/question'

const makeStat = (overrides: Partial<QuestionStats> = {}): QuestionStats => ({
  questionId: 'q1',
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
})

describe('isWrong', () => {
  it('returns false for never-attempted questions', () => {
    expect(isWrong(makeStat({ attemptCount: 0 }))).toBe(false)
  })

  it('returns true when wrongCount > correctCount', () => {
    expect(
      isWrong(makeStat({ wrongCount: 3, correctCount: 1, attemptCount: 4, masteryLevel: 1 })),
    ).toBe(true)
  })

  it('returns true when masteryLevel <= 2 even if wrongCount === correctCount', () => {
    expect(
      isWrong(makeStat({ wrongCount: 2, correctCount: 2, attemptCount: 4, masteryLevel: 1 })),
    ).toBe(true)
    expect(
      isWrong(makeStat({ wrongCount: 2, correctCount: 2, attemptCount: 4, masteryLevel: 2 })),
    ).toBe(true)
  })

  it('returns false once masteryLevel has recovered to 3+ and wrongCount <= correctCount', () => {
    expect(
      isWrong(makeStat({ wrongCount: 1, correctCount: 3, attemptCount: 4, masteryLevel: 3 })),
    ).toBe(false)
  })

  it('returns false for wrongCount 0 regardless of mastery', () => {
    expect(isWrong(makeStat({ wrongCount: 0, masteryLevel: 1 }))).toBe(false)
  })
})

describe('deriveReviewDueAt / isReviewDue', () => {
  it('returns empty string when the question has never been attempted', () => {
    expect(deriveReviewDueAt(makeStat({ lastAttemptAt: '' }))).toBe('')
    expect(isReviewDue(makeStat({ lastAttemptAt: '' }))).toBe(false)
  })

  it('uses INTERVAL_DAYS lookup by masteryLevel', () => {
    const now = new Date('2026-06-19T00:00:00.000Z')
    const oneDayAgo = new Date(now.getTime() - 1 * 86_400_000).toISOString()
    const fourDaysAgo = new Date(now.getTime() - 4 * 86_400_000).toISOString()

    // mastery 2 → 3 天到期；4 天前做 → 已到期
    expect(isReviewDue(makeStat({ masteryLevel: 2, lastAttemptAt: fourDaysAgo }), now)).toBe(true)
    // mastery 2 → 3 天到期；1 天前做 → 未到期
    expect(isReviewDue(makeStat({ masteryLevel: 2, lastAttemptAt: oneDayAgo }), now)).toBe(false)
  })

  it('treats unknown masteryLevel as 1-day interval (fallback)', () => {
    // masteryLevel 越界走 ?? 1 兜底
    const s = makeStat({
      masteryLevel: 99,
      lastAttemptAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    })
    expect(isReviewDue(s)).toBe(true)
  })
})
