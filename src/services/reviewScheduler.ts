import type { Category, QuestionStats } from '../types/question'
import { db } from '../db/database'
import { INTERVAL_DAYS, SCORING } from '../constants'
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

// 间隔重复：按 masteryLevel 和历史正确率动态计算下次到期天数。
// recordAttempt 会写入 reviewDueAt，此处优先使用数据库值，兜底派生计算（兼容旧数据）。
export function deriveReviewDueAt(s: QuestionStats): string {
  // 优先使用数据库中已存储的值（recordAttempt 会写入）
  if (s.reviewDueAt) return s.reviewDueAt
  // 兜底：兼容旧数据（reviewDueAt 为空时派生计算）
  if (!s.lastAttemptAt) return ''
  const days = calcIntervalDays(s)
  return new Date(new Date(s.lastAttemptAt).getTime() + days * 86_400_000).toISOString()
}

// 根据 masteryLevel 和历史正确率动态计算复习间隔天数（简化版 SM-2 算法）
function calcIntervalDays(s: QuestionStats): number {
  const base = INTERVAL_DAYS[s.masteryLevel] ?? 1
  // 如果没有答题记录，使用基础间隔
  if (s.attemptCount === 0) return base

  // 计算简易因子（EF）- 类似 SM-2 算法
  // EF 根据连续正确次数和正确率动态调整
  const correctRate = s.correctCount / s.attemptCount
  const consecutiveCorrect = estimateConsecutiveCorrect(s)

  // 基础 EF 值（1.0 = 标准间隔，>1.0 延长，<1.0 缩短）
  let ef = 1.0

  // 根据正确率调整 EF
  if (correctRate >= 0.9) {
    ef *= 1.6 // 高正确率，显著延长间隔
  } else if (correctRate >= 0.7) {
    ef *= 1.3 // 中高正确率，适度延长
  } else if (correctRate >= 0.5) {
    ef *= 1.0 // 中等正确率，保持基础
  } else {
    ef *= 0.6 // 低正确率，缩短间隔
  }

  // 根据连续正确次数进一步调整
  if (consecutiveCorrect >= 5) {
    ef *= 1.2 // 连续正确多次，额外延长
  } else if (consecutiveCorrect >= 3) {
    ef *= 1.1
  }

  // 应用 EF 到基础间隔
  return Math.max(1, Math.round(base * ef))
}

// 估算连续正确次数（基于 lastCorrect 和 masteryLevel）
function estimateConsecutiveCorrect(s: QuestionStats): number {
  if (!s.lastCorrect) return 0
  // 如果上次答对，根据 masteryLevel 估算连续正确次数
  // masteryLevel 越高，连续正确次数越多
  return Math.max(1, s.masteryLevel)
}

export function isReviewDue(s: QuestionStats, now: Date = new Date()): boolean {
  const due = deriveReviewDueAt(s)
  return !!due && new Date(due) <= now
}

export async function getWeakTags(
  category: Category = 'japanese2',
  options?: { isUnlocked?: boolean },
): Promise<Recommendation[]> {
  // tagStats 与 questionStats 不在同一张表，无法共享预扫描
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
    if (s.masteryLevel <= 1) score += SCORING.LOW_MASTERY
    if (s.masteryLevel === 2) score += SCORING.MEDIUM_MASTERY
    if (!s.lastCorrect && s.attemptCount > 0) score += SCORING.LAST_WRONG
    if (s.wrongCount >= 2) score += s.wrongCount * SCORING.WRONG_MULTIPLIER
    if (isReviewDue(s)) score += SCORING.REVIEW_DUE
    if (s.isBookmarked) score += SCORING.BOOKMARKED
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
