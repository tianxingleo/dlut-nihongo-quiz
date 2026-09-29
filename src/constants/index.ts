/**
 * 统一常量管理
 *
 * 所有散落在各文件中的魔法数字、存储键、UI 阈值等集中定义于此。
 * 新增常量时必须在此文件中添加，禁止在业务代码中直接使用裸字面量。
 */

// ─── 存储键 ────────────────────────────────────────────────
export const STORAGE_KEYS = {
  /** 旧版全站单条会话记录，仅用于迁移读取 */
  ACTIVE_SESSION: 'activeSession',
  /** 按「学科 + 子题库/题单」分开存的会话记录表：paperKey → 会话 */
  ACTIVE_SESSIONS: 'activeSessions',
  HIDDEN_SITE_UNLOCKED: 'hidden-site-unlocked',
  DARK_MODE: 'darkMode',
  DAILY_GOAL: 'dailyGoal',
  ACTIVE_CATEGORY: 'activeCategory',
} as const

// ─── 间隔重复 ──────────────────────────────────────────────
/** masteryLevel 0-5 对应的复习间隔天数 */
export const INTERVAL_DAYS: readonly number[] = [1, 1, 3, 7, 14, 30]

// ─── 评分权重（reviewScheduler 复习队列排序） ──────────────
export const SCORING = {
  /** masteryLevel <= 1 时加分 */
  LOW_MASTERY: 10,
  /** masteryLevel === 2 时加分 */
  MEDIUM_MASTERY: 5,
  /** 上次答错时加分 */
  LAST_WRONG: 8,
  /** wrongCount 的乘数因子 */
  WRONG_MULTIPLIER: 2,
  /** 已到复习时间加分 */
  REVIEW_DUE: 5,
  /** 已收藏加分 */
  BOOKMARKED: 3,
} as const

// ─── UI 常量 ────────────────────────────────────────────────
export const UI = {
  /** PC 端滑动切换题目阈值 (px) */
  SWIPE_THRESHOLD: 56,
  /** 移动端滑动切换题目阈值 (px) */
  SWIPE_THRESHOLD_MOBILE: 40,
  /** 滑动方向锁定阈值 (px) */
  DRAG_LOCK: 10,
  /** 搜索防抖延迟 (ms) */
  SEARCH_DEBOUNCE_MS: 300,
  /** 搜索结果最大数量 */
  MAX_SEARCH_RESULTS: 50,
  /** 长按手势移动取消阈值 (px) */
  LONG_PRESS_MOVE_THRESHOLD: 10,
  /** 每日目标最小值 */
  DAILY_GOAL_MIN: 1,
  /** 每日目标最大值 */
  DAILY_GOAL_MAX: 200,
  /** 错题清除确认超时 (ms) */
  CLEAR_CONFIRM_TIMEOUT: 5000,
  /** 选项字母标签 */
  OPTION_LABELS: ['A', 'B', 'C', 'D', 'E'] as const,
  /** 薄弱标签在首页最多展示数 */
  WEAK_TAGS_MAX: 8,
  /** 热力图档位阈值与对应的等级 */
  HEATMAP_LEVELS: [
    { min: 16, level: 3 },
    { min: 6, level: 2 },
    { min: 1, level: 1 },
    { min: 0, level: 0 },
  ] as const,
} as const

// ─── 缓存 ──────────────────────────────────────────────────
export const CACHE = {
  /** Markdown 渲染缓存上限 */
  MAX_RENDER_CACHE: 500,
} as const

// ─── 会话管理 ──────────────────────────────────────────────
export const SESSION = {
  /** 会话过期时间（毫秒）：24 小时 */
  MAX_AGE_MS: 24 * 60 * 60 * 1000,
} as const

// ─── 答题模式 ──────────────────────────────────────────────
export const QUIZ_MODES = [
  'sequential',
  'random',
  'wrong',
  'untouched',
  'tag',
  'weakness',
  'exam',
] as const

export type QuizMode = (typeof QUIZ_MODES)[number]
