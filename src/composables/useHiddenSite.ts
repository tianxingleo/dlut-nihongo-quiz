import { ref } from 'vue'
import { STORAGE_KEYS } from '../constants'

const STORAGE_KEY = STORAGE_KEYS.HIDDEN_SITE_UNLOCKED

// 初始化时从 sessionStorage 恢复状态（刷新后保持解锁，但关闭标签页后清除）
const isUnlocked = ref(sessionStorage.getItem(STORAGE_KEY) === 'true')
const unlockProgress = ref(0)

let pressTimer: ReturnType<typeof setInterval> | null = null

export function useHiddenSite() {
  function startLongPress() {
    if (isUnlocked.value) return
    unlockProgress.value = 0
    pressTimer = setInterval(() => {
      unlockProgress.value += 2
      if (unlockProgress.value >= 100) {
        unlockProgress.value = 100
        cancelLongPress()
        isUnlocked.value = true
        // 持久化到 sessionStorage（刷新后保持，关闭标签页后清除）
        sessionStorage.setItem(STORAGE_KEY, 'true')
      }
    }, 100)
  }

  function cancelLongPress() {
    if (pressTimer) {
      clearInterval(pressTimer)
      pressTimer = null
    }
    if (unlockProgress.value < 100) {
      unlockProgress.value = 0
    }
  }

  function lock() {
    isUnlocked.value = false
    sessionStorage.removeItem(STORAGE_KEY)
  }

  return {
    isUnlocked,
    unlockProgress,
    startLongPress,
    cancelLongPress,
    lock,
  }
}
