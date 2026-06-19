import { describe, it, expect } from 'vitest'
import { toggleMultiSelect, isMultiAnswerCorrect } from './multiAnswer'

describe('toggleMultiSelect', () => {
  it('adds a new key in sorted order', () => {
    expect(toggleMultiSelect('', 'A')).toBe('A')
    expect(toggleMultiSelect('A', 'C')).toBe('AC')
    // 自动排序：'CA' -> 'AC'
    expect(toggleMultiSelect('A', 'B')).toBe('AB')
    expect(toggleMultiSelect('B', 'A')).toBe('AB')
  })

  it('removes an existing key', () => {
    expect(toggleMultiSelect('ABC', 'B')).toBe('AC')
    expect(toggleMultiSelect('A', 'A')).toBe('')
  })

  it('handles E (5th option)', () => {
    expect(toggleMultiSelect('AB', 'E')).toBe('ABE')
  })
})

describe('isMultiAnswerCorrect', () => {
  it('matches identical selections', () => {
    expect(isMultiAnswerCorrect('ABC', 'ABC')).toBe(true)
    expect(isMultiAnswerCorrect('CAB', 'ABC')).toBe(true) // 顺序无关
  })

  it('rejects partial match', () => {
    expect(isMultiAnswerCorrect('AB', 'ABC')).toBe(false)
    expect(isMultiAnswerCorrect('ABC', 'AB')).toBe(false)
  })

  it('rejects supersets', () => {
    expect(isMultiAnswerCorrect('ABCD', 'ABC')).toBe(false)
  })

  it('rejects disjoint', () => {
    expect(isMultiAnswerCorrect('XY', 'ABC')).toBe(false)
  })

  it('handles single-answer keys', () => {
    expect(isMultiAnswerCorrect('A', 'A')).toBe(true)
    expect(isMultiAnswerCorrect('B', 'A')).toBe(false)
  })
})
