<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { loadQuestionBank, getAllTags, getAllGroups } from '../services/quizEngine'
import { getWeakTags, getMasterySummary, getWrongQuestionIds, getUntouchedQuestionIds } from '../services/reviewScheduler'
import { db } from '../db/database'
import { loadActiveSession, clearActiveSession, isSessionInProgress, type ActiveSession } from '../services/sessionResume'
import { useActiveCategory, loadActiveCategory } from '../services/categoryStore'
import StatCard from '../components/StatCard.vue'
import TagBadge from '../components/TagBadge.vue'
import PageSkeleton from '../components/PageSkeleton.vue'
import type { Recommendation } from '../services/reviewScheduler'
import type { Question } from '../types/question'

const router = useRouter()
const activeCategory = useActiveCategory()
const loading = ref(true)
const questions = ref<Question[]>([])
const totalQuestions = ref(0)
const doneCount = ref(0)
const totalAttempts = ref(0)
const totalCorrect = ref(0)
const wrongCount = ref(0)
const recentCorrectRate = ref(0)
const weakTags = ref<Recommendation[]>([])
const mastery = ref({ mastered: 0, learning: 0, weak: 0, untouched: 0 })
const wrongIds = ref<string[]>([])
const untouchedIds = ref<string[]>([])
const activeSession = ref<ActiveSession | null>(null)
const groupStats = ref<Record<string, { total: number; done: number; attempts: number; correct: number; wrong: number; wrongIds: string[]; untouchedIds: string[] }>>({})

async function refresh() {
  loading.value = true
  const cat = activeCategory.value
  const all = await loadQuestionBank(cat)
  questions.value = all
  totalQuestions.value = all.length

  const validIds = new Set(all.map(q => q.id))
  const allStatsArr = await db.questionStats.toArray()
  const statsMap = new Map(allStatsArr.map(s => [s.questionId, s]))

  doneCount.value = 0
  totalAttempts.value = 0
  totalCorrect.value = 0
  wrongCount.value = 0
  for (const [id, s] of statsMap) {
    if (!validIds.has(id)) continue
    if (s.attemptCount > 0) doneCount.value++
    totalAttempts.value += s.attemptCount
    totalCorrect.value += s.correctCount
    if (s.wrongCount > 0) wrongCount.value++
  }

  const recentAll = await db.attempts.orderBy('id').reverse().limit(100).toArray()
  const recent = recentAll.filter(a => validIds.has(a.questionId)).slice(0, 30)
  recentCorrectRate.value = recent.length > 0
    ? Math.round((recent.filter(a => a.isCorrect).length / recent.length) * 100)
    : 0

  weakTags.value = await getWeakTags(cat)
  mastery.value = await getMasterySummary(cat)
  wrongIds.value = await getWrongQuestionIds(cat)
  untouchedIds.value = await getUntouchedQuestionIds(cat)

  const groups = getAllGroups(cat)
  const next: typeof groupStats.value = {}
  for (const g of groups) {
    const groupQs = all.filter(q => q.groupId === g.groupId)
    const groupIds = new Set(groupQs.map(q => q.id))
    let gDone = 0, gAttempts = 0, gCorrect = 0, gWrong = 0
    for (const id of groupIds) {
      const s = statsMap.get(id)
      if (!s) continue
      if (s.attemptCount > 0) gDone++
      gAttempts += s.attemptCount
      gCorrect += s.correctCount
      if (s.wrongCount > 0) gWrong++
    }
    next[g.groupId] = {
      total: g.count,
      done: gDone,
      attempts: gAttempts,
      correct: gCorrect,
      wrong: gWrong,
      wrongIds: wrongIds.value.filter(id => groupIds.has(id)),
      untouchedIds: groupQs.filter(q => !statsMap.get(q.id) || statsMap.get(q.id)!.attemptCount === 0).map(q => q.id),
    }
  }
  groupStats.value = next

  const saved = await loadActiveSession()
  activeSession.value = isSessionInProgress(saved) ? saved : null
  if (saved && !isSessionInProgress(saved)) await clearActiveSession()
  loading.value = false
}

onMounted(async () => {
  await loadActiveCategory()
  await refresh()
})

watch(activeCategory, () => { refresh() })

function startQuiz(mode: string) {
  const params: Record<string, string> = { mode }
  if (mode === 'wrong' && wrongIds.value.length > 0) {
    params.ids = wrongIds.value.join(',')
  } else if (mode === 'untouched' && untouchedIds.value.length > 0) {
    params.ids = untouchedIds.value.join(',')
  }
  router.push({ path: '/quiz', query: params })
}

function startTagQuiz(tag: string) {
  router.push({ path: '/quiz', query: { tag } })
}

function startHistoryGroup(groupId: string, mode: 'sequential' | 'random' | 'wrong' | 'untouched') {
  const s = groupStats.value[groupId]
  if (!s) return
  const params: Record<string, string> = { group: groupId, mode }
  if (mode === 'wrong' && s.wrongIds.length > 0) {
    params.ids = s.wrongIds.join(',')
  } else if (mode === 'untouched' && s.untouchedIds.length > 0) {
    params.ids = s.untouchedIds.join(',')
  }
  router.push({ path: '/quiz', query: params })
}

function resumeSession() {
  router.push({ path: '/quiz', query: { resume: '1' } })
}

async function discardSession() {
  await clearActiveSession()
  activeSession.value = null
}

const titleText = computed(() => {
  if (activeCategory.value === 'word') return '日语单词题库'
  if (activeCategory.value === 'history') return '中国近现代史'
  if (activeCategory.value === 'party') return '中国共产党党史'
  if (activeCategory.value === 'military') return '军事理论'
  return '日语期末复习题库'
})
const subtitleText = computed(() => {
  if (activeCategory.value === 'word') return `${totalQuestions.value} 题 · 第26-36课 · 汉字 / 假名`
  if (activeCategory.value === 'history') return `${totalQuestions.value} 题 · 11个刷题单 · 单选/多选/判断`
  if (activeCategory.value === 'party') return `${totalQuestions.value} 题 · 7个刷题单 · 单选/多选/判断`
  if (activeCategory.value === 'military') return `${totalQuestions.value} 题 · 22个刷题单 · 单选/多选/判断`
  return `${totalQuestions.value} 题 · 10大题组 · 智能复习`
})
const tagSectionTitle = computed(() => activeCategory.value === 'word' ? '按课/标签复习' : '按语法标签复习')
const weakSectionTitle = computed(() => activeCategory.value === 'word' ? '薄弱课/标签' : '薄弱语法点')

const isGroupView = computed(() =>
  activeCategory.value === 'history' || activeCategory.value === 'party' || activeCategory.value === 'military',
)

const GROUP_ORDER: Record<string, string[]> = {
  history: ['t0', 't1', 't2', 't3', 't5-1', 't5-2', 't5-3', 't5-4', 'hist-a', 'hist-b', 'hist-c'],
  party: ['party-single', 'party-multi', 'party-judge', 'party-p1', 'party-p2', 'party-p3', 'party-p4'],
  military: [
    'military-ch1', 'military-ch2', 'military-ch3', 'military-ch4', 'military-ch5',
    'military-ch6', 'military-ch7', 'military-ch8', 'military-ch9', 'military-ch10',
    'military-ch11', 'military-ch12', 'military-ch13', 'military-ch14', 'military-ch15',
    'military-ch16', 'military-ch17', 'military-ch18',
    'military-p1', 'military-p2', 'military-p3', 'military-p4',
  ],
}

const groupViewList = computed(() => {
  const cat = activeCategory.value
  if (cat !== 'history' && cat !== 'party' && cat !== 'military') return []
  const order = GROUP_ORDER[cat]
  const titles: Record<string, string> = {}
  for (const q of questions.value) titles[q.groupId] = q.groupTitle
  const groups = getAllGroups(cat)
  const seen = new Set<string>()
  const ordered = order
    .map(id => {
      const g = groups.find(x => x.groupId === id)
      if (!g) return null
      seen.add(id)
      return { groupId: id, groupTitle: titles[id] || g.groupTitle, count: g.count }
    })
    .filter(Boolean) as { groupId: string; groupTitle: string; count: number }[]
  for (const g of groups) {
    if (!seen.has(g.groupId)) {
      ordered.push({ groupId: g.groupId, groupTitle: g.groupTitle, count: g.count })
    }
  }
  return ordered
})

const groupViewSectionTitle = computed(() => {
  if (activeCategory.value === 'party') return '刷题单（按题型 / 按优先级）'
  if (activeCategory.value === 'military') return '刷题单（按章节 / 按优先级）'
  return '刷题单'
})
const groupViewHint = computed(() => {
  if (activeCategory.value === 'party') return '每单独立计分。「按题型」组与「按优先级」组共享同一批题目，可任选节奏。'
  if (activeCategory.value === 'military') return '每单独立计分。「按章节」组与「按优先级」组共享同一批题目；P1 必考核心建议先刷。'
  return '每单独立计分，互不影响。机考模拟按试卷拆成 4 个独立组。'
})
</script>
<template>
  <div v-if="loading" class="home"><PageSkeleton type="card" /></div>
  <div v-else class="home">
    <!-- Header -->
    <header class="home-header">
      <h1>{{ titleText }}</h1>
      <p class="subtitle">{{ subtitleText }}</p>
    </header>

    <!-- Resume banner -->
    <div v-if="activeSession" class="resume-banner">
      <div class="resume-info">
        <span class="resume-title">继续上次</span>
        <span class="resume-meta">第 {{ (activeSession.submitted ? activeSession.currentIndex + 1 : activeSession.currentIndex) + 1 }}/{{ activeSession.totalQuestions }} 题 · {{ activeSession.mode }}</span>
      </div>
      <div class="resume-actions">
        <button class="btn btn-accent" @click="resumeSession">继续</button>
        <button class="btn btn-ghost" @click="discardSession">放弃</button>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-row">
      <StatCard label="待复习" :value="Math.max(5, wrongIds.length)" sub="优先复习错题" />
      <StatCard label="总进度" :value="`${doneCount}/${totalQuestions}`" sub="已做 / 总题数" />
      <StatCard label="总正确率" :value="totalAttempts ? Math.round(totalCorrect / totalAttempts * 100) + '%' : '--'" />
      <StatCard label="近期正确率" :value="doneCount ? recentCorrectRate + '%' : '--'" sub="近30题" />
      <StatCard label="错题数" :value="wrongCount" sub="有待重刷" />
    </div>

    <!-- Mastery bar -->
    <section class="section">
      <h2>掌握程度</h2>
      <div class="mastery-bar">
        <div class="seg mastered" :style="{ flex: mastery.mastered }">{{ mastery.mastered }}</div>
        <div class="seg learning" :style="{ flex: mastery.learning }">{{ mastery.learning }}</div>
        <div class="seg weak" :style="{ flex: mastery.weak }">{{ mastery.weak }}</div>
        <div class="seg untouched" :style="{ flex: mastery.untouched }">{{ mastery.untouched }}</div>
      </div>
      <div class="mastery-legend">
        <span>已掌握</span><span>学习中</span><span>薄弱</span><span>未做</span>
      </div>
    </section>

    <!-- Quick actions (grammar/word) -->
    <section class="section" v-if="!isGroupView">
      <h2>快速开始</h2>
      <div class="quick-actions">
        <button class="btn btn-accent" @click="startQuiz('sequential')">顺序刷题</button>
        <button class="btn btn-outline" @click="startQuiz('random')">随机刷题</button>
        <button class="btn btn-outline" @click="startQuiz('untouched')" v-if="untouchedIds.length > 0">未做题 ({{ untouchedIds.length }})</button>
        <button class="btn btn-outline danger" @click="startQuiz('wrong')" v-if="wrongIds.length > 0">错题重刷 ({{ wrongIds.length }})</button>
        <button class="btn btn-outline" @click="startQuiz('weakness')">弱点突破</button>
      </div>
    </section>

    <!-- Weak tags -->
    <section class="section" v-if="weakTags.length > 0 && !isGroupView">
      <h2>{{ weakSectionTitle }}</h2>
      <div class="weak-list">
        <div v-for="w in weakTags.slice(0, 6)" :key="w.tag" class="weak-item" @click="startTagQuiz(w.tag)">
          <div class="weak-info">
            <span class="weak-tag">{{ w.tag }}</span>
            <span class="weak-rate">正确率 {{ w.correctRate }}%</span>
          </div>
          <div class="weak-bar-bg"><div class="weak-bar" :style="{ width: w.correctRate + '%', background: w.correctRate < 50 ? 'var(--wrong)' : w.correctRate < 70 ? 'var(--warning)' : 'var(--correct)' }" /></div>
          <span class="weak-arrow">&rarr;</span>
        </div>
      </div>
    </section>

    <!-- Group cards (history/party/military) -->
    <section class="section" v-if="isGroupView">
      <h2>{{ groupViewSectionTitle }}</h2>
      <p class="section-hint">{{ groupViewHint }}</p>
      <div class="group-grid">
        <div v-for="g in groupViewList" :key="g.groupId" class="group-card">
          <div class="gc-header">
            <span class="gc-title">{{ g.groupTitle }}</span>
            <span class="gc-count">{{ (groupStats[g.groupId]?.total ?? g.count) }} 题</span>
          </div>
          <div class="gc-stats">
            <span>已做 <strong>{{ groupStats[g.groupId]?.done ?? 0 }}</strong></span>
            <span>正确率 <strong>{{ groupStats[g.groupId] && groupStats[g.groupId].attempts ? Math.round(groupStats[g.groupId].correct / groupStats[g.groupId].attempts * 100) + '%' : '--' }}</strong></span>
            <span>错题 <strong>{{ groupStats[g.groupId]?.wrong ?? 0 }}</strong></span>
          </div>
          <div class="gc-actions">
            <button class="btn btn-accent btn-sm" @click="startHistoryGroup(g.groupId, 'sequential')">顺序</button>
            <button class="btn btn-outline btn-sm" @click="startHistoryGroup(g.groupId, 'random')">随机</button>
            <button class="btn btn-outline btn-sm danger" @click="startHistoryGroup(g.groupId, 'wrong')" :disabled="(groupStats[g.groupId]?.wrongIds.length ?? 0) === 0">错题 ({{ groupStats[g.groupId]?.wrongIds.length ?? 0 }})</button>
            <button class="btn btn-outline btn-sm" @click="startHistoryGroup(g.groupId, 'untouched')" :disabled="(groupStats[g.groupId]?.untouchedIds.length ?? 0) === 0">未做 ({{ groupStats[g.groupId]?.untouchedIds.length ?? 0 }})</button>
          </div>
        </div>
      </div>
    </section>

    <!-- Tag cloud (grammar/word) -->
    <section class="section" v-if="!isGroupView">
      <h2>{{ tagSectionTitle }}</h2>
      <div class="tag-cloud">
        <TagBadge v-for="t in getAllTags(activeCategory).slice(0, 20)" :key="t.tag" :tag="t.tag" :clickable="true" @click="startTagQuiz(t.tag)" />
      </div>
    </section>
  </div>
</template>
<style scoped>
.home { max-width: 900px; margin: 0 auto; }

/* Header */
.home-header { margin-bottom: 28px; }
h1 { font-family: var(--font-display); font-size: 22px; font-weight: 700; margin-bottom: 4px; letter-spacing: 1px; }
.subtitle { color: var(--text-secondary); font-size: 14px; }

/* Resume banner */
.resume-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 14px 18px; margin-bottom: 24px; border: 1px solid var(--border);
  background: var(--bg-card);
}
.resume-info { display: flex; flex-direction: column; gap: 2px; }
.resume-title { font-weight: 600; font-size: 14px; }
.resume-meta { font-size: 12px; color: var(--text-secondary); }
.resume-actions { display: flex; gap: 8px; }

/* Stats */
.stats-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 32px; }

/* Section */
.section { margin-bottom: 32px; }
.section h2 {
  font-family: var(--font-display); font-size: 15px; font-weight: 600;
  margin-bottom: 14px; color: var(--text-primary);
}

/* Mastery bar */
.mastery-bar { display: flex; height: 24px; overflow: hidden; margin-bottom: 8px; }
.mastery-bar .seg {
  display: flex; align-items: center; justify-content: center;
  font-weight: 600; font-size: 12px; color: #fff; min-width: 0;
  transition: flex .4s ease;
}
.mastered { background: var(--correct); }
.learning { background: #5a7d9a; }
.weak { background: var(--warning); }
.untouched { background: #c0bfbc; }
.mastery-legend {
  display: flex; gap: 20px; font-size: 12px; color: var(--text-muted);
}

/* Quick actions */
.quick-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* Weak list */
.weak-list { display: flex; flex-direction: column; gap: 6px; }
.weak-item {
  display: flex; align-items: center; gap: 14px; padding: 10px 14px;
  border: 1px solid var(--border); background: var(--bg-card);
  cursor: pointer; transition: all .12s;
}
.weak-item:hover { border-color: var(--accent); }
.weak-info { min-width: 140px; display: flex; flex-direction: column; }
.weak-tag { font-weight: 600; font-size: 14px; }
.weak-rate { font-size: 12px; color: var(--text-muted); }
.weak-bar-bg { flex: 1; height: 4px; background: var(--bg-hover); overflow: hidden; }
.weak-bar { height: 100%; transition: width .3s; }
.weak-arrow { color: var(--text-muted); }

/* Tag cloud */
.tag-cloud { display: flex; flex-wrap: wrap; gap: 2px; }

/* Group grid */
.section-hint { color: var(--text-muted); font-size: 13px; margin-bottom: 16px; line-height: 1.6; }
.group-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.group-card {
  background: var(--bg-card); border: 1px solid var(--border);
  padding: 16px; display: flex; flex-direction: column; gap: 10px;
}
.gc-header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.gc-title { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--text-primary); }
.gc-count { font-size: 13px; color: var(--text-muted); }
.gc-stats { display: flex; gap: 16px; font-size: 13px; color: var(--text-secondary); }
.gc-stats strong { color: var(--text-primary); font-weight: 600; }
.gc-actions { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
