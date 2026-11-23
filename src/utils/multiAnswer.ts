import type { Question } from '../types/question'

export const FILL_SLOT_SEPARATOR = '／'

export function toggleMultiSelect(current: string, key: string): string {
  const selected = new Set(current.split(''))
  if (selected.has(key)) selected.delete(key)
  else selected.add(key)
  return [...selected].sort().join('')
}

export function isMultiAnswerCorrect(selected: string, answer: string): boolean {
  const a = new Set(selected.split(''))
  const b = new Set(answer.split(''))
  return a.size === b.size && [...a].every((x) => b.has(x))
}

export function hasCompleteFillAnswer(answer: string, slotCount: number): boolean {
  const slots = answer.split(FILL_SLOT_SEPARATOR)
  return slots.length === slotCount && slots.every((slot) => slot.trim().length > 0)
}

/** 多空题按空位顺序判分，旧题库仍以完整答案字符串比较。 */
export function isFillAnswerCorrect(
  userAnswer: string,
  correctAnswer: string,
  fillSlots?: Question['fillSlots'],
): boolean {
  if (fillSlots) {
    if (!hasCompleteFillAnswer(userAnswer, fillSlots.length)) return false
    const entered = userAnswer.split(FILL_SLOT_SEPARATOR).map(normalizeSlot)
    return fillSlots.every((slot, index) =>
      slot.answers.some((answer) => normalizeSlot(answer) === entered[index]),
    )
  }
  return userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
}

const normalizeSlot = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
