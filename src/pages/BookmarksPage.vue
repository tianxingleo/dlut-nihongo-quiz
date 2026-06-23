<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getRelevantData, getQuestionById } from '../services/quizEngine'
import { db } from '../db/database'
import { useActiveCategory, loadActiveCategory } from '../services/categoryStore'
import { useHiddenSite } from '../composables/useHiddenSite'
import { truncate } from '../utils/text'
import { stripMarkdown } from '../utils/renderMarkdown'
import type { QuestionStats } from '../types/question'

const router = useRouter()
const activeCategory = useActiveCategory()
const { isUnlocked } = useHiddenSite()
const bookmarkItems = ref<
  { questionId: string; stats: QuestionStats; stem: string; group: string }[]
>([])
const filter = ref<'all' | 'recent' | 'mastered'>('all')
const currentPage = ref(1)
const pageSize = ref(20)
const loading = ref(true)
const error = ref('')

async function refreshList() {
  loading.value = true
  error.value = ''
  try {
    const { stats } = await getRelevantData(activeCategory.value, undefined, {
      isUnlocked: isUnlocked.value,
    })
    bookmarkItems.value = stats
      .filter((s) => s.isBookmarked)
      .map((s) => {
        const q = getQuestionById(s.questionId)
        return {
          questionId: s.questionId,
          stats: s,
          stem: q?.stem || '',
          group: q?.groupTitle || '',
        }
      })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载收藏数据失败，请刷新页面重试'
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

watch(filter, () => {
  currentPage.value = 1
})

const filteredItems = computed(() => {
  let items = [...bookmarkItems.value]
  if (filter.value === 'recent')
    items.sort(
      (a, b) =>
        new Date(b.stats.lastAttemptAt).getTime() - new Date(a.stats.lastAttemptAt).getTime(),
    )
  if (filter.value === 'mastered') items = items.filter((i) => i.stats.masteryLevel >= 4)
  return items
})

const totalPages = computed(() => Math.ceil(filteredItems.value.length / pageSize.value))

const pagedItems = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredItems.value.slice(start, start + pageSize.value)
})

function goReview(ids: string[]) {
  router.push({ path: '/quiz', query: { ids: ids.join(',') } })
}

async function toggleBookmark(questionId: string) {
  const stat = await db.questionStats.get(questionId)
  if (stat) {
    await db.questionStats.update(questionId, { isBookmarked: !stat.isBookmarked })
    await refreshList()
  }
}

function getMasteryStars(level: number): string {
  return '★'.repeat(level) + '☆'.repeat(5 - level)
}
</script>
<template>
  <div class="bookmarks-page">
    <header class="page-header">
      <h1>我的收藏</h1>
      <p class="page-subtitle">收藏的题目便于集中复习</p>
    </header>

    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="error" class="empty">
      <p style="color: var(--wrong); margin-bottom: 12px">{{ error }}</p>
      <button class="btn btn-accent btn-sm" @click="refreshList">重试</button>
    </div>
    <template v-else>
      <div class="toolbar">
        <div class="filters">
          <button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
          <button :class="{ active: filter === 'recent' }" @click="filter = 'recent'">最近</button>
          <button :class="{ active: filter === 'mastered' }" @click="filter = 'mastered'">
            已掌握
          </button>
        </div>
        <button
          class="btn btn-accent"
          @click="goReview(filteredItems.map((i) => i.questionId))"
          :disabled="filteredItems.length === 0"
        >
          刷全部收藏
        </button>
      </div>

      <div v-if="filteredItems.length === 0" class="empty">
        <p>暂无收藏题目</p>
        <p class="empty-hint">在答题时点击「收藏」按钮即可添加</p>
      </div>
      <div v-else class="bookmark-list">
        <div v-for="item in pagedItems" :key="item.questionId" class="bookmark-item">
          <div class="bi-main">
            <span class="bi-id">{{ item.questionId }}</span>
            <span class="bi-stem">{{ truncate(stripMarkdown(item.stem), 50) }}</span>
            <span class="bi-group">{{ item.group }}</span>
          </div>
          <div class="bi-stats">
            <span class="badge mastery">
              {{ getMasteryStars(item.stats.masteryLevel) }}
            </span>
            <span class="badge rate" v-if="item.stats.attemptCount > 0">
              正确率
              {{ Math.round((item.stats.correctCount / item.stats.attemptCount) * 100) }}%
            </span>
          </div>
          <div class="bi-actions">
            <button class="btn btn-outline btn-sm" @click="goReview([item.questionId])">
              刷这题
            </button>
            <button class="btn btn-ghost btn-sm" @click="toggleBookmark(item.questionId)">
              取消收藏
            </button>
          </div>
        </div>
      </div>

      <div v-if="filteredItems.length > pageSize" class="pagination">
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
.bookmarks-page {
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

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  gap: 12px;
  flex-wrap: wrap;
}
.filters {
  display: flex;
  gap: 4px;
}
.filters button {
  padding: 6px 14px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 13px;
  transition:
    background 0.18s var(--ease-ink),
    color 0.18s var(--ease-ink),
    border-color 0.18s var(--ease-ink);
}
.filters button:hover {
  color: var(--text-primary);
  border-color: var(--text-primary);
}
.filters button.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.empty {
  text-align: center;
  padding: 80px 20px;
  color: var(--text-secondary);
}
.empty-hint {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 8px;
}

.bookmark-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bookmark-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  flex-wrap: wrap;
}
.bi-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 200px;
}
.bi-id {
  font-weight: 600;
  color: var(--accent);
  font-size: 13px;
  font-family: var(--font-mono);
}
.bi-stem {
  font-size: 14px;
  color: var(--text-primary);
}
.bi-group {
  font-size: 12px;
  color: var(--text-muted);
}
.bi-stats {
  display: flex;
  gap: 6px;
}
.badge {
  padding: 2px 8px;
  border: 1px solid var(--border);
  font-size: 11px;
  font-weight: 500;
}
.badge.mastery {
  border-color: rgba(76, 175, 80, 0.3);
  color: var(--correct);
  letter-spacing: 1px;
}
.badge.rate {
  border-color: rgba(184, 134, 11, 0.3);
  color: var(--warning);
}
.bi-actions {
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
