import { describe, it, expect } from 'vitest'
import { shuffleArray, shuffleQuestionOptions } from './quizEngine'
import type { Question } from '../types/question'

const baseQuestion = (overrides: Partial<Question> = {}): Question => ({
  id: 'q1',
  category: 'grammar',
  groupId: 'g1',
  groupTitle: 'G1',
  numberInGroup: 1,
  stem: 'stem',
  options: [
    { key: 'A', text: '甲' },
    { key: 'B', text: '乙' },
    { key: 'C', text: '丙' },
    { key: 'D', text: '丁' },
  ],
  answerKey: 'B',
  answerText: '乙',
  translation: '',
  explanation: '',
  grammarPoints: [],
  tags: [],
  source: { file: '', group: '', position: 0 },
  status: 'ready',
  ...overrides,
})

describe('shuffleArray', () => {
  it('returns a new array (does not mutate input)', () => {
    const input = [1, 2, 3, 4, 5]
    const result = shuffleArray(input)
    expect(result).not.toBe(input)
    expect(input).toEqual([1, 2, 3, 4, 5])
  })

  it('preserves the element multiset', () => {
    const input = [1, 2, 3, 4, 5]
    const result = shuffleArray(input).sort()
    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  it('handles empty and single-element arrays', () => {
    expect(shuffleArray([])).toEqual([])
    expect(shuffleArray([1])).toEqual([1])
  })
})

describe('shuffleQuestionOptions', () => {
  it('keeps the correct answer correct after relabeling A-D', () => {
    const q = baseQuestion()
    const shuffled = shuffleQuestionOptions(q)
    const correctOpt = shuffled.options.find(o => o.key === shuffled.answerKey)
    expect(correctOpt).toBeDefined()
    expect(correctOpt?.text).toBe(q.options.find(o => o.key === q.answerKey)?.text)
  })

  it('relabels keys as A,B,C,D in order', () => {
    const q = baseQuestion()
    const shuffled = shuffleQuestionOptions(q)
    expect(shuffled.options.map(o => o.key)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('preserves the original option texts (as a multiset)', () => {
    const q = baseQuestion()
    const shuffled = shuffleQuestionOptions(q)
    expect(shuffled.options.map(o => o.text).sort()).toEqual(
      q.options.map(o => o.text).sort(),
    )
  })

  it('returns the question unchanged when multiAnswer is set', () => {
    const q = baseQuestion({ multiAnswer: true })
    const shuffled = shuffleQuestionOptions(q)
    expect(shuffled).toBe(q)
  })

  it('returns the question unchanged when correct option cannot be found', () => {
    const q = baseQuestion({ answerKey: 'Z' })
    expect(shuffleQuestionOptions(q)).toBe(q)
  })
})
