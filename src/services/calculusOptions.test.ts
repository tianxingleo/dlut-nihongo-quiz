import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadQuestionBank } from './questionRepository'
import { CATEGORIES } from '../config/categories'

afterEach(() => vi.unstubAllGlobals())

it('preserves printed option letters when loading every calculus paper', async () => {
  const papers = CATEGORIES.filter(
    (category) =>
      category.key.startsWith('math-') ||
      category.key.startsWith('calculus1-') ||
      category.key === '2019-a-7',
  )
  for (const paper of papers) {
    const original = JSON.parse(readFileSync(`public/${paper.bankFile}`, 'utf8'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => original })),
    )
    const loaded = await loadQuestionBank(paper.key)
    expect(loaded.map((question) => [question.options, question.answerKey])).toEqual(
      original.map((question: { options: unknown; answerKey: string }) => [
        question.options,
        question.answerKey,
      ]),
    )
  }
})
