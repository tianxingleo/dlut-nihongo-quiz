<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import {
  loadQuestionBank,
  getQuestionsByTag,
  shuffleArray,
  generateSessionId,
  isMultiAnswerCorrect,
  filterVisibleQuestions,
  toggleMultiSelect,
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
import { renderMarkdown, stripMarkdown } from '../utils/renderMarkdown'
import { truncate } from '../utils/text'
import type { Question, QuizMode, Category } from '../types/question'

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
const bookmarkCache = ref<Set<string>>(new Set())
const startedAt = ref('')
const elapsedTime = ref(0)
const timerInterval = ref<ReturnType<typeof setInterval> | null>(null)
const history = ref<Array<{ questionId: string; selectedKey: string; isCorrect: boolean }>>([])
const drafts = ref<Map<number, string>>(new Map())
const slideDirection = ref<'slide-left' | 'slide-right'>('slide-left')
const showLeaveConfirm = ref(false)
const loadError = ref('')
let pendingNavigation: (() => void) | null = null

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

const wrongQuestions = computed(() => {
  const idSet = new Set(wrongList.value)
  return questions.value
    .filter((q) => idSet.has(q.id))
    .map((q) => ({
      id: q.id,
      stem: truncate(stripMarkdown(q.stem), 80),
      answerKey: q.answerKey,
      selectedKey: history.value.find((h) => h.questionId === q.id)?.selectedKey || '',
    }))
})
// 根据进入刷题页的 query 算出入口签名，唯一标识"刷的是哪一批题"。
// 直接刷新（URL 不带 resume=1）时用它匹配存盘会话，避免被初始状态覆盖。
function computeEntryKey(): string {
  const q = route.query
  const parts = [
    (q.category as string) || activeCategory.value,
    (q.mode as string) || 'sequential',
    (q.group as string) || '',
    (q.groups as string) || '',
    (q.tag as string) || '',
    (q.ids as string) || '',
    q.shuffle === '1' ? '1' : '',
  ]
  return parts.join('|')
}

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
    entryKey: computeEntryKey(),
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

// 把 query 解析成 { mode, pool, display, shuffle }，避免在 onMounted 里反复覆盖 mode.value
function resolveMode(all: Question[]): {
  poolMode: QuizMode
  displayMode: string
  pool: Question[]
  shuffle: boolean
} {
  const tag = route.query.tag as string | undefined
  const groupFilter = route.query.group as string | undefined
  const groupsParam = route.query.groups as string | undefined
  const idsParam = route.query.ids as string | undefined
  const modeParam = route.query.mode as string | undefined
  const shuffle = route.query.shuffle === '1'

  if (tag) {
    return {
      poolMode: 'tag',
      displayMode: `tag: ${tag}`,
      pool: filterVisibleQuestions(getQuestionsByTag(tag, activeCategory.value), isUnlocked.value),
      shuffle: false,
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

  const isFilteredMode = poolMode === 'untouched' || poolMode === 'wrong'
  const suffix = shuffle && isFilteredMode ? ' · 随机' : ''
  const actionLabel = isFilteredMode ? (poolMode === 'untouched' ? '未做' : '错题') : poolMode

  let displayMode: string
  if (groupsParam) {
    displayMode = `套题 · ${actionLabel}${suffix}`
  } else if (groupFilter) {
    const groupTitle = all.find((q) => q.groupId === groupFilter)?.groupTitle || groupFilter
    displayMode = `${groupTitle} · ${actionLabel}${suffix}`
  } else {
    displayMode = `${actionLabel}${suffix}`
  }

  return { poolMode, displayMode, pool, shuffle }
}

onMounted(async () => {
  try {
    await loadActiveCategory()
    const queryCat = route.query.category as Category | undefined
    if (queryCat && queryCat !== activeCategory.value) {
      await setActiveCategory(queryCat)
    }
    const cat = activeCategory.value
    // 表站未解锁时剔除里站题（requireUnlock subBank 的 groupOrder）。里站入口设了 subBank 后 isUnlocked 必为 true，no-op。
    const all = filterVisibleQuestions(await loadQuestionBank(cat), isUnlocked.value)

    // preload bookmark status so the watch on currentQuestion doesn't hit IndexedDB
    const allStats = await db.questionStats.toArray()
    bookmarkCache.value = new Set(allStats.filter((s) => s.isBookmarked).map((s) => s.questionId))

    // 恢复条件：从首页"继续上次"进来（resume=1），或直接刷新页面且存盘会话属于当前入口。
    // fresh=1 表示用户从首页/错题本/搜索主动点入口要开新一轮，此时即使签名相同也不恢复（开新轮）。
    // 后者（刷新自动恢复）避免了刷新后用初始状态（1/N）覆盖掉真实进度。
    const saved = await loadActiveSession()
    const explicitResume = route.query.resume === '1'
    const wantsFresh = route.query.fresh === '1'
    const sameEntry = !wantsFresh && saved?.entryKey != null && saved.entryKey === computeEntryKey()
    if ((explicitResume || sameEntry) && isSessionInProgress(saved)) {
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
      window.addEventListener('keydown', onKeydown)
      window.addEventListener('beforeunload', onBeforeUnload)
      return
    }

    // 主动开新一轮：把 fresh 标记从 URL 抹掉，这样之后刷新（F5）能匹配 entryKey 自动恢复进度。
    if (wantsFresh) {
      const { fresh: _fresh, ...rest } = route.query
      router.replace({ path: route.path, query: rest })
    }

    const { poolMode, displayMode, pool, shuffle } = resolveMode(all)
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
    } else if ((poolMode === 'untouched' || poolMode === 'wrong') && shuffle) {
      finalPool = shuffleArray(pool)
    }
    questions.value = finalPool

    sessionId.value = generateSessionId()
    startTime.value = Date.now()
    startedAt.value = new Date().toISOString()
    await saveActiveSession(snapshot(false))
    startTimer()

    window.addEventListener('keydown', onKeydown)
    window.addEventListener('beforeunload', onBeforeUnload)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '加载题库失败，请返回首页重试'
  }
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

function jumpTo(i: number) {
  if (i === currentIndex.value || i < 0 || i >= questions.value.length) return
  saveCurrentDraft()
  // Pre-render markdown before changing index so the new card's
  // synchronous marked.parse() doesn't block the transition frames.
  const target = questions.value[i]
  if (target) {
    renderMarkdown(target.stem)
  }
  slideDirection.value = i > currentIndex.value ? 'slide-left' : 'slide-right'
  currentIndex.value = i
  const h = history.value[i]
  submitted.value = false
  selectedKey.value = h ? h.selectedKey : (drafts.value.get(i) ?? '')
  startTime.value = Date.now()
  requestAnimationFrame(() => {
    saveActiveSession(snapshot(false))
  })
}

function handleNext() {
  if (currentIndex.value >= questions.value.length - 1) {
    finished.value = true
    stopTimer()
    clearActiveSession()
    return
  }
  slideDirection.value = 'slide-left'
  jumpTo(currentIndex.value + 1)
}

function handlePrev() {
  if (currentIndex.value <= 0) return
  slideDirection.value = 'slide-right'
  jumpTo(currentIndex.value - 1)
}

function handleSwipePrev() {
  if (currentIndex.value <= 0) return
  handlePrev()
}

function handleSwipeNext() {
  if (currentIndex.value >= questions.value.length - 1) return
  handleNext()
}

async function handleBookmark() {
  const q = currentQuestion.value
  if (!q) return
  const next = !bookmarked.value
  bookmarked.value = next
  if (next) {
    bookmarkCache.value.add(q.id)
  } else {
    bookmarkCache.value.delete(q.id)
  }
  const stat = await db.questionStats.get(q.id)
  if (stat) {
    await db.questionStats.update(q.id, { isBookmarked: next })
  } else {
    await db.questionStats.put(createDefaultStats(q.id, { isBookmarked: next }))
  }
}

watch(currentQuestion, (q) => {
  if (!q) {
    bookmarked.value = false
    return
  }
  bookmarked.value = bookmarkCache.value.has(q.id)
})

function onKeydown(e: KeyboardEvent) {
  if (finished.value) return
  if (!submitted.value) {
    const k = e.key.toUpperCase()
    if (['A', 'B', 'C', 'D', 'E'].includes(k)) {
      if (currentQuestion.value?.multiAnswer) {
        selectedKey.value = toggleMultiSelect(selectedKey.value, k)
      } else {
        handleSelect(k)
      }
    } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
      const keyIndex = Number(e.key) - 1
      const key = ['A', 'B', 'C', 'D', 'E'][keyIndex]
      if (currentQuestion.value?.multiAnswer) {
        selectedKey.value = toggleMultiSelect(selectedKey.value, key)
      } else {
        handleSelect(key)
      }
    }
    if (e.key === 'Enter' && selectedKey.value) handleSubmit()
  } else {
    if (e.key === 'Enter' || e.key === 'n' || e.key === 'N') handleNext()
    if ((e.key === 'P' || e.key === 'p') && currentIndex.value > 0) handlePrev()
  }
  // 书签快捷键（任何时候可用）
  if (e.key === 'b' || e.key === 'B') {
    e.preventDefault()
    handleBookmark()
  }
}

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
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

// 答题离开确认：防止意外关闭/刷新
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (finished.value || questions.value.length === 0) return
  e.preventDefault()
  return (e.returnValue = '')
}

// 路由离开确认：自定义弹窗
onBeforeRouteLeave((_to, _from, next) => {
  if (finished.value || questions.value.length === 0) {
    next()
    return
  }
  showLeaveConfirm.value = true
  pendingNavigation = () => next()
})

function confirmLeave() {
  showLeaveConfirm.value = false
  if (pendingNavigation) {
    pendingNavigation()
    pendingNavigation = null
  }
}

function cancelLeave() {
  showLeaveConfirm.value = false
  pendingNavigation = null
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
        <span>A/B/C/D 选择 · Enter 提交/下一题 · N 下一题 · P 上一题 · B 书签</span>
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

      <!-- 错题回顾 -->
      <div v-if="wrongQuestions.length > 0" class="wrong-review">
        <h3>错题回顾</h3>
        <div class="wrong-list">
          <div v-for="wq in wrongQuestions" :key="wq.id" class="wrong-item">
            <span class="wrong-id">{{ wq.id }}</span>
            <span class="wrong-stem">{{ wq.stem }}</span>
            <span class="wrong-keys">
              <span class="wk-selected">{{ wq.selectedKey }}</span>
              <span class="wk-arrow">→</span>
              <span class="wk-correct">{{ wq.answerKey }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="loadError" class="quiz-error">
      <div class="error-box">
        <h2>加载失败</h2>
        <p>{{ loadError }}</p>
        <button class="btn btn-accent" @click="router.push('/home')">返回首页</button>
      </div>
    </div>

    <div v-else class="empty"><PageSkeleton type="detail" /></div>

    <!-- 离开确认弹窗 -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showLeaveConfirm" class="modal-overlay" @click.self="cancelLeave">
          <div class="modal-box">
            <h3>确认离开？</h3>
            <p>答题进度已自动保存，但本轮答题数据可能不完整。</p>
            <div class="modal-actions">
              <button class="btn btn-outline" @click="cancelLeave">继续答题</button>
              <button class="btn btn-accent" @click="confirmLeave">确认离开</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
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

/* Slide transition — out-in mode with fast leave + smooth enter.
   The leave is a barely-perceptible flicker (opacity only, no translate
   jank). The enter slides in from the side. Cache warming in jumpTo()
   ensures the new card's markdown is pre-parsed so mount is instant. */
.slide-left-enter-active,
.slide-right-enter-active {
  transition:
    transform 0.22s var(--ease-brush),
    opacity 0.18s var(--ease-brush);
}
.slide-left-leave-active,
.slide-right-leave-active {
  transition: opacity 0.08s var(--ease-ink);
}

/* Enter: slide in from the side */
.slide-left-enter-from {
  transform: translateX(28px);
  opacity: 0;
}
.slide-right-enter-from {
  transform: translateX(-28px);
  opacity: 0;
}

/* Leave: quick cross-fade, no translate (avoids the "freeze mid-slide" issue) */
.slide-left-leave-to,
.slide-right-leave-to {
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
  .slide-right-enter-from {
    transform: none;
  }
}
.timer {
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

/* .btn / .btn-accent / .btn-outline 样式已由全局 style.css 提供 */

.finish-page {
  text-align: center;
  padding: 80px 20px;
}
.finish-page h2 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 24px;
  animation: fade-down 0.45s var(--ease-page) both;
  animation-delay: 0.05s;
}
.finish-stat {
  margin-bottom: 16px;
  animation: fade-up 0.5s var(--ease-brush) both;
  animation-delay: 0.15s;
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
  animation: fade-up 0.5s var(--ease-brush) both;
  animation-delay: 0.22s;
}
.finish-details p {
  margin: 4px 0;
}
.finish-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
  animation: fade-up 0.5s var(--ease-brush) both;
  animation-delay: 0.29s;
}

/* 错题回顾 */
.wrong-review {
  margin-top: 48px;
  text-align: left;
  animation: fade-up 0.5s var(--ease-brush) both;
  animation-delay: 0.35s;
}
.wrong-review h3 {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  letter-spacing: 1px;
}
.wrong-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
}
.wrong-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  font-size: 13px;
}
.wrong-id {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent);
  font-weight: 600;
  flex-shrink: 0;
  min-width: 80px;
}
.wrong-stem {
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wrong-keys {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 12px;
}
.wk-selected {
  color: #c0392b;
  font-weight: 600;
}
.wk-arrow {
  color: var(--text-muted);
}
.wk-correct {
  color: #27ae60;
  font-weight: 600;
}

.empty {
  text-align: center;
  padding: 80px 20px;
  color: var(--text-muted);
}

/* 错误状态 */
.quiz-error {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
}
.quiz-error .error-box {
  text-align: center;
  padding: 48px 32px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  max-width: 400px;
}
.quiz-error .error-box h2 {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 12px;
}
.quiz-error .error-box p {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 24px;
  line-height: 1.6;
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

/* 离开确认弹窗 — Teleport 到 body，需用 :global() */
:global(.modal-overlay) {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
:global(.modal-box) {
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 28px 32px;
  max-width: 400px;
  width: 100%;
}
:global(.modal-box h3) {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 12px;
}
:global(.modal-box p) {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 24px;
  line-height: 1.6;
}
:global(.modal-actions) {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
:global(.modal-fade-enter-active) {
  transition: opacity 0.2s var(--ease-ink);
}
:global(.modal-fade-leave-active) {
  transition: opacity 0.15s var(--ease-ink);
}
:global(.modal-fade-enter-from),
:global(.modal-fade-leave-to) {
  opacity: 0;
}
</style>
