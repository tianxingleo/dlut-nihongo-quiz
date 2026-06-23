import type { Category, QuestionStats } from '../types/question'
import { db, INTERVAL_DAYS } from '../db/database'
import { loadQuestionBank, getRelevantData, filterVisibleQuestions } from './quizEngine'

export interface Recommendation {
  tag: string
  questionCount: number
  correctRate: number
  wrongCount: number
  priority: number
}

// 错题统一口径：做错过 (wrongCount > 0) 且当前未恢复到掌握。
// HomePage/WrongBook/复习队列都用这个，避免显示数和实际队列不匹配。
export function isWrong(s: QuestionStats): boolean {
  return s.wrongCount > 0 && (s.wrongCount >= s.correctCount || s.masteryLevel <= 2)
}

// 间隔重复：按 masteryLevel 查表得到下次到期天数。
// recordAttempt 会写入 reviewDueAt，此处优先使用数据库值，兜底派生计算（兼容旧数据）。
export function deriveReviewDueAt(s: QuestionStats): string {
  // 优先使用数据库中已存储的值（recordAttempt 会写入）
  if (s.reviewDueAt) return s.reviewDueAt
  // 兜底：兼容旧数据（reviewDueAt 为空时派生计算）
  if (!s.lastAttemptAt) return ''
  const days = INTERVAL_DAYS[s.masteryLevel] ?? 1
  return new Date(new Date(s.lastAttemptAt).getTime() + days * 86_400_000).toISOString()
}

export function isReviewDue(s: QuestionStats, now: Date = new Date()): boolean {
  const due = deriveReviewDueAt(s)
  return !!due && new Date(due) <= now
}

export async function getWeakTags(
  category: Category = 'japanese2',
  _allStats?: QuestionStats[],
  options?: { isUnlocked?: boolean },
): Promise<Recommendation[]> {
  // tagStats 与 questionStats 不在同一张表，无法共享预扫描；保留可选参数仅为 API 对齐其他函数。
  void _allStats
  const [allTagStats, allQuestions] = await Promise.all([
    db.tagStats.toArray(),
    loadQuestionBank(category),
  ])
  const visibleQuestions = filterVisibleQuestions(allQuestions, options?.isUnlocked !== false)
  const tagsInBank = new Set<string>()
  for (const q of visibleQuestions) {
    for (const t of q.tags) tagsInBank.add(t)
    for (const g of q.grammarPoints) tagsInBank.add(g)
  }

  const results: Recommendation[] = []
  for (const tagStat of allTagStats) {
    if (tagStat.attemptCount === 0) continue
    if (!tagsInBank.has(tagStat.tag)) continue
    const rate = tagStat.correctCount / tagStat.attemptCount
    results.push({
      tag: tagStat.tag,
      questionCount: tagStat.attemptCount,
      correctRate: Math.round(rate * 100),
      wrongCount: tagStat.wrongCount,
      priority: tagStat.wrongCount * 3 + (1 - rate) * 10,
    })
  }

  return results.sort((a, b) => b.priority - a.priority).slice(0, 8)
}

export async function getReviewQueue(
  category: Category = 'japanese2',
  allStats?: QuestionStats[],
  options?: { isUnlocked?: boolean },
): Promise<string[]> {
  const { stats } = await getRelevantData(category, allStats, options)
  const scored: { id: string; score: number }[] = []
  for (const s of stats) {
    let score = 0
    if (s.masteryLevel <= 1) score += 10
    if (s.masteryLevel === 2) score += 5
    if (!s.lastCorrect && s.attemptCount > 0) score += 8
    if (s.wrongCount >= 2) score += s.wrongCount * 2
    if (isReviewDue(s)) score += 5
    if (s.isBookmarked) score += 3
    if (score > 0) scored.push({ id: s.questionId, score })
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.id)
}

export async function getWrongQuestionIds(
  category: Category = 'japanese2',
  allStats?: QuestionStats[],
  options?: { isUnlocked?: boolean },
): Promise<string[]> {
  const { stats } = await getRelevantData(category, allStats, options)
  return stats
    .filter(isWrong)
    .sort((a, b) => b.wrongCount - a.wrongCount)
    .map((s) => s.questionId)
}

export async function getUntouchedQuestionIds(
  category: Category = 'japanese2',
  allStats?: QuestionStats[],
  options?: { isUnlocked?: boolean },
): Promise<string[]> {
  const { questions, statsMap } = await getRelevantData(category, allStats, options)
  return questions
    .filter((q) => !statsMap.has(q.id) || statsMap.get(q.id)!.attemptCount === 0)
    .map((q) => q.id)
}

export async function getMasterySummary(
  category: Category = 'japanese2',
  allStats?: QuestionStats[],
  options?: { isUnlocked?: boolean },
): Promise<{ mastered: number; learning: number; weak: number; untouched: number }> {
  const { questions, stats } = await getRelevantData(category, allStats, options)
  const total = questions.length
  let mastered = 0,
    learning = 0,
    weak = 0,
    attempted = 0
  for (const s of stats) {
    if (s.masteryLevel >= 4) mastered++
    else if (s.masteryLevel >= 2) learning++
    else weak++
    if (s.attemptCount > 0) attempted++
  }
  return { mastered, learning, weak, untouched: total - attempted }
}
