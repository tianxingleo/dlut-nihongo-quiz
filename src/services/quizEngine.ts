import type { Question, Category, QuestionStats } from '../types/question'
import { CATEGORIES, NO_SHUFFLE_CATEGORIES, getCategoryMeta } from '../config/categories'
import { isMultiAnswerCorrect, toggleMultiSelect } from '../utils/multiAnswer'
import { db } from '../db/database'

const cache = new Map<Category, Question[]>()
const groupsCache = new Map<Category, { groupId: string; groupTitle: string; count: number }[]>()
const tagsCache = new Map<Category, { tag: string; count: number }[]>()
const grammarPointsCache = new Map<Category, { point: string; count: number }[]>()

const BANK_FILES: Record<Category, string> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.key] = c.bankFile
    return acc
  },
  {} as Record<Category, string>,
)

// 里站专属 groupId：所有 requireUnlock subBank 的 groupOrder 并集。
// 表站未解锁时，所有表站页面与答题流都应过滤掉这些题。
export const HIDDEN_GROUP_IDS: ReadonlySet<string> = new Set(
  CATEGORIES.flatMap((c) => c.subBanks ?? [])
    .filter((sb) => sb.requireUnlock)
    .flatMap((sb) => sb.groupOrder),
)

export function filterVisibleQuestions(questions: Question[], isUnlocked: boolean): Question[] {
  if (isUnlocked) return questions
  return questions.filter((q) => !HIDDEN_GROUP_IDS.has(q.groupId))
}

export function shuffleQuestionOptions(q: Question): Question {
  if (q.multiAnswer) return q
  const correctOpt = q.options.find((o) => o.key === q.answerKey)
  if (!correctOpt) return q
  const shuffled = shuffleArray(q.options)
  const correctIdx = shuffled.findIndex((o) => o.key === q.answerKey)
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

export async function loadQuestionBank(category: Category = 'japanese2'): Promise<Question[]> {
  const cached = cache.get(category)
  if (cached) return cached
  const base = import.meta.env.BASE_URL
  const file = `${base}${BANK_FILES[category]}`
  const resp = await fetch(file)
  if (!resp.ok) throw new Error(`无法加载题库 ${file}: ${resp.status}`)
  const raw: Question[] = await resp.json()
  // history/party/military 选项固定位置：多答案判分依赖原始 key 与 selected 字符串匹配，
  // 打乱会让选项字母与答案文字错位。
  const questions: Question[] = NO_SHUFFLE_CATEGORIES.has(category)
    ? raw.map((q) => ({ ...q, category: q.category || category }))
    : raw.map((q) => shuffleQuestionOptions({ ...q, category: q.category || category }))
  cache.set(category, questions)
  clearDerivedCaches()
  return questions
}

export function getQuestions(category: Category = 'japanese2'): Question[] {
  return cache.get(category) || []
}

export function getQuestionById(id: string): Question | undefined {
  for (const list of cache.values()) {
    const q = list.find((x) => x.id === id)
    if (q) return q
  }
  return undefined
}

export function getQuestionsByTag(tag: string, category: Category = 'japanese2'): Question[] {
  const list = cache.get(category) || []
  return list.filter((q) => q.tags.includes(tag) || q.grammarPoints.includes(tag))
}

export function getQuestionsByGroup(groupId: string, category: Category = 'japanese2'): Question[] {
  const list = cache.get(category) || []
  return list.filter((q) => q.groupId === groupId)
}

export function getAllGroups(
  category: Category = 'japanese2',
): { groupId: string; groupTitle: string; count: number }[] {
  const cached = groupsCache.get(category)
  if (cached) return cached
  const list = cache.get(category) || []
  const map = new Map<string, { groupTitle: string; count: number }>()
  for (const q of list) {
    const existing = map.get(q.groupId)
    if (existing) existing.count++
    else map.set(q.groupId, { groupTitle: q.groupTitle, count: 1 })
  }
  const result = [...map.entries()].map(([groupId, v]) => ({
    groupId,
    groupTitle: v.groupTitle,
    count: v.count,
  }))
  groupsCache.set(category, result)
  return result
}

export function getAllTags(category: Category = 'japanese2'): { tag: string; count: number }[] {
  const cached = tagsCache.get(category)
  if (cached) return cached
  const map = new Map<string, number>()
  const list = cache.get(category) || []
  for (const q of list) {
    for (const t of q.tags) {
      map.set(t, (map.get(t) || 0) + 1)
    }
  }
  const result = [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
  tagsCache.set(category, result)
  return result
}

export function getAllGrammarPoints(
  category: Category = 'japanese2',
): { point: string; count: number }[] {
  const cached = grammarPointsCache.get(category)
  if (cached) return cached
  const map = new Map<string, number>()
  const list = cache.get(category) || []
  for (const q of list) {
    for (const p of q.grammarPoints) {
      map.set(p, (map.get(p) || 0) + 1)
    }
  }
  const result = [...map.entries()]
    .map(([point, count]) => ({ point, count }))
    .sort((a, b) => b.count - a.count)
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

// 默认只搜当前 category（~3000 题以内），scope='all' 才扫全库（~12000 题）。
// 限制扫描范围能把首字延迟从 ~30ms 降到 ~5ms，且大多数用户找的就是当前学科的题。
export function searchQuestions(keyword: string, category?: Category): Question[] {
  const lower = keyword.toLowerCase()
  const lists: Question[][] = category ? [cache.get(category) || []] : [...cache.values()]
  const results: Question[] = []
  for (const list of lists) {
    for (const q of list) {
      if (q.stem.toLowerCase().includes(lower)) {
        results.push(q)
        if (results.length >= 50) return results
      }
    }
  }
  return results
}

export async function getCategoryCounts(): Promise<Record<Category, number>> {
  const entries = await Promise.all(
    CATEGORIES.map(async (c) => [c.key, (await loadQuestionBank(c.key)).length] as const),
  )
  return entries.reduce(
    (acc, [k, n]) => {
      acc[k] = n
      return acc
    },
    {} as Record<Category, number>,
  )
}

// 把"题库 + 该分类相关 stats"打包，调用方一次返回，避免各页面各扫一遍。
export interface RelevantData {
  questions: Question[]
  stats: QuestionStats[]
  statsMap: Map<string, QuestionStats>
}

export async function getRelevantData(
  category: Category,
  allStats?: QuestionStats[],
  options?: { isUnlocked?: boolean },
): Promise<RelevantData> {
  const [allQuestions, stats] = await Promise.all([
    loadQuestionBank(category),
    allStats ?? db.questionStats.toArray(),
  ])
  const questions =
    options?.isUnlocked === false ? filterVisibleQuestions(allQuestions, false) : allQuestions
  const validIds = new Set(questions.map((q) => q.id))
  const filtered = stats.filter((s) => validIds.has(s.questionId))
  return { questions, stats: filtered, statsMap: new Map(filtered.map((s) => [s.questionId, s])) }
}

export { toggleMultiSelect, isMultiAnswerCorrect, getCategoryMeta }
