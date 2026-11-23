import type { Question } from '../types/question'

export function optionSignature(q: Question): string {
  if (q.selfAssessment || q.questionType === 'fill' || !q.options.length) return ''
  return JSON.stringify(q.options.map((o) => [o.originalKey ?? o.key, o.text]).sort())
}

export function mapAnswer(q: Question, value: string, direction: 'original' | 'display'): string {
  if (!value || !optionSignature(q)) return value
  const keys = q.multiAnswer ? [...value] : [value]
  const mapped = keys.map((key) => {
    const option = q.options.find(
      (o) => (direction === 'original' ? o.key : (o.originalKey ?? o.key)) === key,
    )
    return direction === 'original' ? (option?.originalKey ?? option?.key) : option?.key
  })
  return mapped.every(Boolean) ? mapped.sort().join('') : ''
}
