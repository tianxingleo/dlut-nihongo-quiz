export function toggleMultiSelect(current: string, key: string): string {
  const selected = new Set(current.split(''))
  if (selected.has(key)) selected.delete(key)
  else selected.add(key)
  return [...selected].sort().join('')
}

export function isMultiAnswerCorrect(selected: string, answer: string): boolean {
  const a = new Set(selected.split(''))
  const b = new Set(answer.split(''))
  return a.size === b.size && [...a].every(x => b.has(x))
}
