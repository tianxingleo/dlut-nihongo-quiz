import 'fake-indexeddb/auto'
import { db, importData } from '../db/database'
import { describe, it, expect } from 'vitest'
import {
  isSessionInProgress,
  buildPaperKey,
  paperKeyFromEntryKey,
  paperKeyOf,
  pickSessionForScope,
  loadActiveSessions,
  saveActiveSession,
  type ActiveSession,
  type ActiveSessionMap,
} from './sessionResume'

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

describe('buildPaperKey', () => {
  it('gives every category its own whole-category record', () => {
    expect(buildPaperKey({ category: 'history' })).toBe('history|all|')
    expect(buildPaperKey({ category: 'computer-2021-final' })).toBe('computer-2021-final|all|')
  })

  it('separates sub-banks and single question lists by their group set', () => {
    expect(buildPaperKey({ category: 'japanese2', groups: 'g21,g22' })).toBe('japanese2|g21,g22|')
    expect(buildPaperKey({ category: 'history', group: 't0' })).toBe('history|t0|')
  })

  it('ignores the practice mode, so 顺序/随机 share one record', () => {
    expect(paperKeyFromEntryKey('history|sequential|t0||||')).toBe(
      paperKeyFromEntryKey('history|random|t0||||1'),
    )
  })

  it('keeps the tag in the key so different tags stay apart', () => {
    expect(buildPaperKey({ category: 'japanese2', tag: '阅读' })).toBe('japanese2|all|阅读')
  })
})

describe('paperKeyOf', () => {
  it('prefers the explicit paperKey', () => {
    expect(
      paperKeyOf(makeSession({ paperKey: 'history|t0|', entryKey: 'party|random|t1||||' })),
    ).toBe('history|t0|')
  })

  it('falls back to entryKey for records saved before the split', () => {
    expect(paperKeyOf(makeSession({ entryKey: 'japanese2|random||g11|||' }))).toBe('japanese2|g11|')
  })

  it('returns an empty key when the record carries neither', () => {
    expect(paperKeyOf(makeSession())).toBe('')
  })
})

describe('pickSessionForScope', () => {
  // 相对当前时间构造：超过 SESSION.MAX_AGE_MS 的记录会被当作过期，不能拿固定日期当"新"
  const older = makeSession({
    sessionId: 'older',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
  })
  const newer = makeSession({ sessionId: 'newer', startedAt: new Date().toISOString() })

  it('only ever looks at the current category', () => {
    const map: ActiveSessionMap = { 'history|t0|': older, 'party|all|': newer }
    expect(pickSessionForScope(map, { category: 'history', groups: null })?.session.sessionId).toBe(
      'older',
    )
    expect(pickSessionForScope(map, { category: 'military', groups: null })).toBeNull()
  })

  it('picks the most recently started record in scope', () => {
    const map: ActiveSessionMap = { 'history|t0|': older, 'history|all|': newer }
    expect(pickSessionForScope(map, { category: 'history', groups: null })?.key).toBe(
      'history|all|',
    )
  })

  it('with a sub-bank selected, ignores other sub-banks and the whole-category record', () => {
    const map: ActiveSessionMap = {
      'japanese2|g21,g22|': newer,
      'japanese2|all|': newer,
      'japanese2|g11|': older,
    }
    expect(pickSessionForScope(map, { category: 'japanese2', groups: ['g11'] })?.key).toBe(
      'japanese2|g11|',
    )
  })

  it('ignores finished / expired records', () => {
    const done = makeSession({ sessionId: 'done', currentIndex: 4, submitted: true })
    expect(
      pickSessionForScope({ 'history|t0|': done }, { category: 'history', groups: null }),
    ).toBeNull()
  })
})

it('isolates temporary questions and normalizes review sets', () => {
  expect(paperKeyFromEntryKey('history|sequential||||q1|')).toBe('')
  expect(buildPaperKey({ category: 'history', ids: 'q2,q1,q1', source: 'wrong' })).toBe(
    'history|review|wrong|q1,q2',
  )
  expect(buildPaperKey({ category: 'history', ids: 'q1', source: 'bookmarks' })).toBe(
    'history|review|bookmarks|q1',
  )
  expect(buildPaperKey({ category: 'history', questionType: 'fill' })).toBe('history|all||fill')
})

it('migrates both backup formats and keeps concurrent saves for separate practice sets', async () => {
  await db.settings.clear()
  const whole = makeSession({ entryKey: 'history|sequential|||||', currentIndex: 1 })
  const review = makeSession({ entryKey: 'history|wrong||||q2,q1|', paperKey: 'history|all|' })
  await importData(
    JSON.stringify({
      version: 2,
      settings: [
        { key: 'activeSession', value: JSON.stringify(whole) },
        { key: 'activeSessions', value: JSON.stringify({ 'history|all|': review }) },
      ],
    }),
  )
  await Promise.all([
    saveActiveSession(makeSession({ entryKey: 'history|wrong||||q3,q1|||wrong' })),
    saveActiveSession(makeSession({ entryKey: 'history|wrong||||q3,q1|||bookmarks' })),
    saveActiveSession(makeSession({ entryKey: 'history|wrong||||q1|' })),
  ])
  expect(await loadActiveSessions()).toMatchObject({
    'history|all|': { currentIndex: 1 },
    'history|review|legacy|q1,q2': { entryKey: review.entryKey },
    'history|review|wrong|q1,q3': {},
    'history|review|bookmarks|q1,q3': {},
  })
  expect(Object.keys(await loadActiveSessions())).toHaveLength(4)
})
