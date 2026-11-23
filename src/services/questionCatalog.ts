import type { Category, Question, QuestionStats } from '../types/question'
import { CATEGORIES } from '../config/categories'
import { filterVisibleQuestions, getQuestions } from './questionRepository'
import { rankQuestions } from './questionQuery'

type Entry = Pick<Question, 'id' | 'groupId' | 'groupTitle'> & { hidden: boolean }
type Bank = { category: Category; bankFile: string; count: number; questions: Entry[] }
type SearchEntry = Entry &
  Pick<Question, 'category' | 'stem' | 'headword' | 'tags' | 'grammarPoints' | 'translation'>

function resourceUrl(name: string): string {
  return import.meta.env.BASE_URL + name
}

function jsonResource<T>(name: string) {
  let pending: Promise<T> | undefined
  return () =>
    (pending ??= fetch(resourceUrl(name))
      .then((response) => {
        if (!response.ok) throw new Error(`资源加载失败（${response.status}）`)
        return response.json() as Promise<T>
      })
      .catch((error) => {
        pending = undefined
        throw error
      }))
}

export const loadCatalog = jsonResource<Bank[]>('question-catalog.json')
const loadSearch = jsonResource<SearchEntry[]>('question-search.json')
const loadExplanations = jsonResource<Record<string, string>>('question-explanations.json')

async function cachedQuestions(): Promise<Question[]> {
  const lists = await Promise.all(
    CATEGORIES.map(async ({ key, bankFile }) => {
      const loaded = getQuestions(key)
      if (loaded.length || !globalThis.caches) return loaded
      const response = await caches.match(resourceUrl(bankFile), { ignoreVary: true })
      if (!response) return []
      const questions = (await response.json()) as Question[]
      return questions.map((q) => ({ ...q, category: key }))
    }),
  )
  return lists.flat()
}

export async function searchCatalog(
  keyword: string,
  options: {
    unlocked: boolean
    category?: Category
    includeExplanations: boolean
  },
) {
  const [index, explanations] = await Promise.allSettled([
    loadSearch(),
    options.includeExplanations
      ? loadExplanations()
      : Promise.resolve({} as Record<string, string>),
  ])
  const partial = index.status === 'rejected' || explanations.status === 'rejected'
  const cached = partial ? await cachedQuestions() : []
  const rows =
    index.status === 'fulfilled'
      ? index.value.filter((q) => options.unlocked || !q.hidden)
      : filterVisibleQuestions(cached, options.unlocked)
  const details = new Map(cached.map((q) => [q.id, q.explanation]))
  return {
    partial,
    results: rankQuestions(
      rows.filter((q) => !options.category || q.category === options.category),
      keyword,
      (q) =>
        options.includeExplanations
          ? explanations.status === 'fulfilled'
            ? explanations.value[q.id]
            : details.get(q.id)
          : undefined,
    ),
  }
}

export function summarizeProgress(ids: Iterable<string>, stats: Map<string, QuestionStats>) {
  let done = 0
  let attempts = 0
  let correct = 0
  for (const id of ids) {
    const row = stats.get(id)
    if (!row?.attemptCount) continue
    done++
    attempts += row.attemptCount
    correct += row.correctCount
  }
  return { done, attempts, correct, rate: attempts ? Math.round((correct / attempts) * 100) : 0 }
}
