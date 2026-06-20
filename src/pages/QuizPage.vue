<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  loadQuestionBank,
  getQuestionsByTag,
  shuffleArray,
  generateSessionId,
  isMultiAnswerCorrect,
  filterVisibleQuestions,
} from '../services/quizEngine'
import {
  recordAttempt,
  updateTagStats,
  createDefaultStats,
  db,
  createSession,
} from '../db/database'
import {
  saveActiveSession,
  loadActiveSession,
  clearActiveSession,
  isSessionInProgress,
  type ActiveSession,
} from '../services/sessionResume'
import { useActiveCategory, loadActiveCategory, setActiveCategory } from '../services/categoryStore'
import { useHiddenSite } from '../composables/useHiddenSite'
import QuestionCard from '../components/QuestionCard.vue'
import QuestionNavigator from '../components/QuestionNavigator.vue'
import ProgressBar from '../components/ProgressBar.vue'
import PageSkeleton from '../components/PageSkeleton.vue'
import type { Question, QuizMode } from '../types/question'

const route = useRoute()
const router = useRouter()
const activeCategory = useActiveCategory()
const { isUnlocked } = useHiddenSite()

const questions = ref<Question[]>([])
const currentIndex = ref(0)
const selectedKey = ref('')
const submitted = ref(false)
const sessionId = ref('')
const correctCount = ref(0)
const wrongList = ref<string[]>([])
const mode = ref('')
const startTime = ref(0)
const finished = ref(false)
const bookmarked = ref(false)
const startedAt = ref('')
const elapsedTime = ref(0)
const timerInterval = ref<ReturnType<typeof setInterval> | null>(null)
const history = ref<Array<{ questionId: string; selectedKey: string; isCorrect: boolean }>>([])
const drafts = ref<Map<number, string>>(new Map())
const slideDirection = ref<'slide-left' | 'slide-right'>('slide-left')

type CellStatus = 'correct' | 'wrong' | 'draft' | 'unanswered'

function statusOf(i: number): CellStatus {
  const h = history.value[i]
  if (h) return h.isCorrect ? 'correct' : 'wrong'
  return drafts.value.has(i) ? 'draft' : 'unanswered'
}

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
    questionIds: questions.value.map((q) => q.id),
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

// 把 query 解析成 { mode, pool, display }，避免在 onMounted 里反复覆盖 mode.value
function resolveMode(all: Question[]): {
  poolMode: QuizMode
  displayMode: string
  pool: Question[]
} {
  const tag = route.query.tag as string | undefined
  const groupFilter = route.query.group as string | undefined
  const groupsParam = route.query.groups as string | undefined
  const idsParam = route.query.ids as string | undefined
  const modeParam = route.query.mode as string | undefined

  if (tag) {
    return {
      poolMode: 'tag',
      displayMode: `tag: ${tag}`,
      pool: filterVisibleQuestions(getQuestionsByTag(tag, activeCategory.value), isUnlocked.value),
    }
  }

  let pool: Question[]
  if (groupsParam) {
    const groupSet = new Set(groupsParam.split(','))
    pool = all.filter((q) => groupSet.has(q.groupId))
  } else if (groupFilter) {
    pool = all.filter((q) => q.groupId === groupFilter)
  } else {
    pool = [...all]
  }
  if (idsParam) {
    const idSet = new Set(idsParam.split(','))
    pool = pool.filter((q) => idSet.has(q.id))
  }

  const poolMode: QuizMode = idsParam
    ? modeParam === 'untouched'
      ? 'untouched'
      : 'wrong'
    : modeParam === 'untouched'
      ? 'untouched'
      : (modeParam as QuizMode) || 'sequential'

  let displayMode: string = poolMode
  if (groupsParam) {
    displayMode = `套题 · ${poolMode}`
  } else if (groupFilter) {
    const groupTitle = all.find((q) => q.groupId === groupFilter)?.groupTitle || groupFilter
    const action = idsParam ? (modeParam === 'untouched' ? '未做' : '错题') : poolMode
    displayMode = `${groupTitle} · ${action}`
  }

  return { poolMode, displayMode, pool }
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
  // 表站未解锁时剔除里站题（g11/g21–g28）。里站入口设了 subBank 后 isUnlocked 必为 true，no-op。
  const all = filterVisibleQuestions(await loadQuestionBank(cat), isUnlocked.value)

  if (route.query.resume === '1') {
    const saved = await loadActiveSession()
    if (isSessionInProgress(saved)) {
      const map = new Map(all.map((q) => [q.id, q] as const))
      questions.value = saved.questionIds.map((id) => map.get(id)!).filter(Boolean)
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

  const { poolMode, displayMode, pool } = resolveMode(all)
  mode.value = displayMode

  let finalPool = pool
  if (poolMode === 'random') {
    finalPool = shuffleArray(pool)
  } else if (poolMode === 'weakness') {
    const stats = await db.questionStats.toArray()
    const validIds = new Set(all.map((q) => q.id))
    const weakIds = stats
      .filter((s) => validIds.has(s.questionId) && s.masteryLevel <= 2)
      .map((s) => s.questionId)
    const weakSet = new Set(weakIds)
    const priorityQuestions = weakIds.map((id) => all.find((q) => q.id === id)!).filter(Boolean)
    const remaining = shuffleArray(all.filter((q) => !weakSet.has(q.id)))
    finalPool = [...priorityQuestions, ...remaining]
  } else if (poolMode === 'exam') {
    finalPool = shuffleArray([...all])
  }
  questions.value = finalPool

  sessionId.value = generateSessionId()
  startTime.value = Date.now()
  startedAt.value = new Date().toISOString()
  await saveActiveSession(snapshot(false))
  startTimer()

  window.addEventListener('keydown', onKeydown)
})

function handleSelect(key: string) {
  if (submitted.value) return
  // QuestionCard already computed the correct toggled/new value
  selectedKey.value = key
}

async function handleSubmit() {
  if (!selectedKey.value || !currentQuestion.value) return
  submitted.value = true

  const q = currentQuestion.value
  const isCorrect = q.multiAnswer
    ? isMultiAnswerCorrect(selectedKey.value, q.answerKey)
    : selectedKey.value === q.answerKey

  // 「回去改」的再提交：history[currentIndex] 已存在 —— 用差值更新 correctCount/wrongList，
  // 避免一道题被双重计入。原 history 项被替换。
  const existing = history.value[currentIndex.value]
  if (existing) {
    if (existing.isCorrect !== isCorrect) {
      if (isCorrect) {
        correctCount.value++
        const idx = wrongList.value.indexOf(q.id)
        if (idx >= 0) wrongList.value.splice(idx, 1)
      } else {
        correctCount.value = Math.max(0, correctCount.value - 1)
        if (!wrongList.value.includes(q.id)) wrongList.value.push(q.id)
      }
    }
    history.value[currentIndex.value] = {
      questionId: q.id,
      selectedKey: selectedKey.value,
      isCorrect,
    }
  } else {
    if (isCorrect) correctCount.value++
    else wrongList.value.push(q.id)
    history.value[currentIndex.value] = {
      questionId: q.id,
      selectedKey: selectedKey.value,
      isCorrect,
    }
  }
  drafts.value.delete(currentIndex.value)

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

  await db.sessions.put(
    createSession({
      mode: mode.value,
      totalQuestions: questions.value.length,
      correctCount: correctCount.value,
      wrongCount: wrongList.value.length,
      startedAt: startedAt.value || new Date().toISOString(),
    }),
  )

  await saveActiveSession(snapshot(true))
}

function saveCurrentDraft() {
  if (!submitted.value && selectedKey.value) {
    drafts.value.set(currentIndex.value, selectedKey.value)
  } else if (submitted.value) {
    drafts.value.delete(currentIndex.value)
  }
}

async function jumpTo(i: number) {
  if (i === currentIndex.value || i < 0 || i >= questions.value.length) return
  saveCurrentDraft()
  slideDirection.value = i > currentIndex.value ? 'slide-left' : 'slide-right'
  currentIndex.value = i
  const h = history.value[i]
  submitted.value = false
  selectedKey.value = h ? h.selectedKey : (drafts.value.get(i) ?? '')
  startTime.value = Date.now()
  await saveActiveSession(snapshot(false))
}

async function goOffset(delta: number) {
  const next = currentIndex.value + delta
  if (next < 0 || next >= questions.value.length) return
  await jumpTo(next)
}

async function handleNext() {
  if (currentIndex.value >= questions.value.length - 1) {
    finished.value = true
    stopTimer()
    await clearActiveSession()
    return
  }
  slideDirection.value = 'slide-left'
  await jumpTo(currentIndex.value + 1)
}

async function handlePrev() {
  if (currentIndex.value <= 0) return
  slideDirection.value = 'slide-right'
  await jumpTo(currentIndex.value - 1)
}

function handleSwipePrev() {
  if (currentIndex.value <= 0) return
  void handlePrev()
}

function handleSwipeNext() {
  if (currentIndex.value >= questions.value.length - 1) {
    return
  }
  void handleNext()
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
    await db.questionStats.put(createDefaultStats(q.id, { isBookmarked: next }))
  }
}

watch(currentQuestion, async (q) => {
  if (!q) {
    bookmarked.value = false
    return
  }
  const stat = await db.questionStats.get(q.id)
  bookmarked.value = stat?.isBookmarked ?? false
})

function onKeydown(e: KeyboardEvent) {
  if (finished.value) return
  if (!submitted.value) {
    const k = e.key.toUpperCase()
    if (['A', 'B', 'C', 'D', 'E'].includes(k)) handleSelect(k)
    else if (['1', '2', '3', '4', '5'].includes(e.key)) {
      const keyIndex = Number(e.key) - 1
      handleSelect(['A', 'B', 'C', 'D', 'E'][keyIndex])
    }
    if (e.key === 'Enter' && selectedKey.value) handleSubmit()
  } else {
    if (e.key === 'Enter' || e.key === 'n' || e.key === 'N') handleNext()
    if ((e.key === 'P' || e.key === 'p') && currentIndex.value > 0) handlePrev()
  }
}

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  stopTimer()
})

async function restart() {
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
  drafts.value.clear()
  elapsedTime.value = 0
  await saveActiveSession(snapshot(false))
}

function goHome() {
  router.push('/home')
}
</script>
<template>
  <div class="quiz-page">
    <template v-if="!finished && currentQuestion">
      <ProgressBar
        :current="progress.current"
        :total="progress.total"
        :correct="progress.correct"
        :current-index="currentIndex"
        @scrub="jumpTo"
      />
      <QuestionNavigator
        :current-index="currentIndex"
        :total="questions.length"
        :status-of="statusOf"
        @jump="jumpTo"
      />
      <div class="quiz-info">
        <span>{{ mode }}</span>
        <span class="timer">{{ formattedTime }}</span>
        <span>A/B/C/D 选择 · Enter 提交/下一题 · N 下一题 · P 上一题</span>
      </div>
      <Transition :name="slideDirection" mode="out-in">
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
          @prev="handlePrev"
          @bookmark="handleBookmark"
          @swipe-prev="handleSwipePrev"
          @swipe-next="handleSwipeNext"
        />
      </Transition>
    </template>

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
        <button
          class="btn btn-outline"
          v-if="wrongList.length > 0"
          @click="router.push({ path: '/quiz', query: { ids: wrongList.join(',') } })"
        >
          只刷错题
        </button>
      </div>
    </div>

    <div v-else class="empty"><PageSkeleton type="detail" /></div>
  </div>
</template>
<style scoped>
.quiz-page {
  max-width: 760px;
  margin: 0 auto;
}
.quiz-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
  margin: 8px 0 18px;
  flex-wrap: wrap;
  gap: 4px 12px;
}

/* slide transitions for question switching */
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition:
    transform 0.26s cubic-bezier(0.22, 0.68, 0.25, 1),
    opacity 0.22s ease;
}
.slide-left-enter-from {
  transform: translateX(38px);
  opacity: 0;
}
.slide-left-leave-to {
  transform: translateX(-38px);
  opacity: 0;
}
.slide-right-enter-from {
  transform: translateX(-38px);
  opacity: 0;
}
.slide-right-leave-to {
  transform: translateX(38px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .slide-left-enter-active,
  .slide-left-leave-active,
  .slide-right-enter-active,
  .slide-right-leave-active {
    transition: opacity 0.12s ease;
  }
  .slide-left-enter-from,
  .slide-left-leave-to,
  .slide-right-enter-from,
  .slide-right-leave-to {
    transform: none;
  }
}
.timer {
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.btn {
  padding: 10px 22px;
  border: 1px solid var(--border);
  font-size: 14px;
  transition: all 0.12s;
}
.btn-accent {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn-accent:hover {
  background: var(--accent-hover);
}
.btn-outline {
  background: transparent;
  color: var(--text-primary);
}
.btn-outline:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.finish-page {
  text-align: center;
  padding: 80px 20px;
}
.finish-page h2 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 24px;
}
.finish-stat {
  margin-bottom: 16px;
}
.finish-pct {
  font-family: var(--font-display);
  font-size: 80px;
  font-weight: 700;
  color: var(--accent);
  display: block;
  line-height: 1;
}
.finish-label {
  font-size: 16px;
  color: var(--text-secondary);
  display: block;
  margin-top: 8px;
}
.finish-details {
  margin-bottom: 32px;
  font-size: 15px;
  color: var(--text-secondary);
}
.finish-details p {
  margin: 4px 0;
}
.finish-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}

.empty {
  text-align: center;
  padding: 80px 20px;
  color: var(--text-muted);
}

@media (max-width: 480px) {
  .quiz-page {
    padding: 0 8px;
  }
  .quiz-info {
    font-size: 11px;
  }
  .quiz-info span:nth-child(3) {
    display: none;
  }
  .finish-page {
    padding: 48px 16px;
  }
  .finish-page h2 {
    font-size: 20px;
  }
  .finish-pct {
    font-size: 56px;
  }
  .finish-details {
    font-size: 14px;
  }
  .finish-actions .btn {
    padding: 8px 16px;
    font-size: 13px;
  }
}
</style>
