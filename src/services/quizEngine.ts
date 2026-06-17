import type { Question, Category } from '../types/question'

const cache = new Map<Category, Question[]>()

export async function loadQuestionBank(category: Category = 'grammar'): Promise<Question[]> {
  const cached = cache.get(category)
  if (cached) return cached
  const base = import.meta.env.BASE_URL
  const file = category === 'word' ? `${base}word-question-bank.json` : `${base}question-bank.json`
  const resp = await fetch(file)
  if (!resp.ok) throw new Error(`无法加载题库 ${file}: ${resp.status}`)
  const questions: Question[] = await resp.json()
  for (const q of questions) {
    if (!q.category) q.category = category
  }
  cache.set(category, questions)
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

export function getAllTags(category: Category = 'grammar'): { tag: string; count: number }[] {
  const map = new Map<string, number>()
  const list = cache.get(category) || []
  for (const q of list) {
    for (const t of q.tags) {
      map.set(t, (map.get(t) || 0) + 1)
    }
  }
  return [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count)
}

export function getAllGrammarPoints(category: Category = 'grammar'): { point: string; count: number }[] {
  const map = new Map<string, number>()
  const list = cache.get(category) || []
  for (const q of list) {
    for (const p of q.grammarPoints) {
      map.set(p, (map.get(p) || 0) + 1)
    }
  }
  return [...map.entries()].map(([point, count]) => ({ point, count })).sort((a, b) => b.count - a.count)
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
