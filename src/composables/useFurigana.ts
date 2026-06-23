/**
 * 日语假名注音 composable
 * 提供响应式的注音状态管理，支持开关、加载状态、设置持久化
 */

import { ref } from 'vue'
import { initFurigana, addFurigana } from '../utils/furigana'

// 全局状态（所有组件共享）
const furiganaEnabled = ref(false)
const isLoading = ref(false)
const isReady = ref(false)
const error = ref<string | null>(null)

// 初始化标记
let hasRestoredState = false

/**
 * 从 localStorage 恢复状态
 */
function restoreState() {
  if (hasRestoredState) return
  hasRestoredState = true

  try {
    const saved = localStorage.getItem('furigana-enabled')
    if (saved === 'true') {
      furiganaEnabled.value = true
    }
  } catch {
    // localStorage 不可用时忽略
  }
}

/**
 * 保存状态到 localStorage
 */
function saveState(enabled: boolean) {
  try {
    localStorage.setItem('furigana-enabled', String(enabled))
  } catch {
    // localStorage 不可用时忽略
  }
}

/**
 * 日语假名注音 composable
 */
export function useFurigana() {
  // 首次使用时恢复状态
  restoreState()

  /**
   * 预加载 kuroshiro 字典
   */
  async function preload() {
    if (isReady.value) return
    if (isLoading.value) return

    isLoading.value = true
    error.value = null

    try {
      await initFurigana()
      isReady.value = true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load furigana'
      console.error('Failed to preload furigana:', err)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 切换注音开关
   */
  async function toggle() {
    // 如果要启用注音但尚未加载字典，先加载
    if (!furiganaEnabled.value && !isReady.value) {
      await preload()
    }

    furiganaEnabled.value = !furiganaEnabled.value
    saveState(furiganaEnabled.value)
  }

  /**
   * 为 HTML 添加注音
   * @param html 原始 HTML 字符串
   * @returns 添加注音后的 HTML，如果注音未启用则返回原始 HTML
   */
  async function processHtml(html: string): Promise<string> {
    if (!furiganaEnabled.value) {
      return html
    }

    if (!isReady.value) {
      await preload()
    }

    if (!isReady.value) {
      // 加载失败，返回原始 HTML
      return html
    }

    return addFurigana(html)
  }

  /**
   * 启用注音
   */
  async function enable() {
    if (furiganaEnabled.value) return

    if (!isReady.value) {
      await preload()
    }

    furiganaEnabled.value = true
    saveState(true)
  }

  /**
   * 禁用注音
   */
  function disable() {
    furiganaEnabled.value = false
    saveState(false)
  }

  return {
    // 状态
    furiganaEnabled,
    isLoading,
    isReady,
    error,

    // 方法
    preload,
    toggle,
    processHtml,
    enable,
    disable,
  }
}
