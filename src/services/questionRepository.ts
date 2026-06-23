/**
 * 题库仓库层 — 负责题库加载、缓存、ID 索引、洗牌、可见性过滤
 *
 * 这是纯数据层，不包含业务逻辑（统计、搜索等）。
 * 其他模块通过 getQuestions() / getQuestionById() 访问缓存数据。
 */
import type { Question, Category } from '../types/question'
import { CATEGORIES, NO_SHUFFLE_CATEGORIES } from '../config/categories'

// ─── 内部状态 ──────────────────────────────────────────────
const cache = new Map<Category, Question[]>()
const idIndex = new Map<string, Question>()
const inflight = new Map<Category, Promise<Question[]>>()

const BANK_FILES: Record<Category, string> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.key] = c.bankFile
    return acc
  },
  {} as Record<Category, string>,
)

// ─── 里站可见性 ────────────────────────────────────────────
/** 里站专属 groupId：所有 requireUnlock subBank 的 groupOrder 并集 */
export const HIDDEN_GROUP_IDS: ReadonlySet<string> = new Set(
  CATEGORIES.flatMap((c) => c.subBanks ?? [])
    .filter((sb) => sb.requireUnlock)
    .flatMap((sb) => sb.groupOrder),
)

export function filterVisibleQuestions(questions: Question[], isUnlocked: boolean): Question[] {
  if (isUnlocked) return questions
  return questions.filter((q) => !HIDDEN_GROUP_IDS.has(q.groupId))
}

// ─── 洗牌 ─────────────────────────────────────────────────
export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
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

// ─── 加载与缓存 ────────────────────────────────────────────

/** 清除所有派生缓存（groups/tags/grammarPoints），在题库重新加载时调用 */
export function clearDerivedCaches() {
  // 由 questionAggregate 模块注册的回调
  for (const cb of clearCacheCallbacks) cb()
}

const clearCacheCallbacks: (() => void)[] = []
export function onClearDerivedCaches(cb: () => void) {
  clearCacheCallbacks.push(cb)
}

/**
 * 加载题库 JSON 并缓存。
 * history/party/military 选项固定位置（多答案判分依赖原始 key）。
 * 内置并发保护：同一 category 的多次同时调用只会触发一次 fetch。
 */
export async function loadQuestionBank(category: Category = 'japanese2'): Promise<Question[]> {
  const cached = cache.get(category)
  if (cached) return cached
  // 并发保护：如果已有正在进行的加载，复用同一个 Promise
  const pending = inflight.get(category)
  if (pending) return pending
  const promise = doLoad(category)
  inflight.set(category, promise)
  try {
    return await promise
  } finally {
    inflight.delete(category)
  }
}

async function doLoad(category: Category): Promise<Question[]> {
  const base = import.meta.env.BASE_URL
  const file = `${base}${BANK_FILES[category]}`
  const resp = await fetch(file)
  if (!resp.ok) throw new Error(`无法加载题库 ${file}: ${resp.status}`)
  const raw: Question[] = await resp.json()
  const questions: Question[] = NO_SHUFFLE_CATEGORIES.has(category)
    ? raw.map((q) => ({ ...q, category: q.category || category }))
    : raw.map((q) => shuffleQuestionOptions({ ...q, category: q.category || category }))
  cache.set(category, questions)
  for (const q of questions) {
    idIndex.set(q.id, q)
  }
  clearDerivedCaches()
  return questions
}

/** 获取已缓存的题目列表（同步，不触发加载） */
export function getQuestions(category: Category = 'japanese2'): Question[] {
  return cache.get(category) || []
}

/** 按 ID 获取单题（O(1) 索引查找） */
export function getQuestionById(id: string): Question | undefined {
  return idIndex.get(id)
}

/** 生成会话 ID */
export function generateSessionId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 清除指定分类的缓存，或清除所有缓存。
 * 用于开发环境热更新或题库更新后强制刷新。
 */
export function invalidateCache(category?: Category): void {
  if (category) {
    cache.delete(category)
    // 清除该分类的 idIndex 条目
    const questions = getQuestions(category)
    for (const q of questions) {
      idIndex.delete(q.id)
    }
  } else {
    cache.clear()
    idIndex.clear()
  }
  clearDerivedCaches()
}
