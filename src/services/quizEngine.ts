/**
 * quizEngine — 统一入口（barrel re-export）
 *
 * 为保持向后兼容，所有原有导出均从此文件可访问。
 * 新代码建议直接从各子模块导入：
 *   - questionRepository: 加载/缓存/洗牌/可见性
 *   - questionQuery: 按标签/分组/搜索
 *   - questionAggregate: 统计聚合/计数/相关数据
 */

// 仓库层
export {
  HIDDEN_GROUP_IDS,
  filterVisibleQuestions,
  shuffleArray,
  shuffleQuestionOptions,
  loadQuestionBank,
  getQuestions,
  getQuestionById,
  generateSessionId,
  clearDerivedCaches,
  invalidateCache,
} from './questionRepository'

// 查询层
export { getQuestionsByTag, getQuestionsByGroup, searchQuestions } from './questionQuery'

// 聚合层
export {
  getAllGroups,
  getAllTags,
  getAllGrammarPoints,
  getCategoryCounts,
  getRelevantData,
  type RelevantData,
} from './questionAggregate'

// 从其他模块透传的便捷导出
export { toggleMultiSelect, isMultiAnswerCorrect } from '../utils/multiAnswer'
export { getCategoryMeta } from '../config/categories'
