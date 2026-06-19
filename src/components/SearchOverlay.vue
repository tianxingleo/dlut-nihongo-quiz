<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { searchQuestions } from '../services/quizEngine'
import type { Question } from '../types/question'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  navigate: [questionId: string]
}>()

const keyword = ref('')
const results = ref<Question[]>([])
const inputRef = ref<HTMLInputElement | null>(null)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function doSearch(val: string) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    if (val.trim()) {
      results.value = searchQuestions(val.trim())
    } else {
      results.value = []
    }
  }, 300)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(keyword, (val) => doSearch(val))

watch(() => props.visible, (v) => {
  if (v) {
    document.addEventListener('keydown', handleKeydown)
    nextTick(() => inputRef.value?.focus())
  } else {
    document.removeEventListener('keydown', handleKeydown)
    keyword.value = ''
    results.value = []
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})

function selectQuestion(id: string) {
  emit('navigate', id)
}

function onBackdropClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('search-backdrop')) {
    emit('close')
  }
}
</script>
<template>
  <div v-if="visible" class="search-backdrop" @click="onBackdropClick">
    <div class="search-panel">
      <div class="search-input-wrap">
        <span class="search-icon">⌕</span>
        <input
          ref="inputRef"
          v-model="keyword"
          class="search-input"
          placeholder="搜索题目…"
          autocomplete="off"
          spellcheck="false"
        />
        <button class="search-close-btn" @click="emit('close')">✕</button>
      </div>
      <div class="search-body">
        <div v-if="results.length > 0" class="search-results">
          <div
            v-for="q in results"
            :key="q.id"
            class="search-result-item"
            @click="selectQuestion(q.id)"
          >
            <div class="sr-id">{{ q.id }}</div>
            <div class="sr-content">
              <span class="sr-group">{{ q.groupTitle }}</span>
              <span class="sr-stem">{{ q.stem.length > 60 ? q.stem.substring(0, 60) + '…' : q.stem }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="keyword.trim() && results.length === 0" class="search-empty">
          未找到相关题目
        </div>
        <div v-else class="search-hint">输入关键词搜索题目</div>
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

.search-empty,
.search-hint {
  text-align: center;
  padding: 48px 20px;
  color: var(--text-muted);
  font-size: 14px;
}
</style>
