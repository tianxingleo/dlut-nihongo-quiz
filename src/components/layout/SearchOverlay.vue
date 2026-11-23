<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { searchCatalog } from '../../services/questionCatalog'
import { useHiddenSite } from '../../composables/useHiddenSite'
import { useActiveCategory } from '../../services/categoryStore'
import { getCategoryMeta } from '../../config/categories'
import { UI } from '../../constants'
import { escapeHtml } from '../../utils/html'
import { truncate } from '../../utils/text'
import { stripMarkdown } from '../../utils/renderMarkdown'
import type { Question } from '../../types/question'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  navigate: [questionId: string, category: Question['category']]
}>()

const keyword = ref('')
const results = ref<Awaited<ReturnType<typeof searchCatalog>>['results']>([])
const loading = ref(false)
const partial = ref(false)
const includeExplanations = ref(false)
const { isUnlocked } = useHiddenSite()
let revision = 0
const panel = ref<HTMLElement>()
const inputRef = ref<HTMLInputElement | null>(null)
const scopeAll = ref(true)
const activeCategory = useActiveCategory()
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function doSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  const request = ++revision
  const val = keyword.value.trim()
  results.value = []
  partial.value = false
  loading.value = Boolean(val && props.visible)
  if (!loading.value) return
  debounceTimer = setTimeout(async () => {
    try {
      const data = await searchCatalog(val, {
        unlocked: isUnlocked.value,
        category: scopeAll.value ? undefined : activeCategory.value,
        includeExplanations: includeExplanations.value,
      })
      if (revision !== request) return
      results.value = data.results
      partial.value = data.partial
    } catch {
      if (revision === request) partial.value = true
    } finally {
      if (revision === request) loading.value = false
    }
  }, UI.SEARCH_DEBOUNCE_MS)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  if (e.key !== 'Tab') return
  const items = panel.value?.querySelectorAll<HTMLElement>('input, button')
  if (!items?.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (document.activeElement === (e.shiftKey ? first : last)) {
    e.preventDefault()
    const next = e.shiftKey ? last : first
    next.focus()
  }
}

watch([keyword, scopeAll, includeExplanations, isUnlocked, activeCategory], doSearch)

watch(
  () => props.visible,
  (v) => {
    if (v) {
      nextTick(() => inputRef.value?.focus())
    } else {
      keyword.value = ''
      doSearch()
    }
  },
)

onUnmounted(() => {
  revision++
  if (debounceTimer) clearTimeout(debounceTimer)
})

function onBackdropClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('search-backdrop')) {
    emit('close')
  }
}

const scopeLabel = () => (scopeAll.value ? '全库' : getCategoryMeta(activeCategory.value).short)

function highlightMatch(text: string, kw: string): string {
  if (!kw.trim()) return escapeHtml(text)
  const escaped = escapeHtml(text)
  const kwEscaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escaped.replace(new RegExp(`(${kwEscaped})`, 'gi'), '<mark>$1</mark>')
}
</script>
<template>
  <div v-if="visible" class="search-backdrop" @click="onBackdropClick">
    <div
      ref="panel"
      class="search-panel"
      role="dialog"
      aria-modal="true"
      aria-label="搜索题目"
      @keydown.stop="handleKeydown"
    >
      <div class="search-input-wrap">
        <span class="search-icon">⌕</span>
        <input
          ref="inputRef"
          v-model="keyword"
          class="search-input"
          placeholder="搜索题目…"
          aria-label="搜索题目"
          autocomplete="off"
          spellcheck="false"
        />
        <button
          class="search-scope-btn"
          :class="{ active: scopeAll }"
          :title="
            scopeAll
              ? '当前在搜全部可见题库，点击只搜当前学科'
              : '当前只搜 ' + scopeLabel() + '，点击切到全库'
          "
          @click="scopeAll = !scopeAll"
        >
          {{ scopeAll ? '全库' : scopeLabel() }}
        </button>
        <button class="search-close-btn" aria-label="关闭搜索" @click="emit('close')">✕</button>
      </div>
      <label class="search-options"
        ><input v-model="includeExplanations" type="checkbox" /> 同时搜索解析</label
      >
      <div class="search-body">
        <div v-if="loading" class="search-empty" role="status">搜索索引加载中…</div>
        <div v-if="partial" class="search-empty" role="status">索引暂不可用，仅搜索已缓存内容</div>
        <div
          v-if="results.length > 0"
          class="search-results"
          aria-label="搜索结果"
          aria-live="polite"
          aria-atomic="true"
        >
          <button
            v-for="q in results"
            type="button"
            :key="q.id"
            class="search-result-item"
            :aria-label="`${q.groupTitle}：${q.stem.slice(0, 60)}`"
            @click="emit('navigate', q.id, q.category)"
          >
            <span class="sr-id">{{ q.id }}</span>
            <span class="sr-content">
              <span class="sr-group">{{ q.groupTitle }}</span>
              <span
                class="sr-stem"
                v-html="highlightMatch(truncate(stripMarkdown(q.stem), 60), keyword)"
              ></span>
            </span>
          </button>
        </div>
        <div v-else-if="!loading && !partial && keyword.trim()" class="search-empty">
          未找到相关题目
        </div>
        <div v-else-if="!keyword.trim()" class="search-hint">输入关键词搜索题目</div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.search-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1000;
  display: flex;
  justify-content: center;
  padding-top: 80px;
}

.search-options {
  padding: 0 16px 12px;
}
.search-result-item {
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
}
.search-panel {
  width: 100%;
  max-width: 560px;
  max-height: 70vh;
  background: var(--bg-card);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  align-self: flex-start;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.search-icon {
  font-size: 20px;
  color: var(--text-muted);
  flex-shrink: 0;
  line-height: 1;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 15px;
  color: var(--text-primary);
  font-family: var(--font-body);
  outline: none;
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 14px;
  padding: 4px;
  cursor: pointer;
  flex-shrink: 0;
  line-height: 1;
}

.search-close-btn:hover {
  color: var(--text-primary);
}

.search-scope-btn {
  background: var(--bg-hover);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 12px;
  font-family: var(--font-body);
  padding: 4px 10px;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.18s var(--ease-ink),
    color 0.18s var(--ease-ink),
    border-color 0.18s var(--ease-ink);
  min-width: 56px;
}

.search-scope-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.search-scope-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.search-body {
  flex: 1;
  overflow-y: auto;
  min-height: 80px;
}

.search-results {
  display: flex;
  flex-direction: column;
}

.search-result-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--bg-hover);
  transition: background 0.1s;
}

.search-result-item:hover {
  background: var(--bg-hover);
}

.search-result-item:last-child {
  border-bottom: none;
}

.sr-id {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent);
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 80px;
}

.sr-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sr-group {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 1px;
  text-transform: uppercase;
}

.sr-stem {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sr-stem :deep(mark) {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  color: var(--accent);
  padding: 0 1px;
}

.search-empty,
.search-hint {
  text-align: center;
  padding: 48px 20px;
  color: var(--text-muted);
  font-size: 14px;
}
</style>
