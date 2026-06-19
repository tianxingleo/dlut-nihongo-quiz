import { describe, it, expect } from 'vitest'
import { isWrong } from './reviewScheduler'
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
    expect(isWrong(makeStat({ wrongCount: 3, correctCount: 1, attemptCount: 4, masteryLevel: 1 }))).toBe(true)
  })

  it('returns true when masteryLevel <= 2 even if wrongCount === correctCount', () => {
    expect(isWrong(makeStat({ wrongCount: 2, correctCount: 2, attemptCount: 4, masteryLevel: 1 }))).toBe(true)
    expect(isWrong(makeStat({ wrongCount: 2, correctCount: 2, attemptCount: 4, masteryLevel: 2 }))).toBe(true)
  })

  it('returns false once masteryLevel has recovered to 3+ and wrongCount <= correctCount', () => {
    expect(isWrong(makeStat({ wrongCount: 1, correctCount: 3, attemptCount: 4, masteryLevel: 3 }))).toBe(false)
  })

  it('returns false for wrongCount 0 regardless of mastery', () => {
    expect(isWrong(makeStat({ wrongCount: 0, masteryLevel: 1 }))).toBe(false)
  })
})
