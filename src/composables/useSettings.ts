/**
 * 类型安全的设置访问
 *
 * 封装 darkMode / dailyGoal 的读写与主题切换，消除 SettingsPage 和 HomePage 中的重复逻辑。
 */
import { ref, onMounted } from 'vue'
import { getSetting, setSetting } from '../db/database'
import { STORAGE_KEYS } from '../constants'

const darkMode = ref(false)
const dailyGoal = ref(30)
let initialized = false

function applyTheme() {
  // 添加过渡动画
  document.documentElement.style.transition = 'background-color 0.3s ease, color 0.3s ease'
  document.documentElement.setAttribute('data-theme', darkMode.value ? 'dark' : 'light')
  // 动画结束后移除过渡，避免影响其他样式变化
  setTimeout(() => {
    document.documentElement.style.transition = ''
  }, 300)
}

async function loadSettings() {
  darkMode.value = await getSetting(STORAGE_KEYS.DARK_MODE, false)
  dailyGoal.value = await getSetting(STORAGE_KEYS.DAILY_GOAL, 30)
  applyTheme()
  initialized = true
}

async function toggleDark() {
  darkMode.value = !darkMode.value
  await setSetting(STORAGE_KEYS.DARK_MODE, darkMode.value)
  applyTheme()
}

async function saveDailyGoal(val?: number) {
  const finalVal = val ?? dailyGoal.value
  const clamped = Math.max(1, Math.min(200, Math.round(finalVal)))
  dailyGoal.value = clamped
  await setSetting(STORAGE_KEYS.DAILY_GOAL, clamped)
}

export function useSettings() {
  // 仅首次调用时加载，后续共享同一份 ref
  onMounted(async () => {
    if (!initialized) {
      await loadSettings()
    }
  })

  return {
    darkMode,
    dailyGoal,
    toggleDark,
    saveDailyGoal,
    applyTheme,
    loadSettings,
  }
}
