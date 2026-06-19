<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { getRelevantData, getAllGrammarPoints, getQuestionById } from '../services/quizEngine'
import { useActiveCategory, loadActiveCategory } from '../services/categoryStore'
import { db } from '../db/database'
import { truncate } from '../utils/text'
import PageSkeleton from '../components/PageSkeleton.vue'
import type { QuestionStats, Question, Attempt } from '../types/question'

const activeCategory = useActiveCategory()
const questions = ref<Question[]>([])
const stats = ref<QuestionStats[]>([])
const attempts = ref<Attempt[]>([])
const viewMode = ref<'groups' | 'tags' | 'wrong' | 'trend'>('groups')
const loading = ref(true)

async function refresh() {
  loading.value = true
  const [relevant, allAttempts] = await Promise.all([
    getRelevantData(activeCategory.value),
    db.attempts.toArray(),
  ])
  questions.value = relevant.questions
  stats.value = relevant.stats
  const validIds = new Set(relevant.questions.map((q) => q.id))
  // 按时间正序保留（旧 → 新），让趋势图从左到右是时间推进
  attempts.value = allAttempts
    .filter((a) => validIds.has(a.questionId))
    .sort((a, b) => a.id! - b.id!)
  loading.value = false
}

onMounted(async () => {
  await loadActiveCategory()
  await refresh()
})

watch(activeCategory, () => {
  refresh()
})

const groupAnalysis = computed(() => {
  const statsMap = new Map(stats.value.map((s) => [s.questionId, s]))
  const map = new Map<string, { total: number; done: number; correct: number; wrong: number }>()
  for (const q of questions.value) {
    if (!map.has(q.groupId)) map.set(q.groupId, { total: 0, done: 0, correct: 0, wrong: 0 })
    const g = map.get(q.groupId)!
    g.total++
    const s = statsMap.get(q.id)
    if (s && s.attemptCount > 0) {
      g.done++
      g.correct += s.correctCount
      g.wrong += s.wrongCount
    }
  }
  return [...map.entries()]
    .map(([id, data]) => ({
      id,
      title: questions.value.find((q) => q.groupId === id)?.groupTitle || id,
      ...data,
      rate: data.done > 0 ? Math.round((data.correct / (data.correct + data.wrong)) * 100) : 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
})

const tagAnalysis = computed(() => {
  const points = getAllGrammarPoints(activeCategory.value)
  const tagSource =
    activeCategory.value === 'word'
      ? questions.value
          .flatMap((q) => q.tags)
          .filter((t) => t !== '单词')
          .map((t) => ({ point: t, count: 0 }))
      : points
  const seen = new Set<string>()
  const deduped = tagSource
    .filter((p) => {
      if (seen.has(p.point)) return false
      seen.add(p.point)
      return true
    })
    .slice(0, 15)

  const statsMap = new Map(stats.value.map((s) => [s.questionId, s]))
  return deduped.map((p) => {
    const qs = questions.value.filter(
      (q) => q.grammarPoints.includes(p.point) || q.tags.includes(p.point),
    )
    let correct = 0
    let total = 0
    for (const q of qs) {
      const s = statsMap.get(q.id)
      if (s && s.attemptCount > 0) {
        total += s.attemptCount
        correct += s.correctCount
      }
    }
    return {
      point: p.point,
      questionCount: qs.length,
      attempts: total,
      rate: total > 0 ? Math.round((correct / total) * 100) : 0,
    }
  })
})

const topWrongQuestions = computed(() => {
  const wrong = stats.value
    .filter((s) => s.wrongCount > 0)
    .sort((a, b) => b.wrongCount - a.wrongCount)
    .slice(0, 10)
  return wrong.map((s) => {
    const q = getQuestionById(s.questionId)
    return {
      id: s.questionId,
      stem: truncate(q?.stem || '', 50),
      wrongCount: s.wrongCount,
      rate: s.attemptCount > 0 ? Math.round((s.correctCount / s.attemptCount) * 100) : 0,
    }
  })
})

const overallStats = computed(() => {
  const totalAttempts = stats.value.reduce((sum, s) => sum + s.attemptCount, 0)
  const totalCorrect = stats.value.reduce((sum, s) => sum + s.correctCount, 0)
  return {
    totalQuestions: questions.value.length,
    doneQuestions: stats.value.filter((s) => s.attemptCount > 0).length,
    totalAttempts,
    totalCorrect,
    overallRate: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
  }
})

const tagTableHeader = computed(() => (activeCategory.value === 'word' ? '课/标签' : '语法点'))
const tagTabLabel = computed(() => (activeCategory.value === 'word' ? '按课/标签' : '按语法标签'))

// 最近 40 次答题的点阵：每个点 = 一次 attempt，绿=对、红=错。无依赖 SVG/Canvas。
const trendDots = computed(() => {
  const list = attempts.value.slice(-40)
  const correct = list.filter((a) => a.isCorrect).length
  const rate = list.length > 0 ? Math.round((correct / list.length) * 100) : 0
  return { dots: list, correct, total: list.length, rate }
})
</script>
<template>
  <div v-if="loading" class="analysis-page analysis-loading">
    <PageSkeleton type="list" />
  </div>
  <div v-else class="analysis-page">
    <header class="page-header">
      <h1>数据分析</h1>
    </header>

    <div class="overview-cards">
      <div class="card">
        <span class="num">{{ overallStats.totalQuestions }}</span
        ><span class="lbl">总题数</span>
      </div>
      <div class="card">
        <span class="num">{{ overallStats.doneQuestions }}</span
        ><span class="lbl">已做</span>
      </div>
      <div class="card">
        <span class="num">{{ overallStats.totalAttempts }}</span
        ><span class="lbl">总提交</span>
      </div>
      <div class="card">
        <span class="num">{{ overallStats.overallRate }}%</span><span class="lbl">总正确率</span>
      </div>
    </div>

    <div class="tabs">
      <button :class="{ active: viewMode === 'groups' }" @click="viewMode = 'groups'">
        按题组
      </button>
      <button :class="{ active: viewMode === 'tags' }" @click="viewMode = 'tags'">
        {{ tagTabLabel }}
      </button>
      <button :class="{ active: viewMode === 'wrong' }" @click="viewMode = 'wrong'">
        高频错题
      </button>
      <button :class="{ active: viewMode === 'trend' }" @click="viewMode = 'trend'">
        答题趋势
      </button>
    </div>

    <table v-if="viewMode === 'groups'" class="data-table">
      <thead>
        <tr>
          <th>题组</th>
          <th>题数</th>
          <th>已做</th>
          <th>正确率</th>
          <th>进度</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="g in groupAnalysis" :key="g.id">
          <td>
            <strong>{{ g.title }}</strong>
          </td>
          <td>{{ g.total }}</td>
          <td>{{ g.done }}</td>
          <td :class="g.rate >= 70 ? 'green' : g.rate >= 40 ? 'yellow' : 'red'">{{ g.rate }}%</td>
          <td>
            <div class="mini-bar"><div :style="{ width: (g.done / g.total) * 100 + '%' }" /></div>
          </td>
        </tr>
      </tbody>
    </table>

    <table v-if="viewMode === 'tags'" class="data-table">
      <thead>
        <tr>
          <th>{{ tagTableHeader }}</th>
          <th>题数</th>
          <th>做题次数</th>
          <th>正确率</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in tagAnalysis" :key="t.point">
          <td>
            <strong>{{ t.point }}</strong>
          </td>
          <td>{{ t.questionCount }}</td>
          <td>{{ t.attempts }}</td>
          <td :class="t.rate >= 70 ? 'green' : t.rate >= 40 ? 'yellow' : 'red'">{{ t.rate }}%</td>
          <td>
            <span v-if="t.rate >= 80" class="status good">已掌握</span>
            <span v-else-if="t.rate >= 50" class="status warn">需巩固</span>
            <span v-else-if="t.attempts > 0" class="status bad">优先复习</span>
            <span v-else class="status na">--</span>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="viewMode === 'wrong'" class="wrong-table">
      <div v-for="w in topWrongQuestions" :key="w.id" class="wrong-row">
        <span class="w-id">{{ w.id }}</span>
        <span class="w-stem">{{ w.stem }}</span>
        <span class="w-count">错 {{ w.wrongCount }} 次</span>
        <span class="w-rate">{{ w.rate }}%</span>
      </div>
      <p v-if="topWrongQuestions.length === 0" class="empty">暂无错题</p>
    </div>

    <div v-if="viewMode === 'trend'" class="trend-section">
      <p class="trend-summary">
        近 {{ trendDots.total }} 次答题中，正确 {{ trendDots.correct }} 次 · 正确率
        {{ trendDots.rate }}%
        <span v-if="trendDots.total === 0" class="empty-inline">（当前学科还没有答题记录）</span>
      </p>
      <div
        v-if="trendDots.total > 0"
        class="trend-dots"
        role="img"
        :aria-label="`最近 ${trendDots.total} 次答题，正确率 ${trendDots.rate}%`"
      >
        <span
          v-for="a in trendDots.dots"
          :key="a.id"
          :class="['trend-dot', a.isCorrect ? 'correct' : 'wrong']"
          :title="`${a.createdAt.slice(0, 16).replace('T', ' ')} · ${a.isCorrect ? '正确' : '错误'}`"
        />
      </div>
      <p v-if="trendDots.total > 0" class="trend-legend">
        <span class="leg correct">&bull;</span> 正确 <span class="leg wrong">&bull;</span> 错误
        <span class="leg hint">左 → 右 = 旧 → 新</span>
      </p>
    </div>
  </div>
</template>
<style scoped>
.analysis-page {
  max-width: 900px;
  margin: 0 auto;
}
.page-header {
  margin-bottom: 24px;
}
h1 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
}

.overview-cards {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  min-width: 100px;
  flex: 1;
}
.num {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 600;
  color: var(--accent);
  line-height: 1.1;
}
.lbl {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 18px;
}
.tabs button {
  padding: 6px 16px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 13px;
  transition: all 0.12s;
}
.tabs button:hover {
  color: var(--text-primary);
  border-color: var(--text-primary);
}
.tabs button.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.data-table th {
  text-align: left;
  padding: 10px 14px;
  border-bottom: 2px solid var(--border);
  color: var(--text-secondary);
  font-weight: 600;
}
.data-table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.green {
  color: var(--correct);
  font-weight: 600;
}
.yellow {
  color: var(--warning);
  font-weight: 600;
}
.red {
  color: var(--wrong);
  font-weight: 600;
}
.mini-bar {
  width: 100px;
  height: 4px;
  background: var(--bg-hover);
  overflow: hidden;
}
.mini-bar div {
  height: 100%;
  background: var(--accent);
}

.status {
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--border);
}
.status.good {
  border-color: rgba(45, 106, 79, 0.3);
  color: var(--correct);
}
.status.warn {
  border-color: rgba(184, 134, 11, 0.3);
  color: var(--warning);
}
.status.bad {
  border-color: rgba(196, 69, 54, 0.3);
  color: var(--wrong);
}
.status.na {
  color: var(--text-muted);
}

.wrong-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wrong-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  font-size: 14px;
}
.w-id {
  font-weight: 600;
  color: var(--accent);
  font-family: var(--font-mono);
  min-width: 90px;
}
.w-stem {
  flex: 1;
  color: var(--text-primary);
}
.w-count {
  color: var(--wrong);
  font-weight: 600;
}
.w-rate {
  color: var(--text-secondary);
}
.empty {
  text-align: center;
  padding: 60px;
  color: var(--text-secondary);
}

.trend-section {
  padding: 8px 0;
}
.trend-summary {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 14px;
}
.empty-inline {
  color: var(--text-muted);
  font-size: 13px;
}
.trend-dots {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
}
.trend-dot {
  width: 14px;
  height: 14px;
  display: inline-block;
  border-radius: 2px;
}
.trend-dot.correct {
  background: var(--correct);
}
.trend-dot.wrong {
  background: var(--wrong);
}
.trend-legend {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  gap: 14px;
  align-items: center;
}
.trend-legend .leg.correct {
  color: var(--correct);
  font-size: 16px;
}
.trend-legend .leg.wrong {
  color: var(--wrong);
  font-size: 16px;
}
.trend-legend .leg.hint {
  color: var(--text-muted);
}
</style>
