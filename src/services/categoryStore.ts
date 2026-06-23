import { ref } from 'vue'
import type { Ref } from 'vue'
import { getSetting, setSetting } from '../db/database'
import type { Category } from '../types/question'

const activeCategory: Ref<Category> = ref<Category>('japanese2')
const activeSubBankKey: Ref<string | null> = ref<string | null>(null)
let loaded = false

// 旧值 word/grammar 在 v0.4 合并到 japanese2 后已废弃，自动迁移到 japanese2。
function migrateLegacy(value: string | undefined): Category {
  if (value === 'word' || value === 'grammar') return 'japanese2'
  return (value as Category) || 'japanese2'
}

export async function loadActiveCategory(): Promise<Category> {
  if (!loaded) {
    const stored = await getSetting<string | undefined>(
      'activeCategory',
      undefined as unknown as string,
    )
    activeCategory.value = migrateLegacy(stored)
    loaded = true
  }
  return activeCategory.value
}

export async function setActiveCategory(cat: Category): Promise<void> {
  activeCategory.value = cat
  activeSubBankKey.value = null
  await setSetting('activeCategory', cat)
}

export function getActiveCategory(): Category {
  return activeCategory.value
}

export function useActiveCategory(): Ref<Category> {
  return activeCategory
}

export function getActiveSubBankKey(): string | null {
  return activeSubBankKey.value
}

export function setActiveSubBankKey(key: string | null): void {
  activeSubBankKey.value = key
}

export function useActiveSubBankKey(): Ref<string | null> {
  return activeSubBankKey
}
