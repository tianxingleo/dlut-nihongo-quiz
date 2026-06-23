import { describe, it, expect } from 'vitest'
import { isSessionInProgress, type ActiveSession } from './sessionResume'

function makeSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    sessionId: 'test-123',
    mode: 'sequential',
    questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
    totalQuestions: 5,
    currentIndex: 0,
    submitted: false,
    correctCount: 0,
    wrongList: [],
    startedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('isSessionInProgress', () => {
  it('returns false for null', () => {
    expect(isSessionInProgress(null)).toBe(false)
  })

  it('returns false when questionIds is empty', () => {
    expect(isSessionInProgress(makeSession({ questionIds: [] }))).toBe(false)
  })

  it('returns true when not submitted and currentIndex < total', () => {
    expect(isSessionInProgress(makeSession({ currentIndex: 2, submitted: false }))).toBe(true)
  })

  it('returns true when submitted and currentIndex + 1 < total', () => {
    expect(isSessionInProgress(makeSession({ currentIndex: 3, submitted: true }))).toBe(true)
  })

  it('returns false when not submitted at last question (currentIndex = total - 1)', () => {
    // currentIndex=4, total=5, not submitted → nextIndex=4 < 5 → true (still on last question)
    expect(isSessionInProgress(makeSession({ currentIndex: 4, submitted: false }))).toBe(true)
  })

  it('returns false when submitted at last question', () => {
    // currentIndex=4, total=5, submitted → nextIndex=5, 5 < 5 → false
    expect(isSessionInProgress(makeSession({ currentIndex: 4, submitted: true }))).toBe(false)
  })

  it('returns false when submitted beyond total (edge case)', () => {
    expect(isSessionInProgress(makeSession({ currentIndex: 5, submitted: true }))).toBe(false)
  })

  it('returns false when questionIds is missing (undefined)', () => {
    const session = makeSession()
    delete (session as Record<string, unknown>).questionIds
    expect(isSessionInProgress(session as unknown as ActiveSession)).toBe(false)
  })
})
