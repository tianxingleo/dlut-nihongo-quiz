import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CATEGORIES } from '../src/config/categories'
import type { Question } from '../src/types/question'

export function generateQuestionCatalog() {
  const ids = new Set<string>()
  const explanations: Record<string, string> = {}
  const banks = CATEGORIES.map(({ key: category, bankFile, subBanks }) => {
    const questions: Question[] = JSON.parse(readFileSync(resolve('public', bankFile), 'utf8'))
    const hiddenGroups = new Set(
      subBanks?.filter((bank) => bank.requireUnlock).flatMap((bank) => bank.groupOrder),
    )
    return {
      category,
      bankFile,
      count: questions.length,
      rows: questions.map((q) => {
        if (!q.id || ids.has(q.id)) throw new Error(`重复或缺失的题目 ID：${bankFile} / ${q.id}`)
        if (q.category && q.category !== category)
          throw new Error(`题目归属错误：${q.id} / ${q.category} / ${category}`)
        ids.add(q.id)
        if (q.explanation) explanations[q.id] = q.explanation
        return { ...q, category, hidden: hiddenGroups.has(q.groupId) }
      }),
    }
  })
  return {
    'question-catalog.json': JSON.stringify(
      banks.map(({ rows, ...bank }) => ({
        ...bank,
        questions: rows.map(({ id, groupId, groupTitle, hidden }) => ({
          id,
          groupId,
          groupTitle,
          hidden,
        })),
      })),
    ),
    'question-search.json': JSON.stringify(
      banks.flatMap(({ rows }) =>
        rows.map(
          ({
            id,
            category,
            groupId,
            groupTitle,
            hidden,
            stem,
            headword,
            tags,
            grammarPoints,
            translation,
          }) => ({
            id,
            category,
            groupId,
            groupTitle,
            hidden,
            stem,
            headword,
            tags,
            grammarPoints,
            translation,
          }),
        ),
      ),
    ),
    'question-explanations.json': JSON.stringify(explanations),
  }
}
