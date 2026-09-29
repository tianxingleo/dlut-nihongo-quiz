import { describe, it, expect } from 'vitest'
import { routeEntryKey } from './routeEntry'

describe('routeEntryKey', () => {
  it('is stable for an empty query', () => {
    expect(routeEntryKey({})).toBe(routeEntryKey({}))
  })

  it('ignores fresh, so stripping it after mount does not remount the page', () => {
    // QuizPage 挂载后会把 fresh 从 URL 抹掉，这一步不能触发重挂载
    expect(routeEntryKey({ mode: 'random', fresh: '1' })).toBe(routeEntryKey({ mode: 'random' }))
  })

  it('changes when the entry params change (only-wrong / redo-wrong buttons)', () => {
    const before = routeEntryKey({ mode: 'sequential' })
    const onlyWrong = routeEntryKey({ ids: 'a,b' })
    const redoWrong = routeEntryKey({ ids: 'a,b', redo: '1', fresh: '1' })
    expect(onlyWrong).not.toBe(before)
    expect(redoWrong).not.toBe(onlyWrong)
  })

  it('does not depend on key order', () => {
    expect(routeEntryKey({ mode: 'random', group: 't0' })).toBe(
      routeEntryKey({ group: 't0', mode: 'random' }),
    )
  })

  it('handles repeated params (arrays)', () => {
    const arr = routeEntryKey({ tag: ['a', 'b'] })
    expect(arr).toBe(routeEntryKey({ tag: ['a', 'b'] }))
    expect(arr).not.toBe(routeEntryKey({ tag: ['b', 'a'] }))
  })

  it('treats a missing value as empty string', () => {
    expect(routeEntryKey({ tag: null })).toBe(routeEntryKey({ tag: '' }))
  })
})
