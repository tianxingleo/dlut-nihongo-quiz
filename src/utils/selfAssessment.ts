export const SELF_CORRECT = '__self_correct__'
export const SELF_WRONG = '__self_wrong__'

export function isSelfAssessmentVerdict(value: string): boolean {
  return value === SELF_CORRECT || value === SELF_WRONG
}
