/**
 * 题目查询层 — 按标签/分组/关键词检索题目
 *
 * 纯读取操作，依赖 questionRepository 的缓存。
 */
import type { Question, Category } from '../types/question'
import { UI } from '../constants'
import { getQuestions } from './questionRepository'

/** 按标签或语法点筛选题目 */
export function getQuestionsByTag(tag: string, category: Category = 'japanese2'): Question[] {
  const list = getQuestions(category)
  return list.filter((q) => q.tags.includes(tag) || q.grammarPoints.includes(tag))
}

/** 按分组 ID 筛选题目 */
export function getQuestionsByGroup(groupId: string, category: Category = 'japanese2'): Question[] {
  const list = getQuestions(category)
  return list.filter((q) => q.groupId === groupId)
}

/**
 * 关键词搜索题目（多字段匹配，支持多关键词）。
 * 搜索范围：题干、词条、标签、语法点、解析、翻译。
 * 支持空格分隔的多关键词（AND 语义）。
 * 结果按相关度排序：题干匹配 > 标签匹配 > 解析匹配。
 * 默认只搜当前 category（~3000 题），传 undefined 搜全库（~12000 题）。
 */
export function searchQuestions(keyword: string, category?: Category): Question[] {
  // 支持多关键词（空格分隔）
  const keywords = keyword
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 0)
  if (keywords.length === 0) return []

  const lists: Question[][] = category
    ? [getQuestions(category)]
    : [
        getQuestions('japanese2'),
        getQuestions('history'),
        getQuestions('party'),
        getQuestions('military'),
      ]

  // 带评分的搜索结果
  const scoredResults: Array<{ question: Question; score: number }> = []

  for (const list of lists) {
    for (const q of list) {
      let score = 0
      let allKeywordsMatch = true

      for (const kw of keywords) {
        let keywordMatch = false
        let keywordScore = 0

        // 题干匹配（最高权重）
        if (q.stem.toLowerCase().includes(kw)) {
          keywordMatch = true
          keywordScore += 10
          // 题干开头匹配额外加分
          if (q.stem.toLowerCase().startsWith(kw)) keywordScore += 5
        }

        // 词条匹配
        if (q.headword && q.headword.toLowerCase().includes(kw)) {
          keywordMatch = true
          keywordScore += 8
        }

        // 标签匹配
        if (q.tags.some((t) => t.toLowerCase().includes(kw))) {
          keywordMatch = true
          keywordScore += 6
        }

        // 语法点匹配
        if (q.grammarPoints.some((g) => g.toLowerCase().includes(kw))) {
          keywordMatch = true
          keywordScore += 6
        }

        // 翻译匹配
        if (q.translation && q.translation.toLowerCase().includes(kw)) {
          keywordMatch = true
          keywordScore += 4
        }

        // 解析匹配（最低权重）
        if (q.explanation && q.explanation.toLowerCase().includes(kw)) {
          keywordMatch = true
          keywordScore += 2
        }

        if (!keywordMatch) {
          allKeywordsMatch = false
          break
        }
        score += keywordScore
      }

      if (allKeywordsMatch) {
        scoredResults.push({ question: q, score })
      }
    }
  }

  // 按分数降序排序
  scoredResults.sort((a, b) => b.score - a.score)

  // 返回排序后的结果（限制数量）
  return scoredResults.slice(0, UI.MAX_SEARCH_RESULTS).map((r) => r.question)
}
