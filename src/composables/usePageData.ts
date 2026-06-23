/**
 * 统一页面数据加载模式
 *
 * 封装了各页面重复出现的 loading/error/refresh + 自动监听 activeCategory/isUnlocked 模式。
 * 使用方式：
 *   const { data, loading, error, refresh } = usePageData(loader)
 *
 * @param loader 数据加载函数，返回 Promise<T>
 * @param options.watchCategory 是否监听 activeCategory 变化（默认 true）
 * @param options.watchUnlocked 是否监听 isUnlocked 变化（默认 true）
 */
import { ref, onMounted, watch } from 'vue'
import type { Ref } from 'vue'
import { useActiveCategory, loadActiveCategory } from '../services/categoryStore'
import { useHiddenSite } from './useHiddenSite'

interface UsePageDataOptions {
  /** 是否在 activeCategory 变化时自动刷新（默认 true） */
  watchCategory?: boolean
  /** 是否在 isUnlocked 变化时自动刷新（默认 true） */
  watchUnlocked?: boolean
}

export function usePageData<T>(loader: () => Promise<T>, options: UsePageDataOptions = {}) {
  const { watchCategory = true, watchUnlocked = true } = options

  const data: Ref<T | null> = ref(null) as Ref<T | null>
  const loading = ref(true)
  const error = ref('')

  const activeCategory = useActiveCategory()
  const { isUnlocked } = useHiddenSite()

  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      data.value = await loader()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载失败，请刷新页面重试'
    } finally {
      loading.value = false
    }
  }

  onMounted(async () => {
    await loadActiveCategory()
    await refresh()
  })

  if (watchCategory) {
    watch(activeCategory, () => refresh())
  }

  if (watchUnlocked) {
    watch(isUnlocked, () => refresh())
  }

  return { data, loading, error, refresh }
}
