<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { db } from '../db/database'
import { loadQuestionBank, getQuestionById } from '../services/quizEngine'
import { useActiveCategory, loadActiveCategory } from '../services/categoryStore'
import { useHiddenSite } from '../composables/useHiddenSite'
import { truncate } from '../utils/text'
import { stripMarkdown } from '../utils/renderMarkdown'
import type { Attempt, Category } from '../types/question'

const router = useRouter()
const activeCategory = useActiveCategory()
const { isUnlocked } = useHiddenSite()

const attempts = ref<Attempt[]>([])
const loading = ref(true)
const error = ref('')
const filterCategory = ref<Category | 'all'>('all')
const filterDateRange = ref<'all' | 'today' | 'week' | 'month'>('all')
const filterResult = ref<'all' | 'correct' | 'wrong'>('all')
const currentPage = ref(1)
const pageSize = ref(20)

async function refreshList() {
  loading.value = true
  error.value = ''
  try {
    // 加载最近的 attempts
    const allAttempts = await db.attempts.orderBy('id').reverse().limit(1000).toArray()

    // 根据筛选条件过滤
    let filtered = allAttempts

    // 按分类筛选
    if (filterCategory.value !== 'all') {
      const questions = await loadQuestionBank(filterCategory.value)
      const validIds = new Set(questions.map((q) => q.id))
      filtered = filtered.filter((a) => validIds.has(a.questionId))
    }

    // 按日期范围筛选
    const now = new Date()
    if (filterDateRange.value === 'today') {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      filtered = filtered.filter((a) => new Date(a.createdAt) >= today)
    } else if (filterDateRange.value === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      filtered = filtered.filter((a) => new Date(a.createdAt) >= weekAgo)
    } else if (filterDateRange.value === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      filtered = filtered.filter((a) => new Date(a.createdAt) >= monthAgo)
    }

    // 按结果筛选
    if (filterResult.value === 'correct') {
      filtered = filtered.filter((a) => a.isCorrect)
    } else if (filterResult.value === 'wrong') {
      filtered = filtered.filter((a) => !a.isCorrect)
    }

    attempts.value = filtered
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载答题历史失败，请刷新页面重试'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadActiveCategory()
  await refreshList()
})

watch(activeCategory, () => {
  refreshList()
})

watch(isUnlocked, () => {
  refreshList()
})

watch([filterCategory, filterDateRange, filterResult], () => {
  currentPage.value = 1
})

const totalPages = computed(() => Math.ceil(attempts.value.length / pageSize.value))

const pagedAttempts = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return attempts.value.slice(start, start + pageSize.value)
})

const stats = computed(() => {
  const total = attempts.value.length
  const correct = attempts.value.filter((a) => a.isCorrect).length
  const rate = total > 0 ? Math.round((correct / total) * 100) : 0
  return { total, correct, rate }
})

function getQuestionInfo(questionId: string) {
  const q = getQuestionById(questionId)
  return {
    stem: q ? truncate(stripMarkdown(q.stem), 40) : questionId,
    group: q?.groupTitle || '',
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000))

  if (diffDays === 0) {
    return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } else if (diffDays === 1) {
    return `昨天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } else if (diffDays < 7) {
    return `${diffDays}天前`
  } else {
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
}

function goReview(questionId: string) {
  router.push({ path: '/quiz', query: { ids: questionId } })
}
</script>
<template>
  <div class="history-page">
    <header class="page-header">
      <h1>答题历史</h1>
      <p class="page-subtitle">查看所有答题记录</p>
    </header>

    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="error" class="empty">
      <p style="color: var(--wrong); margin-bottom: 12px">{{ error }}</p>
      <button class="btn btn-accent btn-sm" @click="refreshList">重试</button>
    </div>
    <template v-else>
      <div class="stats-bar">
        <span>共 {{ stats.total }} 次答题</span>
        <span>正确 {{ stats.correct }} 次</span>
        <span>正确率 {{ stats.rate }}%</span>
      </div>

      <div class="toolbar">
        <div class="filters">
          <select v-model="filterCategory" class="filter-select">
            <option value="all">全部学科</option>
            <option value="japanese2">综合日语2</option>
            <option value="history">中国近现代史</option>
            <option value="party">党史</option>
            <option value="military">军事理论</option>
          </select>
          <select v-model="filterDateRange" class="filter-select">
            <option value="all">全部时间</option>
            <option value="today">今天</option>
            <option value="week">最近7天</option>
            <option value="month">最近30天</option>
          </select>
          <select v-model="filterResult" class="filter-select">
            <option value="all">全部结果</option>
            <option value="correct">仅正确</option>
            <option value="wrong">仅错误</option>
          </select>
        </div>
      </div>

      <div v-if="attempts.length === 0" class="empty">暂无答题记录</div>
      <div v-else class="history-list">
        <div v-for="a in pagedAttempts" :key="a.id" class="history-item">
          <div class="hi-main">
            <span class="hi-id">{{ a.questionId }}</span>
            <span class="hi-stem">{{ getQuestionInfo(a.questionId).stem }}</span>
            <span class="hi-group">{{ getQuestionInfo(a.questionId).group }}</span>
          </div>
          <div class="hi-meta">
            <span :class="['hi-result', a.isCorrect ? 'correct' : 'wrong']">
              {{ a.isCorrect ? '✓ 正确' : '✗ 错误' }}
            </span>
            <span class="hi-time">{{ formatDate(a.createdAt) }}</span>
            <span v-if="a.elapsedMs > 0" class="hi-speed">
              {{ (a.elapsedMs / 1000).toFixed(1) }}s
            </span>
          </div>
          <div class="hi-actions">
            <button class="btn btn-outline btn-sm" @click="goReview(a.questionId)">重做</button>
          </div>
        </div>
      </div>

      <div v-if="attempts.length > pageSize" class="pagination">
        <button class="btn btn-outline btn-sm" :disabled="currentPage <= 1" @click="currentPage--">
          上一页
        </button>
        <span class="page-info">第 {{ currentPage }}/{{ totalPages }} 页</span>
        <button
          class="btn btn-outline btn-sm"
          :disabled="currentPage >= totalPages"
          @click="currentPage++"
        >
          下一页
        </button>
      </div>
    </template>
  </div>
</template>
<style scoped>
.history-page {
  max-width: 860px;
  margin: 0 auto;
}
.page-header {
  margin-bottom: 24px;
}
h1 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 4px;
}
.page-subtitle {
  color: var(--text-secondary);
  font-size: 14px;
}

.stats-bar {
  display: flex;
  gap: 20px;
  padding: 12px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  margin-bottom: 16px;
  font-size: 14px;
  color: var(--text-secondary);
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  gap: 12px;
  flex-wrap: wrap;
}
.filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.filter-select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.filter-select:focus {
  border-color: var(--accent);
  outline: none;
}

.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-secondary);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.history-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  flex-wrap: wrap;
}
.hi-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 200px;
}
.hi-id {
  font-weight: 600;
  color: var(--accent);
  font-size: 13px;
  font-family: var(--font-mono);
}
.hi-stem {
  font-size: 14px;
  color: var(--text-primary);
}
.hi-group {
  font-size: 12px;
  color: var(--text-muted);
}
.hi-meta {
  display: flex;
  gap: 8px;
  align-items: center;
}
.hi-result {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
}
.hi-result.correct {
  color: var(--correct);
  background: color-mix(in srgb, var(--correct) 10%, transparent);
}
.hi-result.wrong {
  color: var(--wrong);
  background: color-mix(in srgb, var(--wrong) 10%, transparent);
}
.hi-time {
  font-size: 12px;
  color: var(--text-muted);
}
.hi-speed {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}
.hi-actions {
  display: flex;
  gap: 6px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 24px;
  padding: 16px 0;
}
.page-info {
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
