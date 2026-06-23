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
  activeSession: import('./question').ActiveSession | null
  aiConfig: AIConfig | null
  aiEnabled: boolean
}

/** 所有合法的设置键名 */
export type SettingsKey = keyof SettingsMap
