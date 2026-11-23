import { describe, expect, it } from 'vitest'
import { mapAnswer, optionSignature } from './sessionAnswers'
import type { Question } from '../types/question'

describe('session answer mapping', () => {
  it('maps multiple original keys to current labels in both directions', () => {
    const question = {
      multiAnswer: true,
      options: [
        { key: 'A', originalKey: 'C', text: '选项丙' },
        { key: 'B', originalKey: 'A', text: '选项甲' },
        { key: 'C', originalKey: 'B', text: '选项乙' },
      ],
    } as Question
    expect(mapAnswer(question, 'AC', 'original')).toBe('BC')
    expect(mapAnswer(question, 'BC', 'display')).toBe('AC')
    expect(mapAnswer(question, 'BD', 'display')).toBe('')
  })

  it.each([
    [{ questionType: 'fill' }, '半径／'],
    [{ selfAssessment: true }, 'self-correct'],
  ] as const)('preserves non-choice values (%s)', (fields, value) => {
    const question = { options: [], ...fields } as Question
    expect(optionSignature(question)).toBe('')
    expect(mapAnswer(question, value, 'original')).toBe(value)
    expect(mapAnswer(question, value, 'display')).toBe(value)
  })
})
