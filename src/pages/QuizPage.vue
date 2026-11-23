<script setup lang="ts">
import { SELF_CORRECT, isSelfAssessmentVerdict } from '../utils/selfAssessment'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import {
  useRoute,
  useRouter,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  type RouteLocationRaw,
} from 'vue-router'
import {
  loadQuestionBank,
  shuffleArray,
  generateSessionId,
  isMultiAnswerCorrect,
  isFillAnswerCorrect,
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
  paperKeyFromEntryKey,
  type ActiveSession,
} from '../services/sessionResume'
import { loadActiveCategory, setActiveCategory } from '../services/categoryStore'
import { useHiddenSite } from '../composables/useHiddenSite'
import QuestionCard from '../components/quiz/QuestionCard.vue'
import QuestionNavigator from '../components/quiz/QuestionNavigator.vue'
import ProgressBar from '../components/ui/ProgressBar.vue'
import PageSkeleton from '../components/ui/PageSkeleton.vue'
import { stripMarkdown } from '../utils/renderMarkdown'
import { routeEntryKey } from '../utils/routeEntry'
import { optionSignature, mapAnswer } from '../services/sessionAnswers'
import { truncate } from '../utils/text'
import { useAI } from '../composables/useAI'
import { hasCompleteFillAnswer } from '../utils/multiAnswer'
import { CATEGORIES } from '../config/categories'
import type { Question, QuizMode, Category } from '../types/question'

const route = useRoute()
const router = useRouter()
const activeCategory = ref<Category>('japanese2')
const { isUnlocked } = useHiddenSite()
const { initAI } = useAI()

const questions = ref<Question[]>([])
const currentIndex = ref(0)
const selectedKey = ref('')
const submitted = ref(false)
const sessionId = ref('')
const correctCount = ref(0)
const wrongList = ref<string[]>([])
const mode = ref('')
const poolMode = ref<QuizMode>('sequential')
const startTime = ref(0)
const finished = ref(false)
const bookmarked = ref(false)
const bookmarkCache = ref<Set<string>>(new Set())
const startedAt = ref('')
const lastActivityAt = ref('')
let restoredEntry: string | undefined
const reselectIds = ref(new Set<string>())
const elapsedTime = ref(0)
const timerInterval = ref<ReturnType<typeof setInterval> | null>(null)
const isExamMode = ref(false)
const wrongRedo = ref(false)
const examTimeLimit = ref(60 * 60) // 默认 60 分钟（秒）
const examEndTime = ref(0) // 考试结束时的 Date.now() 目标值
const remainingTime = ref(0)
const examTimerInterval = ref<ReturnType<typeof setInterval> | null>(null)
const history = ref<Array<{ questionId: string; selectedKey: string; isCorrect: boolean }>>([])
const drafts = ref<Map<number, string>>(new Map())
const showLeaveConfirm = ref(false)
const showExplanation = ref(false)
const loadError = ref('')
const loading = ref(true)
let pendingNavigation: RouteLocationRaw | null = null
let skipLeaveGuard = false

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
  answered: history.value.length,
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
    q.questionType || '',
    q.source ||
      (q.redo === '1'
        ? 'wrong-redo'
        : q.ids && ['wrong', 'untouched'].includes(String(q.mode))
          ? q.mode
          : ''),
  ]
  return parts.join('|')
}

// 这次刷的是哪份试卷（学科 + 子题库/题单 + 标签），决定记录存到哪一条、和谁互不干扰。
function computePaperKey(): string {
  return (route.query.paper as string) || paperKeyFromEntryKey(computeEntryKey())
}

function snapshot(submittedNow: boolean): ActiveSession {
  saveCurrentDraft()
  const draftsById: Record<string, string> = {}
  const optionSignatures: Record<string, string> = {}
  for (const [i, q] of questions.value.entries()) {
    const draft = drafts.value.get(i)
    const signature = (draft || history.value[i]?.selectedKey) && optionSignature(q)
    if (signature) optionSignatures[q.id] = signature
    if (draft) draftsById[q.id] = mapAnswer(q, draft, 'original')
  }

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
    history: history.value
      .map((h, i) => {
        const q = questions.value[i]
        return { ...h, selectedKey: q ? mapAnswer(q, h.selectedKey, 'original') : '' }
      })
      .filter(Boolean),
    elapsedSeconds: elapsedTime.value,
    draftsById,
    optionSignatures,
    lastActivityAt: lastActivityAt.value || undefined,
    reselectIds: [...reselectIds.value],
    entryKey: restoredEntry || computeEntryKey(),
    paperKey: computePaperKey(),
    wrongRedo: wrongRedo.value,
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

function startExamTimer() {
  if (!isExamMode.value) return
  examEndTime.value = Date.now() + examTimeLimit.value * 1000
  const tick = () => {
    const diff = Math.max(0, Math.round((examEndTime.value - Date.now()) / 1000))
    remainingTime.value = diff
    if (diff <= 0) {
      stopExamTimer()
      handleExamTimeUp()
    }
  }
  tick()
  examTimerInterval.value = setInterval(tick, 1000)
}

function stopExamTimer() {
  if (examTimerInterval.value) {
    clearInterval(examTimerInterval.value)
    examTimerInterval.value = null
  }
}

async function handleExamTimeUp() {
  // 时间到，自动完成考试
  finished.value = true
  stopTimer()
  stopExamTimer()
  // 持久化 session 数据到数据库
  await db.sessions.put(
    createSession({
      mode: mode.value,
      totalQuestions: questions.value.length,
      correctCount: correctCount.value,
      wrongCount: wrongList.value.length,
      startedAt: startedAt.value,
    }),
  )
  // 只清掉这份试卷的记录，别的试卷的进度保留
  await clearActiveSession(computePaperKey())
}

const formattedRemainingTime = computed(() => {
  const mins = Math.floor(remainingTime.value / 60)
  const secs = remainingTime.value % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
})

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
  const questionTypeFilter = route.query.questionType as string | undefined

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
  if (questionTypeFilter) {
    pool = pool.filter((q) => q.questionType === questionTypeFilter)
  }

  if (tag) {
    return {
      poolMode: 'tag',
      displayMode: `tag: ${tag}`,
      pool: pool.filter((q) => q.tags.includes(tag) || q.grammarPoints.includes(tag)),
      shuffle: false,
    }
  }

  if (idsParam && !computePaperKey()) {
    return { poolMode: 'sequential', displayMode: '单题练习', pool, shuffle: false }
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

  const questionTypeLabel =
    questionTypeFilter === 'judgement'
      ? '判断题'
      : questionTypeFilter === 'multi'
        ? '多选题'
        : questionTypeFilter === 'single'
          ? '单选题'
          : questionTypeFilter === 'fill'
            ? '填空题'
            : ''
  const typeSuffix = questionTypeLabel ? ` · ${questionTypeLabel}` : ''

  let displayMode: string
  if (groupsParam) {
    displayMode = `套题 · ${actionLabel}${suffix}${typeSuffix}`
  } else if (groupFilter) {
    const groupTitle = all.find((q) => q.groupId === groupFilter)?.groupTitle || groupFilter
    displayMode = `${groupTitle} · ${actionLabel}${suffix}${typeSuffix}`
  } else {
    displayMode = `${actionLabel}${suffix}${typeSuffix}`
  }

  return { poolMode, displayMode, pool, shuffle }
}

/**
 * 尝试恢复已中断的答题会话（返回 true 表示已恢复，无需新建）
 */
async function tryRestoreSession(all: Question[]): Promise<boolean> {
  // preload bookmark status so the watch on currentQuestion doesn't hit IndexedDB
  const allStats = await db.questionStats.toArray()
  bookmarkCache.value = new Set(allStats.filter((s) => s.isBookmarked).map((s) => s.questionId))

  const saved = await loadActiveSession(computePaperKey())
  const wantsFresh = route.query.fresh === '1'
  wrongRedo.value = route.query.redo === '1'
  if ((!wantsFresh || route.query.resume === '1') && isSessionInProgress(saved)) {
    const map = new Map(all.map((q) => [q.id, q] as const))
    const restored = saved.questionIds.map((id) => map.get(id)).filter((q): q is Question => !!q)
    const nextIds = new Set(saved.questionIds.slice(saved.currentIndex + Number(saved.submitted)))
    const nextIndex = restored.findIndex((q) => nextIds.has(q.id))
    if (nextIndex < 0) return false
    questions.value = restored
    currentIndex.value = nextIndex
    reselectIds.value = new Set(saved.reselectIds)
    sessionId.value = saved.sessionId
    mode.value = saved.mode
    correctCount.value = saved.correctCount
    wrongList.value = [...saved.wrongList]
    startedAt.value = saved.startedAt
    submitted.value = false
    startTime.value = Date.now()
    elapsedTime.value = saved.elapsedSeconds || 0
    wrongRedo.value = saved.wrongRedo || false
    lastActivityAt.value = saved.lastActivityAt || ''
    restoredEntry = saved.entryKey
    const positions = new Map(saved.questionIds.map((id, i) => [id, i]))
    const historyById = new Map((saved.history || []).filter(Boolean).map((h) => [h.questionId, h]))
    function restore(q: Question, value: string) {
      if (!value) return ''
      const signature = optionSignature(q)
      if (!signature) return value
      const valid = saved!.optionSignatures
        ? saved!.optionSignatures[q.id] === signature
        : !q.options.some((option) => option.originalKey)
      const answer = valid ? mapAnswer(q, value, 'display') : ''
      if (!answer) reselectIds.value.add(q.id)
      return answer
    }
    history.value = []
    drafts.value.clear()
    questions.value.forEach((q, i) => {
      const previous = historyById.get(q.id)
      if (previous)
        history.value[i] = { ...previous, selectedKey: restore(q, previous.selectedKey) }
      const draft = saved.draftsById?.[q.id] ?? saved.drafts?.[positions.get(q.id) ?? -1]
      const answer = restore(q, draft || '')
      if (answer) drafts.value.set(i, answer)
    })
    selectedKey.value =
      drafts.value.get(currentIndex.value) ?? history.value[currentIndex.value]?.selectedKey ?? ''
    return true
  }

  // 用完一次性标记后，刷新页面时按当前练习范围自动恢复。
  if (wantsFresh) {
    const { fresh: _fresh, ...rest } = route.query
    router.replace({ path: route.path, query: rest })
  }

  return false
}

/**
 * 根据 URL 参数解析模式并启动新会话
 */
async function startNewSession(all: Question[]) {
  const resolved = resolveMode(all)
  poolMode.value = resolved.poolMode
  mode.value = resolved.displayMode

  let finalPool = resolved.pool
  if (resolved.poolMode === 'random') {
    finalPool = shuffleArray(resolved.pool)
  } else if (resolved.poolMode === 'weakness') {
    const stats = await db.questionStats.toArray()
    const validIds = new Set(all.map((q) => q.id))
    const weakIds = stats
      .filter((s) => validIds.has(s.questionId) && s.masteryLevel <= 2)
      .map((s) => s.questionId)
    const weakSet = new Set(weakIds)
    const priorityQuestions = weakIds
      .map((id) => all.find((q) => q.id === id))
      .filter((q): q is Question => !!q)
    const remaining = shuffleArray(all.filter((q) => !weakSet.has(q.id)))
    finalPool = [...priorityQuestions, ...remaining]
  } else if (resolved.poolMode === 'exam') {
    finalPool = shuffleArray([...all])
    isExamMode.value = true
  } else if (
    (resolved.poolMode === 'untouched' || resolved.poolMode === 'wrong') &&
    resolved.shuffle
  ) {
    finalPool = shuffleArray(resolved.pool)
  }
  questions.value = finalPool
  if (finalPool.length === 0) return

  sessionId.value = generateSessionId()
  startTime.value = Date.now()
  startedAt.value = new Date().toISOString()
  await saveActiveSession(snapshot(false))
}

onMounted(async () => {
  try {
    const storedCategory = await loadActiveCategory()
    await initAI()
    const paperCategory = String(route.query.paper || '').split('|')[0]
    const requested = paperCategory || route.query.category
    const cat = CATEGORIES.find((item) => item.key === requested)?.key || storedCategory
    activeCategory.value = cat
    if (cat !== storedCategory && computePaperKey()) await setActiveCategory(cat)
    // 表站未解锁时剔除里站题（requireUnlock subBank 的 groupOrder）。里站入口设了 subBank 后 isUnlocked 必为 true，no-op。
    const all = filterVisibleQuestions(await loadQuestionBank(cat), isUnlocked.value)

    // 尝试恢复会话，若已恢复则无需新建
    const resumed = await tryRestoreSession(all)
    if (!resumed) {
      await startNewSession(all)
    }

    if (questions.value.length === 0) return

    window.addEventListener('keydown', onKeydown)
    window.addEventListener('beforeunload', onBeforeUnload)
    startTimer()
    if (isExamMode.value) {
      startExamTimer()
    }
  } catch (e) {
    // 确保在错误路径上移除可能已添加的事件监听器
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('beforeunload', onBeforeUnload)
    loadError.value = e instanceof Error ? e.message : '加载题库失败，请返回首页重试'
  } finally {
    loading.value = false
  }
})

function handleSelect(key: string) {
  if (submitted.value) return
  if (currentQuestion.value?.selfAssessment && !isSelfAssessmentVerdict(key)) return
  // QuestionCard already computed the correct toggled/new value
  selectedKey.value = key
  if (currentQuestion.value) reselectIds.value.delete(currentQuestion.value.id)
  lastActivityAt.value = new Date().toISOString()
  const state = snapshot(false)
  void saveActiveSession(state).catch(console.error)
}

async function handleSubmit() {
  if (!selectedKey.value || !currentQuestion.value) return
  if (submitted.value) return
  if (currentQuestion.value.selfAssessment && !isSelfAssessmentVerdict(selectedKey.value)) return
  const q = currentQuestion.value
  if (q.fillSlots && !hasCompleteFillAnswer(selectedKey.value, q.fillSlots.length)) return
  submitted.value = true

  let isCorrect: boolean
  if (q.selfAssessment) {
    isCorrect = selectedKey.value === SELF_CORRECT
  } else if (q.questionType === 'fill') {
    isCorrect = isFillAnswerCorrect(selectedKey.value, q.answerText, q.fillSlots)
  } else if (q.multiAnswer) {
    isCorrect = isMultiAnswerCorrect(selectedKey.value, q.answerKey)
  } else {
    isCorrect = selectedKey.value === q.answerKey
  }

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
  lastActivityAt.value = new Date().toISOString()
  const saving = saveActiveSession(snapshot(true)).catch(console.error)

  const elapsedMs = Date.now() - startTime.value
  startTime.value = Date.now()

  try {
    await recordAttempt(
      {
        questionId: q.id,
        category: q.category,
        sessionId: sessionId.value,
        selectedKey: selectedKey.value,
        correctKey: q.answerKey,
        isCorrect,
        elapsedMs,
        mode: mode.value,
        createdAt: new Date().toISOString(),
      },
      { wrongRedo: wrongRedo.value },
    )

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

    await saving
  } catch (e) {
    console.error('保存答题记录失败:', e)
    // 不影响用户继续答题，只记录错误
  }
}

function saveCurrentDraft() {
  if (!submitted.value && selectedKey.value) {
    drafts.value.set(currentIndex.value, selectedKey.value)
  } else {
    drafts.value.delete(currentIndex.value)
  }
}

function jumpTo(i: number) {
  if (i === currentIndex.value || i < 0 || i >= questions.value.length) return
  saveCurrentDraft()
  currentIndex.value = i
  const h = history.value[i]
  submitted.value = false
  selectedKey.value = drafts.value.get(i) ?? h?.selectedKey ?? ''
  startTime.value = Date.now()
  void saveActiveSession(snapshot(false)).catch(console.error)
}

function handleNext() {
  if (currentIndex.value >= questions.value.length - 1) {
    finished.value = true
    stopTimer()
    clearActiveSession(computePaperKey())
    return
  }
  jumpTo(currentIndex.value + 1)
}

function handlePrev() {
  if (currentIndex.value <= 0) return
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
  if (e.isComposing || (e.target instanceof HTMLElement && e.target.closest('input, select')))
    return
  if (!submitted.value && currentQuestion.value?.questionType === 'fill') {
    if (e.key === 'Enter' && selectedKey.value) handleSubmit()
  } else if (!submitted.value) {
    const k = e.key.toUpperCase()
    if (['A', 'B', 'C', 'D', 'E'].includes(k)) {
      handleSelect(k)
    } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
      const keyIndex = Number(e.key) - 1
      const key = ['A', 'B', 'C', 'D', 'E'][keyIndex]
      handleSelect(key)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const keys = currentQuestion.value?.options.map((o) => o.key) || []
      const idx = keys.indexOf(selectedKey.value)
      const next =
        e.key === 'ArrowDown'
          ? keys[Math.min(idx + 1, keys.length - 1)]
          : keys[Math.max(idx - 1, 0)]
      if (next) handleSelect(next)
    }
    if (e.key === 'Enter' && selectedKey.value) handleSubmit()
  } else {
    if (e.key === 'Enter' || e.key === 'n' || e.key === 'N') handleNext()
    if ((e.key === 'P' || e.key === 'p') && currentIndex.value > 0) handlePrev()
    if (e.key === 'e' || e.key === 'E') showExplanation.value = !showExplanation.value
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
  stopExamTimer()
})

async function restart() {
  stopTimer()
  stopExamTimer()
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
  // 重置考试模式状态
  if (isExamMode.value) {
    examEndTime.value = Date.now() + examTimeLimit.value * 1000
  }
  await saveActiveSession(snapshot(false))
  startTimer()
  if (isExamMode.value) {
    startExamTimer()
  }
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
// 注意：不能用 next() 异步回调模式，在 Vue Router 4 中异步调用 next() 不可靠。
// 改用 return false 取消导航 + 手动 router.push() 的模式。
const confirmNavigation: Parameters<typeof onBeforeRouteLeave>[0] = (to) => {
  if (skipLeaveGuard || finished.value || questions.value.length === 0) {
    return true
  }
  pendingNavigation = { path: to.path, query: to.query, hash: to.hash }
  showLeaveConfirm.value = true
  return false
}
onBeforeRouteLeave(confirmNavigation)
onBeforeRouteUpdate((to, from) => {
  if (routeEntryKey(to.query) !== routeEntryKey(from.query))
    return confirmNavigation(to, from, () => {})
})

async function confirmLeave() {
  showLeaveConfirm.value = false
  if (pendingNavigation) {
    const target = pendingNavigation
    pendingNavigation = null
    try {
      await saveActiveSession(snapshot(submitted.value))
    } catch (error) {
      console.error(error)
      showLeaveConfirm.value = true
      pendingNavigation = target
      return
    }
    skipLeaveGuard = true
    router.push(target)
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
        :answered="progress.answered"
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
        <span v-if="isExamMode" class="exam-timer" :class="{ 'time-warning': remainingTime < 300 }">
          剩余时间: {{ formattedRemainingTime }}
        </span>
        <span>A/B/C/D 选择 · Enter 提交/下一题 · N 下一题 · P 上一题 · B 书签 · E 解析</span>
      </div>
      <!-- Sticky exam timer for long questions -->
      <div
        v-if="isExamMode"
        class="sticky-exam-timer"
        :class="{ 'time-warning': remainingTime < 300 }"
      >
        剩余时间: {{ formattedRemainingTime }}
      </div>
      <p v-if="reselectIds.has(currentQuestion.id)" role="status">原选项无法恢复，请重新选择。</p>
      <QuestionCard
        :key="currentQuestion.id"
        :question="currentQuestion"
        :selected-key="selectedKey"
        :submitted="submitted"
        :mode="mode"
        :question-index="currentIndex"
        :total-questions="questions.length"
        :bookmarked="bookmarked"
        :show-explanation="showExplanation"
        :category="activeCategory"
        @select="handleSelect"
        @submit="handleSubmit"
        @next="handleNext"
        @prev="handlePrev"
        @bookmark="handleBookmark"
        @swipe-prev="handleSwipePrev"
        @swipe-next="handleSwipeNext"
        @update:show-explanation="showExplanation = $event"
      />
    </template>

    <div v-else-if="finished" class="finish-page" aria-live="polite">
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
          @click="
            router.push({
              path: '/quiz',
              query: { category: activeCategory, source: 'wrong', ids: wrongList.join(',') },
            })
          "
        >
          只刷错题
        </button>
        <button
          class="btn btn-outline"
          v-if="wrongList.length > 0"
          @click="
            router.push({
              path: '/quiz',
              query: {
                category: activeCategory,
                source: 'wrong-redo',
                ids: wrongList.join(','),
                redo: '1',
                fresh: '1',
              },
            })
          "
        >
          重做错题
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
        <RouterLink class="btn btn-accent" to="/">返回课程列表</RouterLink>
      </div>
    </div>

    <div v-else-if="loading" class="empty"><PageSkeleton type="detail" /></div>
    <div v-else class="empty" role="status">
      <h2>暂无符合条件的题目</h2>
      <p>请返回题库，选择其他题组或练习方式。</p>
      <button class="btn btn-accent" @click="router.push('/home')">返回题库</button>
    </div>

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

.exam-timer {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--accent);
  padding: 2px 8px;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.exam-timer.time-warning {
  color: var(--wrong);
  border-color: var(--wrong);
  background: color-mix(in srgb, var(--wrong) 10%, transparent);
  animation: pulse 1s ease-in-out infinite;
}

.sticky-exam-timer {
  position: fixed;
  top: 50px;
  right: 20px;
  z-index: 50;
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 14px;
  color: var(--accent);
  padding: 6px 12px;
  border: 1px solid var(--accent);
  background: var(--bg-card);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  display: none;
}

.sticky-exam-timer.time-warning {
  color: var(--wrong);
  border-color: var(--wrong);
  animation: pulse 1s ease-in-out infinite;
}

@media (max-width: 768px) {
  .sticky-exam-timer {
    display: block;
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
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
