import type { Question, Category } from '../types/question'

const cache = new Map<Category, Question[]>()
const groupsCache = new Map<Category, { groupId: string; groupTitle: string; count: number }[]>()
const tagsCache = new Map<Category, { tag: string; count: number }[]>()
const grammarPointsCache = new Map<Category, { point: string; count: number }[]>()

export function shuffleQuestionOptions(q: Question): Question {
  const correctOpt = q.options.find(o => o.key === q.answerKey)
  if (!correctOpt) return q
  const shuffled = shuffleArray(q.options)
  const correctIdx = shuffled.findIndex(o => o.key === q.answerKey)
  const newOptions = shuffled.map((opt, i) => ({
    key: String.fromCharCode(65 + i),
    text: opt.text,
  }))
  return {
    ...q,
    options: newOptions,
    answerKey: newOptions[correctIdx].key,
  }
}

export async function loadQuestionBank(category: Category = 'grammar'): Promise<Question[]> {
  const cached = cache.get(category)
  if (cached) return cached
  const base = import.meta.env.BASE_URL
  const file = category === 'word'
    ? `${base}word-question-bank.json`
    : category === 'history'
      ? `${base}history-question-bank.json`
      : category === 'party'
        ? `${base}party-question-bank.json`
        : category === 'military'
          ? `${base}military-question-bank.json`
          : `${base}question-bank.json`
  const resp = await fetch(file)
  if (!resp.ok) throw new Error(`无法加载题库 ${file}: ${resp.status}`)
  const raw: Question[] = await resp.json()
  // For history/party/military: do NOT shuffle options, because multi-answer scoring
  // depends on the original key positions and the user's selected-key string match.
  // Shuffling would also detach the answer text from the displayed letters.
  const noShuffle = category === 'history' || category === 'party' || category === 'military'
  const questions: Question[] = noShuffle
    ? raw.map((q) => ({ ...q, category: q.category || category }))
    : raw.map((q) => shuffleQuestionOptions({ ...q, category: q.category || category }))
  cache.set(category, questions)
  clearDerivedCaches()
  return questions
}

export function getQuestions(category: Category = 'grammar'): Question[] {
  return cache.get(category) || []
}

export function getQuestionById(id: string): Question | undefined {
  for (const list of cache.values()) {
    const q = list.find(x => x.id === id)
    if (q) return q
  }
  return undefined
}

export function getQuestionsByTag(tag: string, category: Category = 'grammar'): Question[] {
  const list = cache.get(category) || []
  return list.filter(q => q.tags.includes(tag) || q.grammarPoints.includes(tag))
}

export function getQuestionsByGroup(groupId: string, category: Category = 'grammar'): Question[] {
  const list = cache.get(category) || []
  return list.filter(q => q.groupId === groupId)
}

export function getAllGroups(category: Category = 'grammar'): { groupId: string; groupTitle: string; count: number }[] {
  const cached = groupsCache.get(category)
  if (cached) return cached
  const list = cache.get(category) || []
  const map = new Map<string, { groupTitle: string; count: number }>()
  for (const q of list) {
    const existing = map.get(q.groupId)
    if (existing) existing.count++
    else map.set(q.groupId, { groupTitle: q.groupTitle, count: 1 })
  }
  const result = [...map.entries()].map(([groupId, v]) => ({ groupId, groupTitle: v.groupTitle, count: v.count }))
  groupsCache.set(category, result)
  return result
}

export function getAllTags(category: Category = 'grammar'): { tag: string; count: number }[] {
  const cached = tagsCache.get(category)
  if (cached) return cached
  const map = new Map<string, number>()
  const list = cache.get(category) || []
  for (const q of list) {
    for (const t of q.tags) {
      map.set(t, (map.get(t) || 0) + 1)
    }
  }
  const result = [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count)
  tagsCache.set(category, result)
  return result
}

export function getAllGrammarPoints(category: Category = 'grammar'): { point: string; count: number }[] {
  const cached = grammarPointsCache.get(category)
  if (cached) return cached
  const map = new Map<string, number>()
  const list = cache.get(category) || []
  for (const q of list) {
    for (const p of q.grammarPoints) {
      map.set(p, (map.get(p) || 0) + 1)
    }
  }
  const result = [...map.entries()].map(([point, count]) => ({ point, count })).sort((a, b) => b.count - a.count)
  grammarPointsCache.set(category, result)
  return result
}

export function clearDerivedCaches() {
  groupsCache.clear()
  tagsCache.clear()
  grammarPointsCache.clear()
}

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function generateSessionId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function searchQuestions(keyword: string): Question[] {
  const results: Question[] = []
  const lower = keyword.toLowerCase()
  for (const list of cache.values()) {
    for (const q of list) {
      if (q.stem.toLowerCase().includes(lower)) {
        results.push(q)
      }
    }
  }
  return results.slice(0, 50)
}
