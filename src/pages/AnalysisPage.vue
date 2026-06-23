<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getRelevantData, getQuestionById } from '../services/quizEngine'
import {
  useActiveCategory,
  loadActiveCategory,
  useActiveSubBankKey,
} from '../services/categoryStore'
import { useHiddenSite } from '../composables/useHiddenSite'
import { db } from '../db/database'
import { truncate } from '../utils/text'
import { stripMarkdown } from '../utils/renderMarkdown'
import PageSkeleton from '../components/ui/PageSkeleton.vue'
import type { QuestionStats, Question, Attempt } from '../types/question'

const router = useRouter()
const activeCategory = useActiveCategory()
const activeSubBankKey = useActiveSubBankKey()
const isWordSubBank = computed(() => activeSubBankKey.value === 'word')
const { isUnlocked } = useHiddenSite()
const questions = ref<Question[]>([])
const stats = ref<QuestionStats[]>([])
const attempts = ref<Attempt[]>([])
const viewMode = ref<'groups' | 'tags' | 'wrong' | 'trend' | 'heatmap' | 'speed'>('groups')
const loading = ref(true)
const error = ref('')

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const relevant = await getRelevantData(activeCategory.value, undefined, {
      isUnlocked: isUnlocked.value,
    })
    questions.value = relevant.questions
    stats.value = relevant.stats
    const validIds = new Set(relevant.questions.map((q) => q.id))

    // 使用索引查询最近 30 天的 attempts，避免加载全表
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const startStr = thirtyDaysAgo.toISOString()

    const recentAttempts = await db.attempts.where('createdAt').aboveOrEqual(startStr).toArray()

    // 按时间正序保留（旧 → 新），让趋势图从左到右是时间推进
    attempts.value = recentAttempts
      .filter((a) => validIds.has(a.questionId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载分析数据失败，请刷新页面重试'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadActiveCategory()
  await refresh()
})

watch(activeCategory, () => {
  refresh()
})

// 里站解锁/锁定切换时，可见题集改变，需要重算分析数据。
watch(isUnlocked, () => {
  refresh()
})

const groupAnalysis = computed(() => {
  const statsMap = new Map(stats.value.map((s) => [s.questionId, s]))
  const map = new Map<
    string,
    { total: number; done: number; correct: number; wrong: number; title: string }
  >()
  for (const q of questions.value) {
    if (!map.has(q.groupId))
      map.set(q.groupId, { total: 0, done: 0, correct: 0, wrong: 0, title: q.groupTitle })
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
      title: data.title,
      total: data.total,
      done: data.done,
      correct: data.correct,
      wrong: data.wrong,
      rate: data.done > 0 ? Math.round((data.correct / (data.correct + data.wrong)) * 100) : 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
})

const tagAnalysis = computed(() => {
  // 候选列表基于已过滤的 questions.value，避开 getAllGrammarPoints 的全量缓存——
  // 否则表站会看到「被动形」「授受动词」等只在 requireUnlock subBank 出现的语法点。
  const tagSource = isWordSubBank.value
    ? questions.value
        .flatMap((q) => q.tags)
        .filter((t) => t !== '单词')
        .map((t) => ({ point: t, count: 0 }))
    : (() => {
        const counts = new Map<string, number>()
        for (const q of questions.value) {
          for (const gp of q.grammarPoints) counts.set(gp, (counts.get(gp) || 0) + 1)
        }
        return [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([point, count]) => ({ point, count }))
      })()
  const seen = new Set<string>()
  const deduped = tagSource
    .filter((p) => {
      if (seen.has(p.point)) return false
      seen.add(p.point)
      return true
    })
    .slice(0, 15)

  // 预构建 tag -> question[] 索引，避免对每个 tag 都执行 filter
  const tagIndex = new Map<string, typeof questions.value>()
  for (const q of questions.value) {
    const allTags = [...q.grammarPoints, ...q.tags]
    for (const tag of allTags) {
      if (!tagIndex.has(tag)) tagIndex.set(tag, [])
      tagIndex.get(tag)!.push(q)
    }
  }

  const statsMap = new Map(stats.value.map((s) => [s.questionId, s]))
  return deduped.map((p) => {
    const qs = tagIndex.get(p.point) || []
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
      stem: truncate(stripMarkdown(q?.stem || ''), 50),
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

// 答题速度分析
const speedAnalysis = computed(() => {
  if (attempts.value.length === 0) {
    return { avgMs: 0, avgCorrectMs: 0, avgWrongMs: 0, fastest: null, slowest: null }
  }

  const validAttempts = attempts.value.filter((a) => a.elapsedMs > 0 && a.elapsedMs < 300000) // 过滤异常值（>5分钟）
  if (validAttempts.length === 0) {
    return { avgMs: 0, avgCorrectMs: 0, avgWrongMs: 0, fastest: null, slowest: null }
  }

  const totalMs = validAttempts.reduce((sum, a) => sum + a.elapsedMs, 0)
  const correctAttempts = validAttempts.filter((a) => a.isCorrect)
  const wrongAttempts = validAttempts.filter((a) => !a.isCorrect)

  const avgMs = Math.round(totalMs / validAttempts.length)
  const avgCorrectMs =
    correctAttempts.length > 0
      ? Math.round(
          correctAttempts.reduce((sum, a) => sum + a.elapsedMs, 0) / correctAttempts.length,
        )
      : 0
  const avgWrongMs =
    wrongAttempts.length > 0
      ? Math.round(wrongAttempts.reduce((sum, a) => sum + a.elapsedMs, 0) / wrongAttempts.length)
      : 0

  const sorted = [...validAttempts].sort((a, b) => a.elapsedMs - b.elapsedMs)
  const fastest = sorted[0]
  const slowest = sorted[sorted.length - 1]

  return { avgMs, avgCorrectMs, avgWrongMs, fastest, slowest }
})

const tagTableHeader = computed(() => (isWordSubBank.value ? '课/标签' : '语法点'))
const tagTabLabel = computed(() => (isWordSubBank.value ? '按课/标签' : '按语法标签'))

// 最近 40 次答题的点阵：每个点 = 一次 attempt，绿=对、红=错。无依赖 SVG/Canvas。
const trendDots = computed(() => {
  const list = attempts.value.slice(-40)
  const correct = list.filter((a) => a.isCorrect).length
  const rate = list.length > 0 ? Math.round((correct / list.length) * 100) : 0
  return { dots: list, correct, total: list.length, rate }
})

// 最近 30 天每日答题热力图：按日期聚合 attemptCount，分为 4 档强度。
// 单次遍历 attempts 构建日期计数表，再映射到 30 天数组。
const heatmapData = computed(() => {
  const now = new Date()
  // 单次遍历：将所有 attempts 按日期前缀归桶
  const countByDate = new Map<string, number>()
  for (const a of attempts.value) {
    const day = a.createdAt.slice(0, 10)
    countByDate.set(day, (countByDate.get(day) ?? 0) + 1)
  }

  const days: { date: string; label: string; count: number; level: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const count = countByDate.get(dateStr) ?? 0
    // 4 档：0=无，1=1-5题，2=6-15题，3=16+题
    let level = 0
    if (count >= 16) level = 3
    else if (count >= 6) level = 2
    else if (count >= 1) level = 1
    days.push({ date: dateStr, label: `${d.getMonth() + 1}/${d.getDate()}`, count, level })
  }

  const totalActive = days.filter((d) => d.count > 0).length
  const maxCount = Math.max(...days.map((d) => d.count), 0)
  return { days, totalActive, maxCount }
})
</script>
<template>
  <div v-if="loading" class="analysis-page analysis-loading">
    <PageSkeleton type="list" />
  </div>
  <div v-else-if="error" class="analysis-page">
    <div class="empty">
      <p style="color: var(--wrong); margin-bottom: 12px">{{ error }}</p>
      <button class="btn btn-accent btn-sm" @click="refresh">重试</button>
    </div>
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
      <button :class="{ active: viewMode === 'heatmap' }" @click="viewMode = 'heatmap'">
        每日活跃
      </button>
      <button :class="{ active: viewMode === 'speed' }" @click="viewMode = 'speed'">
        答题速度
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
          <th>操作</th>
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
          <td>
            <button
              class="btn btn-outline btn-sm"
              @click="router.push({ path: '/quiz', query: { group: g.id } })"
            >
              刷题
            </button>
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
          <th>操作</th>
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
          <td>
            <button
              class="btn btn-outline btn-sm"
              @click="router.push({ path: '/quiz', query: { tag: t.point } })"
            >
              刷题
            </button>
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
        <button
          class="btn btn-outline btn-sm"
          @click="router.push({ path: '/quiz', query: { ids: w.id } })"
        >
          刷这题
        </button>
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

    <div v-if="viewMode === 'heatmap'" class="heatmap-section">
      <p class="heatmap-summary">
        近 30 天中有 <strong>{{ heatmapData.totalActive }}</strong> 天活跃，单日最高
        <strong>{{ heatmapData.maxCount }}</strong> 题
        <span v-if="heatmapData.totalActive === 0" class="empty-inline">
          （当前学科还没有答题记录）
        </span>
      </p>
      <div class="heatmap-grid" role="img" aria-label="近 30 天每日答题热力图">
        <div
          v-for="d in heatmapData.days"
          :key="d.date"
          :class="['heatmap-cell', `level-${d.level}`]"
          :title="`${d.date} · ${d.count} 题`"
        />
      </div>
      <div class="heatmap-labels">
        <span v-for="d in heatmapData.days" :key="d.date" class="heatmap-label">
          {{ d.label }}
        </span>
      </div>
      <div class="heatmap-legend">
        <span class="leg-label">少</span>
        <span class="heatmap-cell level-0" />
        <span class="heatmap-cell level-1" />
        <span class="heatmap-cell level-2" />
        <span class="heatmap-cell level-3" />
        <span class="leg-label">多</span>
      </div>
    </div>

    <div v-if="viewMode === 'speed'" class="speed-section">
      <div v-if="speedAnalysis.avgMs === 0" class="empty">暂无答题速度数据</div>
      <div v-else class="speed-cards">
        <div class="speed-card">
          <span class="speed-num">{{ (speedAnalysis.avgMs / 1000).toFixed(1) }}s</span>
          <span class="speed-label">平均答题时间</span>
        </div>
        <div class="speed-card">
          <span class="speed-num correct"
            >{{ (speedAnalysis.avgCorrectMs / 1000).toFixed(1) }}s</span
          >
          <span class="speed-label">正确题平均时间</span>
        </div>
        <div class="speed-card">
          <span class="speed-num wrong">{{ (speedAnalysis.avgWrongMs / 1000).toFixed(1) }}s</span>
          <span class="speed-label">错误题平均时间</span>
        </div>
      </div>
      <div v-if="speedAnalysis.fastest && speedAnalysis.slowest" class="speed-details">
        <p>
          最快答题：
          <strong>{{ (speedAnalysis.fastest.elapsedMs / 1000).toFixed(1) }}s</strong>
          （{{ speedAnalysis.fastest.isCorrect ? '正确' : '错误' }}）
        </p>
        <p>
          最慢答题：
          <strong>{{ (speedAnalysis.slowest.elapsedMs / 1000).toFixed(1) }}s</strong>
          （{{ speedAnalysis.slowest.isCorrect ? '正确' : '错误' }}）
        </p>
        <p v-if="speedAnalysis.avgWrongMs > speedAnalysis.avgCorrectMs" class="speed-insight">
          💡 错误题平均耗时比正确题多
          <strong
            >{{
              ((speedAnalysis.avgWrongMs - speedAnalysis.avgCorrectMs) / 1000).toFixed(1)
            }}s</strong
          >， 建议对耗时较长的题目加强练习。
        </p>
      </div>
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
  transition:
    background 0.18s var(--ease-ink),
    color 0.18s var(--ease-ink),
    border-color 0.18s var(--ease-ink);
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

.heatmap-section {
  padding: 8px 0;
}
.heatmap-summary {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 14px;
}
.heatmap-summary strong {
  color: var(--accent);
  font-weight: 600;
}
.heatmap-grid {
  display: grid;
  grid-template-columns: repeat(30, 1fr);
  gap: 3px;
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
}

@media (max-width: 480px) {
  .heatmap-grid {
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .heatmap-labels {
    grid-template-columns: repeat(7, 1fr);
  }
}
.heatmap-cell {
  aspect-ratio: 1;
  border-radius: 2px;
  min-width: 0;
  transition: background 0.18s var(--ease-ink);
}
.heatmap-cell.level-0 {
  background: var(--bg-hover);
}
.heatmap-cell.level-1 {
  background: rgba(74, 222, 128, 0.3);
}
.heatmap-cell.level-2 {
  background: rgba(74, 222, 128, 0.6);
}
.heatmap-cell.level-3 {
  background: rgba(74, 222, 128, 0.9);
}
.heatmap-labels {
  display: grid;
  grid-template-columns: repeat(30, 1fr);
  gap: 3px;
  padding: 4px 12px 0;
}
.heatmap-label {
  font-size: 9px;
  color: var(--text-muted);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  justify-content: flex-end;
}
.heatmap-legend .heatmap-cell {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.heatmap-legend .leg-label {
  font-size: 11px;
  color: var(--text-muted);
}

.speed-section {
  padding: 8px 0;
}
.speed-cards {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.speed-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  min-width: 120px;
  flex: 1;
}
.speed-num {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 600;
  color: var(--accent);
}
.speed-num.correct {
  color: var(--correct);
}
.speed-num.wrong {
  color: var(--wrong);
}
.speed-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
}
.speed-details {
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 16px 20px;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.8;
}
.speed-details strong {
  color: var(--text-primary);
  font-weight: 600;
}
.speed-insight {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  color: var(--accent);
}
</style>
