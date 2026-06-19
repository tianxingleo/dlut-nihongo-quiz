<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { loadQuestionBank, getAllGrammarPoints } from '../services/quizEngine'
import { db } from '../db/database'
import { useActiveCategory, loadActiveCategory } from '../services/categoryStore'
import type { QuestionStats, Question } from '../types/question'

const activeCategory = useActiveCategory()
const questions = ref<Question[]>([])
const stats = ref<QuestionStats[]>([])
const viewMode = ref<'groups' | 'tags' | 'wrong'>('groups')

async function refresh() {
  const cat = activeCategory.value
  questions.value = await loadQuestionBank(cat)
  const allStats = await db.questionStats.toArray()
  const validIds = new Set(questions.value.map(q => q.id))
  stats.value = allStats.filter(s => validIds.has(s.questionId))
}

onMounted(async () => {
  await loadActiveCategory()
  await refresh()
})

watch(activeCategory, () => { refresh() })

const groupAnalysis = computed(() => {
  const map = new Map<string, { total: number; done: number; correct: number; wrong: number }>()
  for (const q of questions.value) {
    if (!map.has(q.groupId)) map.set(q.groupId, { total: 0, done: 0, correct: 0, wrong: 0 })
    const g = map.get(q.groupId)!
    g.total++
    const s = stats.value.find(st => st.questionId === q.id)
    if (s && s.attemptCount > 0) {
      g.done++
      g.correct += s.correctCount
      g.wrong += s.wrongCount
    }
  }
  return [...map.entries()].map(([id, data]) => ({
    id,
    title: questions.value.find(q => q.groupId === id)?.groupTitle || id,
    ...data,
    rate: data.done > 0 ? Math.round(data.correct / (data.correct + data.wrong) * 100) : 0,
  })).sort((a, b) => a.id.localeCompare(b.id))
})

const tagAnalysis = computed(() => {
  const points = getAllGrammarPoints(activeCategory.value)
  const tagSource = activeCategory.value === 'word'
    ? questions.value.flatMap(q => q.tags).filter(t => t !== '单词').map(t => ({ point: t, count: 0 }))
    : points
  const seen = new Set<string>()
  const deduped = tagSource.filter(p => {
    if (seen.has(p.point)) return false
    seen.add(p.point)
    return true
  }).slice(0, 15)

  return deduped.map(p => {
    const qs = questions.value.filter(q => q.grammarPoints.includes(p.point) || q.tags.includes(p.point))
    let correct = 0; let total = 0
    for (const q of qs) {
      const s = stats.value.find(st => st.questionId === q.id)
      if (s && s.attemptCount > 0) {
        total += s.attemptCount
        correct += s.correctCount
      }
    }
    return { point: p.point, questionCount: qs.length, attempts: total, rate: total > 0 ? Math.round(correct / total * 100) : 0 }
  })
})

const topWrongQuestions = computed(() => {
  const wrong = stats.value.filter(s => s.wrongCount > 0).sort((a, b) => b.wrongCount - a.wrongCount).slice(0, 10)
  return wrong.map(s => {
    const q = questions.value.find(qq => qq.id === s.questionId)
    return { id: s.questionId, stem: q?.stem?.substring(0, 50) || '', wrongCount: s.wrongCount, rate: s.attemptCount > 0 ? Math.round(s.correctCount / s.attemptCount * 100) : 0 }
  })
})

const overallStats = computed(() => {
  const totalAttempts = stats.value.reduce((sum, s) => sum + s.attemptCount, 0)
  const totalCorrect = stats.value.reduce((sum, s) => sum + s.correctCount, 0)
  return {
    totalQuestions: questions.value.length,
    doneQuestions: stats.value.filter(s => s.attemptCount > 0).length,
    totalAttempts,
    totalCorrect,
    overallRate: totalAttempts > 0 ? Math.round(totalCorrect / totalAttempts * 100) : 0,
  }
})

const tagTableHeader = computed(() => activeCategory.value === 'word' ? '课/标签' : '语法点')
const tagTabLabel = computed(() => activeCategory.value === 'word' ? '按课/标签' : '按语法标签')
</script>
<template>
  <div class="analysis-page">
    <header class="page-header">
      <h1>数据分析</h1>
    </header>

    <div class="overview-cards">
      <div class="card"><span class="num">{{ overallStats.totalQuestions }}</span><span class="lbl">总题数</span></div>
      <div class="card"><span class="num">{{ overallStats.doneQuestions }}</span><span class="lbl">已做</span></div>
      <div class="card"><span class="num">{{ overallStats.totalAttempts }}</span><span class="lbl">总提交</span></div>
      <div class="card"><span class="num">{{ overallStats.overallRate }}%</span><span class="lbl">总正确率</span></div>
    </div>

    <div class="tabs">
      <button :class="{ active: viewMode === 'groups' }" @click="viewMode = 'groups'">按题组</button>
      <button :class="{ active: viewMode === 'tags' }" @click="viewMode = 'tags'">{{ tagTabLabel }}</button>
      <button :class="{ active: viewMode === 'wrong' }" @click="viewMode = 'wrong'">高频错题</button>
    </div>

    <table v-if="viewMode === 'groups'" class="data-table">
      <thead><tr><th>题组</th><th>题数</th><th>已做</th><th>正确率</th><th>进度</th></tr></thead>
      <tbody>
        <tr v-for="g in groupAnalysis" :key="g.id">
          <td><strong>{{ g.title }}</strong></td>
          <td>{{ g.total }}</td>
          <td>{{ g.done }}</td>
          <td :class="g.rate >= 70 ? 'green' : g.rate >= 40 ? 'yellow' : 'red'">{{ g.rate }}%</td>
          <td><div class="mini-bar"><div :style="{ width: (g.done/g.total*100)+'%' }" /></div></td>
        </tr>
      </tbody>
    </table>

    <table v-if="viewMode === 'tags'" class="data-table">
      <thead><tr><th>{{ tagTableHeader }}</th><th>题数</th><th>做题次数</th><th>正确率</th><th>状态</th></tr></thead>
      <tbody>
        <tr v-for="t in tagAnalysis" :key="t.point">
          <td><strong>{{ t.point }}</strong></td>
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
  </div>
</template>
<style scoped>
.analysis-page { max-width: 900px; margin: 0 auto; }
.page-header { margin-bottom: 24px; }
h1 { font-family: var(--font-display); font-size: 22px; font-weight: 700; }

.overview-cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 28px; }
.card {
  background: var(--bg-card); border: 1px solid var(--border);
  padding: 16px 20px; display: flex; flex-direction: column; min-width: 100px; flex: 1;
}
.num { font-family: var(--font-display); font-size: 28px; font-weight: 600; color: var(--accent); line-height: 1.1; }
.lbl { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }

.tabs { display: flex; gap: 4px; margin-bottom: 18px; }
.tabs button {
  padding: 6px 16px; border: 1px solid var(--border); background: var(--bg-card);
  color: var(--text-secondary); font-size: 13px; transition: all .12s;
}
.tabs button:hover { color: var(--text-primary); border-color: var(--text-primary); }
.tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }

.data-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.data-table th { text-align: left; padding: 10px 14px; border-bottom: 2px solid var(--border); color: var(--text-secondary); font-weight: 600; }
.data-table td { padding: 10px 14px; border-bottom: 1px solid var(--border); }
.green { color: var(--correct); font-weight: 600; }
.yellow { color: var(--warning); font-weight: 600; }
.red { color: var(--wrong); font-weight: 600; }
.mini-bar { width: 100px; height: 4px; background: var(--bg-hover); overflow: hidden; }
.mini-bar div { height: 100%; background: var(--accent); }

.status { font-size: 12px; padding: 2px 8px; border: 1px solid var(--border); }
.status.good { border-color: rgba(45,106,79,.3); color: var(--correct); }
.status.warn { border-color: rgba(184,134,11,.3); color: var(--warning); }
.status.bad { border-color: rgba(196,69,54,.3); color: var(--wrong); }
.status.na { color: var(--text-muted); }

.wrong-table { display: flex; flex-direction: column; gap: 6px; }
.wrong-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  border: 1px solid var(--border); background: var(--bg-card); font-size: 14px;
}
.w-id { font-weight: 600; color: var(--accent); font-family: var(--font-mono); min-width: 90px; }
.w-stem { flex: 1; color: var(--text-primary); }
.w-count { color: var(--wrong); font-weight: 600; }
.w-rate { color: var(--text-secondary); }
.empty { text-align: center; padding: 60px; color: var(--text-secondary); }
</style>
