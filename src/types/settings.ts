/**
 * 设置键 → 值类型的映射
 *
 * 用于 getSetting<T>() / setSetting() 的类型约束。
 * 新增设置项时在此添加键值对即可。
 */
import type { Category } from './question'
import type { AIConfig } from './ai'

export interface SettingsMap {
  activeCategory: Category
  darkMode: boolean
  dailyGoal: number
  /** 旧版全站单条会话记录，仅用于迁移读取，迁移后置空 */
  activeSession: import('./question').ActiveSession | null
  /** 按「学科 + 子题库/题单」分开存的会话记录表：paperKey → 未完成的会话 */
  activeSessions: Record<string, import('./question').ActiveSession>
  aiConfig: AIConfig | null
  aiEnabled: boolean
}

/** 所有合法的设置键名 */
export type SettingsKey = keyof SettingsMap
