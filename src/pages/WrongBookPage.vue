<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getRelevantData, getQuestionById } from '../services/quizEngine'
import { isWrong } from '../services/reviewScheduler'
import { db } from '../db/database'
import { useActiveCategory, loadActiveCategory } from '../services/categoryStore'
import { truncate } from '../utils/text'
import type { QuestionStats } from '../types/question'

const router = useRouter()
const activeCategory = useActiveCategory()
const wrongItems = ref<{ questionId: string; stats: QuestionStats; stem: string; group: string }[]>([])
const filter = ref<'all' | 'recent' | 'most-wrong'>('all')
const currentPage = ref(1)
const pageSize = ref(20)
const confirmingId = ref<string | null>(null)
let confirmTimeout: ReturnType<typeof setTimeout> | null = null

async function refreshList() {
  const { stats } = await getRelevantData(activeCategory.value)
  wrongItems.value = stats
    .filter(isWrong)
    .map(s => {
      const q = getQuestionById(s.questionId)
      return { questionId: s.questionId, stats: s, stem: q?.stem || '', group: q?.groupTitle || '' }
    })
}

onMounted(async () => {
  await loadActiveCategory()
  await refreshList()
})

watch(activeCategory, () => { refreshList() })
watch(filter, () => { currentPage.value = 1 })

const filteredItems = computed(() => {
  let items = [...wrongItems.value]
  if (filter.value === 'most-wrong') items.sort((a, b) => b.stats.wrongCount - a.stats.wrongCount)
  if (filter.value === 'recent') items.sort((a, b) => new Date(b.stats.lastAttemptAt).getTime() - new Date(a.stats.lastAttemptAt).getTime())
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

async function clearWrong(questionId: string) {
  await db.questionStats.update(questionId, { wrongCount: 0, masteryLevel: 3 })
  await refreshList()
}

function handleClearWrong(questionId: string) {
  if (confirmingId.value === questionId) {
    if (confirmTimeout) clearTimeout(confirmTimeout)
    confirmTimeout = null
    confirmingId.value = null
    clearWrong(questionId)
  } else {
    confirmingId.value = questionId
    if (confirmTimeout) clearTimeout(confirmTimeout)
    confirmTimeout = setTimeout(() => {
      confirmingId.value = null
    }, 3000)
  }
}
</script>
<template>
  <div class="wrong-page">
    <header class="page-header">
      <h1>错题本</h1>
    </header>

    <div class="toolbar">
      <div class="filters">
        <button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button :class="{ active: filter === 'recent' }" @click="filter = 'recent'">最近</button>
        <button :class="{ active: filter === 'most-wrong' }" @click="filter = 'most-wrong'">最多错</button>
      </div>
      <button class="btn btn-accent" @click="goReview(filteredItems.map(i => i.questionId))" :disabled="filteredItems.length === 0">
        一键重刷全部错题
      </button>
    </div>

    <div v-if="filteredItems.length === 0" class="empty">暂无错题，继续保持</div>
    <div v-else class="wrong-list">
      <div v-for="item in pagedItems" :key="item.questionId" class="wrong-item">
        <div class="wi-main">
          <span class="wi-id">{{ item.questionId }}</span>
          <span class="wi-stem">{{ truncate(item.stem, 50) }}</span>
          <span class="wi-group">{{ item.group }}</span>
        </div>
        <div class="wi-stats">
          <span class="badge wrong">错 {{ item.stats.wrongCount }} 次</span>
          <span class="badge rate">正确率 {{ item.stats.attemptCount ? Math.round(item.stats.correctCount / item.stats.attemptCount * 100) : 0 }}%</span>
          <span class="badge level">掌握 {{ '★'.repeat(item.stats.masteryLevel) }}</span>
        </div>
        <div class="wi-actions">
          <button class="btn btn-outline btn-sm" @click="goReview([item.questionId])">刷这题</button>
          <button
            class="btn btn-sm"
            :class="confirmingId === item.questionId ? 'btn-confirm' : 'btn-outline'"
            @click="handleClearWrong(item.questionId)"
          >{{ confirmingId === item.questionId ? '确认' : '标记已掌握' }}</button>
        </div>
      </div>
    </div>

    <div v-if="filteredItems.length > pageSize" class="pagination">
      <button class="btn btn-outline btn-sm" :disabled="currentPage <= 1" @click="currentPage--">上一页</button>
      <span class="page-info">第 {{ currentPage }}/{{ totalPages }} 页</span>
      <button class="btn btn-outline btn-sm" :disabled="currentPage >= totalPages" @click="currentPage++">下一页</button>
    </div>
  </div>
</template>
<style scoped>
.wrong-page { max-width: 860px; margin: 0 auto; }
.page-header { margin-bottom: 24px; }
h1 { font-family: var(--font-display); font-size: 22px; font-weight: 700; }

.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 12px; flex-wrap: wrap; }
.filters { display: flex; gap: 4px; }
.filters button {
  padding: 6px 14px; border: 1px solid var(--border); background: var(--bg-card);
  color: var(--text-secondary); font-size: 13px; transition: all .12s;
}
.filters button:hover { color: var(--text-primary); border-color: var(--text-primary); }
.filters button.active { background: var(--accent); color: #fff; border-color: var(--accent); }

.empty { text-align: center; padding: 80px 20px; color: var(--text-secondary); }

.wrong-list { display: flex; flex-direction: column; gap: 6px; }
.wrong-item {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border: 1px solid var(--border); background: var(--bg-card); flex-wrap: wrap;
}
.wi-main { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 200px; }
.wi-id { font-weight: 600; color: var(--accent); font-size: 13px; font-family: var(--font-mono); }
.wi-stem { font-size: 14px; color: var(--text-primary); }
.wi-group { font-size: 12px; color: var(--text-muted); }
.wi-stats { display: flex; gap: 6px; }
.badge { padding: 2px 8px; border: 1px solid var(--border); font-size: 11px; font-weight: 500; }
.badge.wrong { border-color: rgba(196,69,54,.3); color: var(--wrong); }
.badge.rate { border-color: rgba(184,134,11,.3); color: var(--warning); }
.badge.level { border-color: var(--border); color: var(--text-secondary); }
.wi-actions { display: flex; gap: 6px; }

.btn { padding: 10px 22px; border: 1px solid var(--border); font-size: 14px; transition: all .12s; }
.btn-accent { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-accent:hover { background: var(--accent-hover); }
.btn-accent:disabled { opacity: .35; cursor: not-allowed; }
.btn-outline { background: transparent; color: var(--text-secondary); }
.btn-outline:hover { border-color: var(--accent); color: var(--accent); }
.btn-sm { padding: 5px 14px; font-size: 12px; }

.btn-confirm { background: var(--wrong); color: #fff; border-color: var(--wrong); }
.btn-confirm:hover { opacity: .85; }

.pagination { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 24px; padding: 16px 0; }
.page-info { font-size: 13px; color: var(--text-secondary); }
</style>
