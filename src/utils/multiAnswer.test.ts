import { describe, it, expect } from 'vitest'
import {
  hasCompleteFillAnswer,
  isFillAnswerCorrect,
  isMultiAnswerCorrect,
  toggleMultiSelect,
} from './multiAnswer'

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

describe('按空位判分', () => {
  const slots = [{ answers: ['に', 'へ'] }, { answers: ['８時'] }]

  it('接受每空的参考表达及全半角差异，保留空位顺序', () => {
    expect(isFillAnswerCorrect(' へ／8 時 ', 'に／８時', slots)).toBe(true)
    expect(isFillAnswerCorrect('８時／に', 'に／８時', slots)).toBe(false)
  })

  it('拒绝有空缺或多填的答案', () => {
    expect(hasCompleteFillAnswer('に／　', 2)).toBe(false)
    expect(hasCompleteFillAnswer('に／8時／を', 2)).toBe(false)
    expect(isFillAnswerCorrect('に', 'に／８時', slots)).toBe(false)
  })

  it('保留既有单输入框的答案比较规则', () => {
    expect(isFillAnswerCorrect('  AB ', 'ab')).toBe(true)
    expect(isFillAnswerCorrect('a b', 'ab')).toBe(false)
  })
})
