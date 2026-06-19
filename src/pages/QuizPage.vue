<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loadQuestionBank, getQuestionsByTag, shuffleArray, generateSessionId } from '../services/quizEngine'
import { recordAttempt, updateTagStats, db } from '../db/database'
import { saveActiveSession, loadActiveSession, clearActiveSession, isSessionInProgress, type ActiveSession } from '../services/sessionResume'
import { useActiveCategory, loadActiveCategory, setActiveCategory } from '../services/categoryStore'
import QuestionCard from '../components/QuestionCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import PageSkeleton from '../components/PageSkeleton.vue'
import type { Question } from '../types/question'

const route = useRoute()
const router = useRouter()
const activeCategory = useActiveCategory()

const questions = ref<Question[]>([])
const currentIndex = ref(0)
const selectedKey = ref('')
const submitted = ref(false)
const sessionId = ref('')
const correctCount = ref(0)
const wrongList = ref<string[]>([])
const mode = ref('sequential')
const startTime = ref(0)
const finished = ref(false)
const bookmarked = ref(false)
const startedAt = ref('')
const elapsedTime = ref(0)
const timerInterval = ref<ReturnType<typeof setInterval> | null>(null)
const history = ref<Array<{ questionId: string; selectedKey: string; isCorrect: boolean }>>([])

const currentQuestion = computed(() => questions.value[currentIndex.value] || null)
const progress = computed(() => ({
  current: currentIndex.value + (submitted.value ? 1 : 0),
  total: questions.value.length,
  correct: correctCount.value,
}))
const formattedTime = computed(() => {
  const mins = Math.floor(elapsedTime.value / 60)
  const secs = elapsedTime.value % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
})

function snapshot(submittedNow: boolean): ActiveSession {
  return {
    sessionId: sessionId.value,
    mode: mode.value,
    questionIds: questions.value.map(q => q.id),
    totalQuestions: questions.value.length,
    currentIndex: currentIndex.value,
    submitted: submittedNow,
    correctCount: correctCount.value,
    wrongList: [...wrongList.value],
    startedAt: startedAt.value,
  }
}

function startTimer() {
  stopTimer()
  timerInterval.value = setInterval(() => {
    if (!finished.value) elapsedTime.value++
  }, 1000)
}

function stopTimer() {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
  }
}

onMounted(async () => {
  await loadActiveCategory()
  const queryCat = route.query.category as string | undefined
  if (queryCat === 'grammar' || queryCat === 'word') {
    if (queryCat !== activeCategory.value) {
      await setActiveCategory(queryCat)
    }
  }
  const cat = activeCategory.value
  const all = await loadQuestionBank(cat)
  const groupFilter = route.query.group as string | undefined

  if (route.query.resume === '1') {
    const saved = await loadActiveSession()
    if (isSessionInProgress(saved)) {
      const map = new Map(all.map(q => [q.id, q] as const))
      questions.value = saved.questionIds.map(id => map.get(id)!).filter(Boolean)
      sessionId.value = saved.sessionId
      mode.value = saved.mode
      correctCount.value = saved.correctCount
      wrongList.value = [...saved.wrongList]
      startedAt.value = saved.startedAt
      currentIndex.value = saved.submitted ? saved.currentIndex + 1 : saved.currentIndex
      submitted.value = false
      selectedKey.value = ''
      startTime.value = Date.now()
      history.value = []
      startTimer()
      return
    }
  }

  const modeParam = route.query.tag ? 'tag'
    : route.query.mode === 'untouched' ? 'untouched'
    : route.query.ids ? 'wrong'
    : route.query.mode || 'sequential'

  mode.value = modeParam as string

  if (route.query.tag) {
    questions.value = getQuestionsByTag(route.query.tag as string, cat)
    mode.value = `tag: ${route.query.tag}`
  } else {
    let pool = groupFilter ? all.filter(q => q.groupId === groupFilter) : [...all]
    if (route.query.ids) {
      const idSet = new Set((route.query.ids as string).split(','))
      pool = pool.filter(q => idSet.has(q.id))
      mode.value = modeParam === 'untouched' ? 'untouched' : 'wrong'
    }
    if (groupFilter) {
      const groupTitle = all.find(q => q.groupId === groupFilter)?.groupTitle || groupFilter
      const action = route.query.ids ? (modeParam === 'untouched' ? '未做' : '错题') : modeParam
      mode.value = `${groupTitle} · ${action}`
    }
    questions.value = pool
  }

  if (modeParam === 'random') {
    questions.value = shuffleArray(questions.value)
    if (!groupFilter) mode.value = 'random'
  } else if (modeParam === 'weakness') {
    const stats = await db.questionStats.toArray()
    const validIds = new Set(all.map(q => q.id))
    const weakIds = stats.filter(s => validIds.has(s.questionId) && s.masteryLevel <= 2).map(s => s.questionId)
    const priorityQuestions = weakIds.map(id => all.find(q => q.id === id)!).filter(Boolean)
    const remaining = shuffleArray(all.filter(q => !weakIds.includes(q.id)))
    questions.value = [...priorityQuestions, ...remaining]
    if (!groupFilter) mode.value = 'weakness'
  } else if (modeParam === 'exam') {
    questions.value = shuffleArray([...all])
    if (!groupFilter) mode.value = 'exam'
  }

  sessionId.value = generateSessionId()
  startTime.value = Date.now()
  startedAt.value = new Date().toISOString()
  await saveActiveSession(snapshot(false))
  startTimer()
})

function handleSelect(key: string) {
  if (submitted.value) return
  if (currentQuestion.value?.multiAnswer) {
    const selected = new Set(selectedKey.value.split(''))
    if (selected.has(key)) selected.delete(key)
    else selected.add(key)
    selectedKey.value = [...selected].sort().join('')
  } else {
    selectedKey.value = key
  }
}

async function handleSubmit() {
  if (!selectedKey.value || !currentQuestion.value) return
  submitted.value = true

  const q = currentQuestion.value
  const isCorrect = q.multiAnswer
    ? new Set(selectedKey.value.split('')).size === new Set(q.answerKey.split('')).size
      && [...selectedKey.value].every(k => q.answerKey.includes(k))
    : selectedKey.value === q.answerKey
  if (isCorrect) correctCount.value++
  else wrongList.value.push(q.id)
  history.value.push({ questionId: q.id, selectedKey: selectedKey.value, isCorrect })

  const elapsedMs = Date.now() - startTime.value
  startTime.value = Date.now()

  await recordAttempt({
    questionId: q.id,
    sessionId: sessionId.value,
    selectedKey: selectedKey.value,
    correctKey: q.answerKey,
    isCorrect,
    elapsedMs,
    mode: mode.value,
    createdAt: new Date().toISOString(),
  })

  await updateTagStats(q.tags, isCorrect)

  await db.sessions.put({
    sessionId: sessionId.value,
    mode: mode.value,
    totalQuestions: questions.value.length,
    correctCount: correctCount.value,
    wrongCount: wrongList.value.length,
    startedAt: startedAt.value || new Date().toISOString(),
  } as any)

  await saveActiveSession(snapshot(true))
}

function handleNext() {
  if (currentIndex.value >= questions.value.length - 1) {
    finished.value = true
    stopTimer()
    clearActiveSession()
    return
  }
  currentIndex.value++
  selectedKey.value = ''
  submitted.value = false
  startTime.value = Date.now()
  saveActiveSession(snapshot(false))
}

function handlePrev() {
  if (currentIndex.value <= 0 || history.value.length === 0) return
  history.value.pop()
  currentIndex.value--
  const prev = history.value[history.value.length - 1]
  submitted.value = true
  selectedKey.value = prev ? prev.selectedKey : ''
}

async function handleBookmark() {
  const q = currentQuestion.value
  if (!q) return
  const next = !bookmarked.value
  bookmarked.value = next
  const stat = await db.questionStats.get(q.id)
  if (stat) {
    await db.questionStats.update(q.id, { isBookmarked: next })
  } else {
    await db.questionStats.put({
      questionId: q.id,
      attemptCount: 0,
      correctCount: 0,
      wrongCount: 0,
      lastSelectedKey: '',
      lastCorrect: false,
      lastAttemptAt: '',
      masteryLevel: 0,
      reviewDueAt: '',
      isBookmarked: next,
    })
  }
}

watch(currentQuestion, async (q) => {
  if (!q) { bookmarked.value = false; return }
  const stat = await db.questionStats.get(q.id)
  bookmarked.value = stat?.isBookmarked ?? false
})

function onKeydown(e: KeyboardEvent) {
  if (finished.value) return
  if (!submitted.value) {
    const k = e.key.toUpperCase()
    if (['A', 'B', 'C', 'D', 'E'].includes(k)) handleSelect(k)
    if (e.key === 'Enter' && selectedKey.value) handleSubmit()
  } else {
    if (e.key === 'Enter' || e.key === 'n' || e.key === 'N') handleNext()
    if ((e.key === 'P' || e.key === 'p') && currentIndex.value > 0) handlePrev()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  stopTimer()
})

function restart() {
  currentIndex.value = 0
  selectedKey.value = ''
  submitted.value = false
  correctCount.value = 0
  wrongList.value = []
  finished.value = false
  sessionId.value = generateSessionId()
  startedAt.value = new Date().toISOString()
  questions.value = shuffleArray(questions.value)
  history.value = []
  elapsedTime.value = 0
  saveActiveSession(snapshot(false))
}

function goHome() { router.push('/home') }
</script>
<template>
  <div class="quiz-page">
    <template v-if="!finished && currentQuestion">
      <ProgressBar :current="progress.current" :total="progress.total" :correct="progress.correct" />
      <div class="quiz-info">
        <span>{{ mode }}</span>
        <span class="timer">{{ formattedTime }}</span>
        <span>A/B/C/D 选择 · Enter 提交/下一题 · N 下一题 · P 上一题</span>
      </div>
      <div v-if="submitted && currentIndex > 0" class="q-actions">
        <button class="btn btn-outline" @click="handlePrev">上一题</button>
      </div>
      <QuestionCard
        :key="currentQuestion.id"
        :question="currentQuestion"
        :selected-key="selectedKey"
        :submitted="submitted"
        :mode="mode"
        :question-index="currentIndex"
        :total-questions="questions.length"
        :bookmarked="bookmarked"
        @select="handleSelect"
        @submit="handleSubmit"
        @next="handleNext"
        @bookmark="handleBookmark"
      />
    </template>

    <!-- Finish screen -->
    <div v-else-if="finished" class="finish-page">
      <h2>本轮完成</h2>
      <div class="finish-stat">
        <span class="finish-pct">{{ Math.round((correctCount / questions.length) * 100) }}%</span>
        <span class="finish-label">正确率</span>
      </div>
      <div class="finish-details">
        <p>正确 {{ correctCount }} / {{ questions.length }} 题</p>
        <p v-if="wrongList.length > 0">错误 {{ wrongList.length }} 题</p>
      </div>
      <div class="finish-actions">
        <button class="btn btn-accent" @click="restart">再来一轮</button>
        <button class="btn btn-outline" @click="goHome">返回首页</button>
        <button class="btn btn-outline" v-if="wrongList.length > 0" @click="router.push({ path: '/quiz', query: { ids: wrongList.join(',') } })">只刷错题</button>
      </div>
    </div>

    <div v-else class="empty"><PageSkeleton type="detail" /></div>
  </div>
</template>
<style scoped>
.quiz-page { max-width: 760px; margin: 0 auto; }
.quiz-info { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); margin: 8px 0 18px; }
.timer { font-family: var(--font-mono); color: var(--text-secondary); }
.q-actions { display: flex; gap: 8px; justify-content: center; margin-bottom: 16px; }

.btn { padding: 10px 22px; border: 1px solid var(--border); font-size: 14px; transition: all .12s; }
.btn-accent { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-accent:hover { background: var(--accent-hover); }
.btn-outline { background: transparent; color: var(--text-primary); }
.btn-outline:hover { border-color: var(--accent); color: var(--accent); }

/* Finish */
.finish-page { text-align: center; padding: 80px 20px; }
.finish-page h2 { font-family: var(--font-display); font-size: 22px; font-weight: 700; margin-bottom: 24px; }
.finish-stat { margin-bottom: 16px; }
.finish-pct { font-family: var(--font-display); font-size: 80px; font-weight: 700; color: var(--accent); display: block; line-height: 1; }
.finish-label { font-size: 16px; color: var(--text-secondary); display: block; margin-top: 8px; }
.finish-details { margin-bottom: 32px; font-size: 15px; color: var(--text-secondary); }
.finish-details p { margin: 4px 0; }
.finish-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }

.empty { text-align: center; padding: 80px 20px; color: var(--text-muted); }
</style>
