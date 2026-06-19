import type { Category } from '../types/question'
import { db } from '../db/database'
import { loadQuestionBank } from './quizEngine'

export interface Recommendation {
  tag: string
  questionCount: number
  correctRate: number
  wrongCount: number
  priority: number
}

export async function getWeakTags(category: Category = 'grammar'): Promise<Recommendation[]> {
  const allTagStats = await db.tagStats.toArray()

  const allQuestions = await loadQuestionBank(category)
  const tagsInBank = new Set<string>()
  for (const q of allQuestions) {
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

export async function getReviewQueue(category: Category = 'grammar'): Promise<string[]> {
  const allStats = await db.questionStats.toArray()

  const allQuestions = await loadQuestionBank(category)
  const validIds = new Set(allQuestions.map(q => q.id))

  const scored: { id: string; score: number }[] = []
  for (const s of allStats) {
    if (!validIds.has(s.questionId)) continue
    let score = 0
    if (s.masteryLevel <= 1) score += 10
    if (s.masteryLevel === 2) score += 5
    if (!s.lastCorrect && s.attemptCount > 0) score += 8
    if (s.wrongCount >= 2) score += s.wrongCount * 2
    if (s.reviewDueAt && new Date(s.reviewDueAt) <= new Date()) score += 5
    if (s.isBookmarked) score += 3
    scored.push({ id: s.questionId, score })
  }

  return scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.id)
}

export async function getWrongQuestionIds(category: Category = 'grammar'): Promise<string[]> {
  const stats = await db.questionStats.filter(s => s.wrongCount > s.correctCount || s.masteryLevel <= 2).toArray()

  const allQuestions = await loadQuestionBank(category)
  const validIds = new Set(allQuestions.map(q => q.id))
  return stats.filter(s => validIds.has(s.questionId)).sort((a, b) => b.wrongCount - a.wrongCount).map(s => s.questionId)
}

export async function getUntouchedQuestionIds(category: Category = 'grammar'): Promise<string[]> {

  const all = await loadQuestionBank(category)
  const stats = await db.questionStats.toArray()
  const attempted = new Set(stats.filter(s => s.attemptCount > 0).map(s => s.questionId))
  return all.filter(q => !attempted.has(q.id)).map(q => q.id)
}

export async function getMasterySummary(category: Category = 'grammar'): Promise<{ mastered: number; learning: number; weak: number; untouched: number }> {
  const stats = await db.questionStats.toArray()

  const allQuestions = await loadQuestionBank(category)
  const validIds = new Set(allQuestions.map(q => q.id))
  const relevantStats = stats.filter(s => validIds.has(s.questionId))
  const total = allQuestions.length

  const mastered = relevantStats.filter(s => s.masteryLevel >= 4).length
  const learning = relevantStats.filter(s => s.masteryLevel === 2 || s.masteryLevel === 3).length
  const weak = relevantStats.filter(s => s.masteryLevel <= 1).length
  const untouched = total - relevantStats.filter(s => s.attemptCount > 0).length

  return { mastered, learning, weak, untouched }
}
