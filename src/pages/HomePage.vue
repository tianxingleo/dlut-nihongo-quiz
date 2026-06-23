<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useHiddenSite } from '../composables/useHiddenSite'
import {
  loadQuestionBank,
  getAllGroups,
  getCategoryMeta,
  filterVisibleQuestions,
} from '../services/quizEngine'
import {
  getWeakTags,
  getMasterySummary,
  getWrongQuestionIds,
  getUntouchedQuestionIds,
  getReviewQueue,
} from '../services/reviewScheduler'
import { db } from '../db/database'
import {
  loadActiveSession,
  clearActiveSession,
  isSessionInProgress,
  type ActiveSession,
} from '../services/sessionResume'
import { getDailyAttemptCount, getSetting } from '../db/database'
import {
  useActiveCategory,
  loadActiveCategory,
  setActiveSubBankKey,
  useActiveSubBankKey,
} from '../services/categoryStore'
import { GROUPED_CATEGORIES } from '../config/categories'
import { STORAGE_KEYS } from '../constants'
import { computeStreak } from '../utils/streak'
import StatCard from '../components/ui/StatCard.vue'
import TagBadge from '../components/ui/TagBadge.vue'
import PageSkeleton from '../components/ui/PageSkeleton.vue'
import ActionMenuButton from '../components/ui/ActionMenuButton.vue'
import type { Recommendation } from '../services/reviewScheduler'
import type { Question, QuestionStats, QuizMode } from '../types/question'

// 「未做」「错题」按钮共用：点击后弹出顺序/随机选项
const ORDER_ITEMS = [
  { key: 'seq', label: '顺序', value: false },
  { key: 'rnd', label: '随机', value: true },
]

const router = useRouter()
const activeCategory = useActiveCategory()
const { isUnlocked } = useHiddenSite()
const loading = ref(true)
const error = ref('')
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
const reviewDueIds = ref<string[]>([])
const activeSession = ref<ActiveSession | null>(null)
const streak = ref(0)
const dailyGoal = ref(30)
const dailyDone = ref(0)
const groupStats = ref<
  Record<
    string,
    {
      total: number
      done: number
      attempts: number
      correct: number
      wrong: number
      wrongIds: string[]
      untouchedIds: string[]
    }
  >
>({})

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const cat = activeCategory.value
    const unlocked = isUnlocked.value
    // 一次拿到题库 + 全表 stats，所有下游函数共享同一份数据，避免重复扫描
    const [rawAll, allStatsArr] = await Promise.all([
      loadQuestionBank(cat),
      db.questionStats.toArray(),
    ])
    // 表站未解锁时，剔除里站专属 groupId（requireUnlock subBank），避免 tag、薄弱、掌握度被污染。
    const all = filterVisibleQuestions(rawAll, unlocked)
    questions.value = all
    totalQuestions.value = all.length

    const validIds = new Set(all.map((q) => q.id))
    const statsMap = new Map<string, QuestionStats>()
    const relevantStats: QuestionStats[] = []
    for (const s of allStatsArr) {
      if (!validIds.has(s.questionId)) continue
      statsMap.set(s.questionId, s)
      relevantStats.push(s)
    }

    doneCount.value = 0
    totalAttempts.value = 0
    totalCorrect.value = 0
    wrongCount.value = 0
    for (const s of relevantStats) {
      if (s.attemptCount > 0) doneCount.value++
      totalAttempts.value += s.attemptCount
      totalCorrect.value += s.correctCount
      if (s.wrongCount > 0) wrongCount.value++
    }

    // streak 用所有学科的 stats（跨学科仍保持连续），grace period 见 utils/streak.ts
    streak.value = computeStreak(allStatsArr.map((s) => s.lastAttemptAt))

    // recent 正确率：取 attempts 反向，按当前 category 过滤后再切片，
    // 避免 limit(100) 拿到的全是其他 category 导致"近期正确率"失真
    const recentAll = await db.attempts.orderBy('id').reverse().limit(500).toArray()
    const recent = recentAll.filter((a) => validIds.has(a.questionId)).slice(0, 30)
    recentCorrectRate.value =
      recent.length > 0
        ? Math.round((recent.filter((a) => a.isCorrect).length / recent.length) * 100)
        : 0

    // 5 个 reviewScheduler 函数共用一份 stats，避免再扫 5 次
    const [weak, mast, wrong, untouched, reviewQueue] = await Promise.all([
      getWeakTags(cat, { isUnlocked: unlocked }),
      getMasterySummary(cat, allStatsArr, { isUnlocked: unlocked }),
      getWrongQuestionIds(cat, allStatsArr, { isUnlocked: unlocked }),
      getUntouchedQuestionIds(cat, allStatsArr, { isUnlocked: unlocked }),
      getReviewQueue(cat, allStatsArr, { isUnlocked: unlocked }),
    ])
    weakTags.value = weak
    mastery.value = mast
    wrongIds.value = wrong
    untouchedIds.value = untouched
    reviewDueIds.value = reviewQueue

    const groups = getAllGroups(cat)
    const next: typeof groupStats.value = {}
    for (const g of groups) {
      const groupQs = all.filter((q) => q.groupId === g.groupId)
      const groupIds = new Set(groupQs.map((q) => q.id))
      let gDone = 0,
        gAttempts = 0,
        gCorrect = 0,
        gWrong = 0
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
        wrongIds: wrong.filter((id) => groupIds.has(id)),
        untouchedIds: groupQs
          .filter((q) => !statsMap.get(q.id) || statsMap.get(q.id)!.attemptCount === 0)
          .map((q) => q.id),
      }
    }
    groupStats.value = next

    const saved = await loadActiveSession()
    activeSession.value = isSessionInProgress(saved) ? saved : null
    if (saved && !isSessionInProgress(saved)) await clearActiveSession()

    // 每日目标
    dailyGoal.value = await getSetting(STORAGE_KEYS.DAILY_GOAL, 30)
    dailyDone.value = await getDailyAttemptCount()

    loading.value = false
  } catch (e) {
    loading.value = false
    error.value = e instanceof Error ? e.message : '加载题库失败，请刷新页面重试'
  }
}

onMounted(async () => {
  await loadActiveCategory()
  await refresh()
})

watch(activeCategory, () => {
  refresh()
})

// 里站解锁/锁定切换时，可见题集改变，需要重算 tag、薄弱、掌握度等。
watch(isUnlocked, () => {
  refresh()
})

function startQuiz(mode: QuizMode | 'weakness' | 'review', options?: { shuffle?: boolean }) {
  const params: Record<string, string> = { mode: mode === 'review' ? 'wrong' : mode, fresh: '1' }
  if (options?.shuffle) params.shuffle = '1'
  if (mode === 'review' && reviewDueIds.value.length > 0) {
    params.ids = reviewDueIds.value.join(',')
  } else if (mode === 'wrong' && wrongIds.value.length > 0) {
    params.ids = wrongIds.value.join(',')
  } else if (mode === 'untouched' && untouchedIds.value.length > 0) {
    params.ids = untouchedIds.value.join(',')
  }
  router.push({ path: '/quiz', query: params })
}

function startTagQuiz(tag: string) {
  router.push({ path: '/quiz', query: { tag, fresh: '1' } })
}

function startHistoryGroup(
  groupId: string,
  mode: 'sequential' | 'random' | 'wrong' | 'untouched',
  options?: { shuffle?: boolean },
) {
  const s = groupStats.value[groupId]
  if (!s) return
  const params: Record<string, string> = { group: groupId, mode, fresh: '1' }
  if (options?.shuffle) params.shuffle = '1'
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

const meta = computed(() => getCategoryMeta(activeCategory.value))

// 每日目标进度
const dailyProgress = computed(() => {
  const pct =
    dailyGoal.value > 0 ? Math.min(100, Math.round((dailyDone.value / dailyGoal.value) * 100)) : 0
  const color = pct >= 100 ? 'var(--correct)' : pct >= 60 ? 'var(--warning)' : 'var(--wrong)'
  return { pct, color, done: dailyDone.value, goal: dailyGoal.value }
})
const activeSubBankKey = useActiveSubBankKey()
const hasSubBanks = computed(() => {
  const sb = meta.value.subBanks
  return Boolean(sb && sb.length > 0)
})
const currentSubBank = computed(() => {
  if (!hasSubBanks.value || !activeSubBankKey.value) return null
  return meta.value.subBanks!.find((s) => s.key === activeSubBankKey.value) || null
})
const visibleSubBanks = computed(() => {
  const sb = meta.value.subBanks
  if (!sb) return []
  if (isUnlocked.value) return sb
  return sb.filter((s) => !s.requireUnlock)
})
const isGroupView = computed(
  () =>
    GROUPED_CATEGORIES.has(activeCategory.value) ||
    (hasSubBanks.value && Boolean(activeSubBankKey.value)),
)
const isWordSubBank = computed(() => activeSubBankKey.value === 'word')
const titleText = computed(() => {
  if (meta.value.long === '综合日语2' && currentSubBank.value) return currentSubBank.value.name
  return meta.value.long === '综合日语2' ? '综合日语2' : meta.value.long
})
const subtitleText = computed(() => {
  const n = totalQuestions.value
  const k = activeCategory.value
  if (k === 'japanese2') {
    if (currentSubBank.value) {
      const gCount = currentSubBank.value.groupOrder.length
      const qCount = questions.value.filter((q) =>
        currentSubBank.value!.groupOrder.includes(q.groupId),
      ).length
      if (isWordSubBank.value) return `${qCount} 题 · 第26-36课 · 汉字 / 假名`
      return `${qCount} 题 · ${gCount}大题组`
    }
    return `${n} 题 · 4个子题库 · 综合复习`
  }
  if (k === 'history') return `${n} 题 · 11个刷题单 · 单选/多选/判断`
  if (k === 'party') return `${n} 题 · 7个刷题单 · 单选/多选/判断`
  if (k === 'military') return `${n} 题 · 22个刷题单 · 单选/多选/判断`
  return `${n} 题`
})
const tagSectionTitle = computed(() => (isWordSubBank.value ? '按课/标签复习' : '按语法标签复习'))
// 标签云直接基于已过滤的 questions.value 计算，避开 getAllTags 的全量缓存，
// 保证表站看不到「2021真题」「阅读理解」等里站专属 tag。
const visibleTags = computed(() => {
  const map = new Map<string, number>()
  for (const q of questions.value) {
    for (const t of q.tags) map.set(t, (map.get(t) || 0) + 1)
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
})
const weakSectionTitle = computed(() => (isWordSubBank.value ? '薄弱课/标签' : '薄弱语法点'))

function selectSubBank(key: string) {
  setActiveSubBankKey(key)
  totalQuestions.value = questions.value.filter((q) => {
    const sb = meta.value.subBanks?.find((s) => s.key === key)
    return sb ? sb.groupOrder.includes(q.groupId) : true
  }).length
}

function clearSubBank() {
  setActiveSubBankKey(null)
}

function startSubBankFull(
  mode: 'sequential' | 'random' | 'wrong' | 'untouched',
  options?: { shuffle?: boolean },
) {
  const sb = currentSubBank.value
  if (!sb) return
  const params: Record<string, string> = { mode, groups: sb.groupOrder.join(','), fresh: '1' }
  if (options?.shuffle) params.shuffle = '1'
  if (mode === 'wrong') {
    const allWrong: string[] = []
    for (const gid of sb.groupOrder) {
      const s = groupStats.value[gid]
      if (s) allWrong.push(...s.wrongIds)
    }
    if (allWrong.length > 0) params.ids = allWrong.join(',')
  } else if (mode === 'untouched') {
    const allUntouched: string[] = []
    for (const gid of sb.groupOrder) {
      const s = groupStats.value[gid]
      if (s) allUntouched.push(...s.untouchedIds)
    }
    if (allUntouched.length > 0) params.ids = allUntouched.join(',')
  }
  router.push({ path: '/quiz', query: params })
}

const groupViewList = computed(() => {
  const cat = activeCategory.value
  // Sub-bank mode: show groups from the selected sub-bank
  if (hasSubBanks.value && currentSubBank.value) {
    const subOrder = currentSubBank.value.groupOrder
    const titles: Record<string, string> = {}
    for (const q of questions.value) titles[q.groupId] = q.groupTitle
    const groups = getAllGroups(cat).filter((g) => subOrder.includes(g.groupId))
    return subOrder
      .map((id) => {
        const g = groups.find((x) => x.groupId === id)
        if (!g) return null
        return { groupId: id, groupTitle: titles[id] || g.groupTitle, count: g.count }
      })
      .filter(Boolean) as { groupId: string; groupTitle: string; count: number }[]
  }
  // Normal grouped categories (history/party/military)
  if (!GROUPED_CATEGORIES.has(cat)) return []
  const order = meta.value.groupOrder || []
  const titles: Record<string, string> = {}
  for (const q of questions.value) titles[q.groupId] = q.groupTitle
  const groups = getAllGroups(cat)
  const seen = new Set<string>()
  const ordered = order
    .map((id) => {
      const g = groups.find((x) => x.groupId === id)
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
  if (currentSubBank.value) return currentSubBank.value.groupViewTitle || '题组'
  return meta.value.groupViewTitle || '刷题单'
})
const groupViewHint = computed(() => {
  if (currentSubBank.value) return currentSubBank.value.desc
  return meta.value.groupViewHint || ''
})
</script>
<template>
  <div v-if="loading" class="home"><PageSkeleton type="card" /></div>
  <div v-else-if="error" class="home-error">
    <div class="error-box">
      <h2>加载失败</h2>
      <p>{{ error }}</p>
      <button class="btn btn-accent" @click="refresh">重试</button>
    </div>
  </div>
  <div v-else class="home">
    <header class="home-header">
      <div class="title-row">
        <h1>{{ titleText }}</h1>
        <span v-if="streak > 0" class="streak-chip" :title="`最近 ${streak} 天连续答题`"
          >连续 {{ streak }} 天</span
        >
      </div>
      <p class="subtitle">{{ subtitleText }}</p>
    </header>

    <div v-if="activeSession" class="resume-banner">
      <div class="resume-info">
        <span class="resume-title">继续上次</span>
        <span class="resume-meta"
          >第
          {{
            (activeSession.submitted
              ? activeSession.currentIndex + 1
              : activeSession.currentIndex) + 1
          }}/{{ activeSession.totalQuestions }} 题 · {{ activeSession.mode }}</span
        >
      </div>
      <div class="resume-actions">
        <button class="btn btn-accent" @click="resumeSession">继续</button>
        <button class="btn btn-ghost" @click="discardSession">放弃</button>
      </div>
    </div>

    <!-- 每日目标进度 -->
    <div class="daily-goal-bar">
      <div class="dg-header">
        <span class="dg-label">今日目标 <span class="dg-hint">（跨学科合计）</span></span>
        <span class="dg-count">{{ dailyProgress.done }}/{{ dailyProgress.goal }} 题</span>
      </div>
      <div class="dg-track">
        <div
          class="dg-fill"
          :style="{ width: dailyProgress.pct + '%', background: dailyProgress.color }"
        />
      </div>
      <p v-if="dailyProgress.pct >= 100" class="dg-complete">🎉 今日目标已达成！</p>
    </div>

    <div class="stats-row">
      <StatCard label="待复习" :value="reviewDueIds.length" sub="间隔重复到期" />
      <StatCard label="错题数" :value="wrongIds.length" sub="错题重刷优先" />
      <StatCard label="总进度" :value="`${doneCount}/${totalQuestions}`" sub="已做 / 总题数" />
      <StatCard
        label="总正确率"
        :value="totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) + '%' : '--'"
      />
      <StatCard
        label="近期正确率"
        :value="doneCount ? recentCorrectRate + '%' : '--'"
        sub="近30题"
      />
    </div>

    <section class="section">
      <h2>掌握程度</h2>
      <div class="mastery-bar">
        <div class="seg mastered" :style="{ flex: mastery.mastered }">{{ mastery.mastered }}</div>
        <div class="seg learning" :style="{ flex: mastery.learning }">{{ mastery.learning }}</div>
        <div class="seg weak" :style="{ flex: mastery.weak }">{{ mastery.weak }}</div>
        <div class="seg untouched" :style="{ flex: mastery.untouched }">
          {{ mastery.untouched }}
        </div>
      </div>
      <div class="mastery-legend">
        <span>已掌握</span><span>学习中</span><span>薄弱</span><span>未做</span>
      </div>
    </section>

    <section class="section" v-if="!isGroupView && !hasSubBanks">
      <h2>快速开始</h2>
      <div class="quick-actions">
        <button class="btn btn-accent" @click="startQuiz('sequential')">顺序刷题</button>
        <button class="btn btn-outline" @click="startQuiz('random')">随机刷题</button>
        <ActionMenuButton
          v-if="reviewDueIds.length > 0"
          :label="`待复习 (${reviewDueIds.length})`"
          :items="ORDER_ITEMS"
          @select="(shuffle) => startQuiz('review', { shuffle })"
        />
        <ActionMenuButton
          v-if="untouchedIds.length > 0"
          :label="`未做题 (${untouchedIds.length})`"
          :items="ORDER_ITEMS"
          @select="(shuffle) => startQuiz('untouched', { shuffle })"
        />
        <ActionMenuButton
          v-if="wrongIds.length > 0"
          variant="danger"
          :label="`错题重刷 (${wrongIds.length})`"
          :items="ORDER_ITEMS"
          @select="(shuffle) => startQuiz('wrong', { shuffle })"
        />
        <button class="btn btn-outline" @click="startQuiz('weakness')">弱点突破</button>
      </div>
    </section>

    <!-- Grammar notes entry — only visible when unlocked -->
    <section
      v-if="isUnlocked && activeCategory === 'japanese2' && activeSubBankKey !== 'word'"
      class="grammar-entry-card"
      @click="router.push('/grammar-notes')"
    >
      <div class="ge-icon" aria-hidden="true">文</div>
      <div class="ge-body">
        <div class="ge-title">核心语法整理</div>
        <div class="ge-sub">第 26–36 课句型 · 变形规则 · 易混辨析 · 速记口诀</div>
      </div>
      <div class="ge-arrow" aria-hidden="true">→</div>
    </section>

    <!-- Sub-bank selection cards -->
    <Transition name="sb-fade" mode="out-in">
      <section class="section" v-if="hasSubBanks && !activeSubBankKey" key="subbanks">
        <h2>选择题库</h2>
        <p class="section-hint">选择一个子题库进入对应题组</p>
        <div class="subbank-grid">
          <div
            v-for="sb in visibleSubBanks"
            :key="sb.key"
            class="subbank-card"
            @click="selectSubBank(sb.key)"
          >
            <div class="sb-icon">
              {{ sb.key === 'textbook' ? '文' : sb.key === '2021' ? '試' : '卷' }}
            </div>
            <div class="sb-body">
              <div class="sb-title">{{ sb.name }}</div>
              <div class="sb-desc">{{ sb.desc }}</div>
              <div class="sb-meta">
                {{ questions.filter((q) => sb.groupOrder.includes(q.groupId)).length }} 题 ·
                {{ sb.groupOrder.length }} 个分组
              </div>
            </div>
            <div class="sb-arrow">→</div>
          </div>
        </div>
      </section>

      <!-- Sub-bank group view with full-set bar -->
      <section class="section" v-else-if="hasSubBanks && activeSubBankKey" key="groups">
        <div class="subbank-back-row">
          <button class="btn btn-ghost back-btn" @click="clearSubBank">
            <span class="back-arrow">←</span> 题库列表
          </button>
        </div>
        <div class="full-set-bar">
          <div class="full-set-info">
            <h2>{{ currentSubBank?.name }}</h2>
            <p class="full-set-desc">{{ currentSubBank?.desc }}</p>
          </div>
          <div class="full-set-actions">
            <button class="btn btn-accent" @click="startSubBankFull('sequential')">
              刷整套 · 顺序
            </button>
            <button class="btn btn-outline" @click="startSubBankFull('random')">
              刷整套 · 随机
            </button>
            <ActionMenuButton
              label="未做"
              :items="ORDER_ITEMS"
              @select="(shuffle) => startSubBankFull('untouched', { shuffle })"
            />
            <ActionMenuButton
              variant="danger"
              label="错题"
              :items="ORDER_ITEMS"
              @select="(shuffle) => startSubBankFull('wrong', { shuffle })"
            />
          </div>
        </div>
      </section>
    </Transition>

    <!-- Grouped categories (history/party/military): full-set bar + group cards -->
    <section class="section" v-if="isGroupView && !hasSubBanks">
      <div class="full-set-bar">
        <div class="full-set-info">
          <h2>{{ groupViewSectionTitle }}</h2>
          <p class="full-set-desc">{{ groupViewHint }}</p>
        </div>
        <div class="full-set-actions">
          <button class="btn btn-accent" @click="startQuiz('sequential')">刷整套 · 顺序</button>
          <button class="btn btn-outline" @click="startQuiz('random')">刷整套 · 随机</button>
          <ActionMenuButton
            label="未做"
            :items="ORDER_ITEMS"
            @select="(shuffle) => startQuiz('untouched', { shuffle })"
          />
          <ActionMenuButton
            variant="danger"
            label="错题"
            :items="ORDER_ITEMS"
            @select="(shuffle) => startQuiz('wrong', { shuffle })"
          />
        </div>
      </div>
      <div class="group-grid">
        <div v-for="g in groupViewList" :key="g.groupId" class="group-card">
          <div class="gc-header">
            <span class="gc-title">{{ g.groupTitle }}</span>
            <span class="gc-count">{{ groupStats[g.groupId]?.total ?? g.count }} 题</span>
          </div>
          <div class="gc-stats">
            <span
              >已做 <strong>{{ groupStats[g.groupId]?.done ?? 0 }}</strong></span
            >
            <span
              >正确率
              <strong>{{
                groupStats[g.groupId] && groupStats[g.groupId].attempts
                  ? Math.round(
                      (groupStats[g.groupId].correct / groupStats[g.groupId].attempts) * 100,
                    ) + '%'
                  : '--'
              }}</strong></span
            >
            <span
              >错题 <strong>{{ groupStats[g.groupId]?.wrong ?? 0 }}</strong></span
            >
          </div>
          <div class="gc-actions">
            <button
              class="btn btn-accent btn-sm"
              @click="startHistoryGroup(g.groupId, 'sequential')"
            >
              顺序
            </button>
            <button class="btn btn-outline btn-sm" @click="startHistoryGroup(g.groupId, 'random')">
              随机
            </button>
            <ActionMenuButton
              variant="danger"
              size="sm"
              :label="`错题 (${groupStats[g.groupId]?.wrongIds.length ?? 0})`"
              :items="ORDER_ITEMS"
              :disabled="(groupStats[g.groupId]?.wrongIds.length ?? 0) === 0"
              @select="(shuffle) => startHistoryGroup(g.groupId, 'wrong', { shuffle })"
            />
            <ActionMenuButton
              size="sm"
              :label="`未做 (${groupStats[g.groupId]?.untouchedIds.length ?? 0})`"
              :items="ORDER_ITEMS"
              :disabled="(groupStats[g.groupId]?.untouchedIds.length ?? 0) === 0"
              @select="(shuffle) => startHistoryGroup(g.groupId, 'untouched', { shuffle })"
            />
          </div>
        </div>
      </div>
    </section>

    <section class="section" v-if="weakTags.length > 0 && !isGroupView">
      <h2>{{ weakSectionTitle }}</h2>
      <div class="weak-list">
        <div
          v-for="w in weakTags.slice(0, 6)"
          :key="w.tag"
          class="weak-item"
          @click="startTagQuiz(w.tag)"
        >
          <div class="weak-info">
            <span class="weak-tag">{{ w.tag }}</span>
            <span class="weak-rate">正确率 {{ w.correctRate }}%</span>
          </div>
          <div class="weak-bar-bg">
            <div
              class="weak-bar"
              :style="{
                width: w.correctRate + '%',
                background:
                  w.correctRate < 50
                    ? 'var(--wrong)'
                    : w.correctRate < 70
                      ? 'var(--warning)'
                      : 'var(--correct)',
              }"
            />
          </div>
          <span class="weak-arrow">&rarr;</span>
        </div>
      </div>
    </section>

    <section class="section" v-if="!isGroupView">
      <h2>{{ tagSectionTitle }}</h2>
      <div class="tag-cloud">
        <TagBadge
          v-for="t in visibleTags"
          :key="t.tag"
          :tag="t.tag"
          :clickable="true"
          @click="startTagQuiz(t.tag)"
        />
      </div>
    </section>
  </div>
</template>
<style scoped>
.home {
  max-width: 900px;
  margin: 0 auto;
}

.home-header {
  margin-bottom: 28px;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
h1 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 4px;
  letter-spacing: 1px;
}
.subtitle {
  color: var(--text-secondary);
  font-size: 14px;
}
.streak-chip {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  border: 1px solid var(--accent);
  padding: 2px 8px;
  font-family: var(--font-mono);
  letter-spacing: 0.5px;
}

.resume-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  margin-bottom: 24px;
  border: 1px solid var(--border);
  background: var(--bg-card);
}
.resume-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.resume-title {
  font-weight: 600;
  font-size: 14px;
}
.resume-meta {
  font-size: 12px;
  color: var(--text-secondary);
}
.resume-actions {
  display: flex;
  gap: 8px;
}

/* 每日目标进度条 */
.daily-goal-bar {
  margin-bottom: 24px;
  padding: 14px 18px;
  border: 1px solid var(--border);
  background: var(--bg-card);
}
.dg-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.dg-label {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}
.dg-hint {
  font-weight: 400;
  font-size: 12px;
  color: var(--text-muted);
}
.dg-count {
  font-size: 13px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}
.dg-track {
  height: 8px;
  background: var(--bg-hover);
  overflow: hidden;
}
.dg-fill {
  height: 100%;
  transition:
    width 0.5s var(--ease-brush),
    background 0.3s var(--ease-ink);
}
.dg-complete {
  margin-top: 8px;
  font-size: 13px;
  color: var(--correct);
  font-weight: 600;
  animation: fade-up 0.4s var(--ease-brush) both;
}

.stats-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 32px;
}

.section {
  margin-bottom: 32px;
}
.section h2 {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 14px;
  color: var(--text-primary);
}

.mastery-bar {
  display: flex;
  height: 24px;
  overflow: hidden;
  margin-bottom: 8px;
}
.mastery-bar .seg {
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 12px;
  color: #fff;
  min-width: 0;
  transition: flex 0.55s var(--ease-brush);
}
.mastered {
  background: var(--correct);
}
.learning {
  background: #5a7d9a;
}
.weak {
  background: var(--warning);
}
.untouched {
  background: #c0bfbc;
}
.mastery-legend {
  display: flex;
  gap: 20px;
  font-size: 12px;
  color: var(--text-muted);
}

.quick-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.weak-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.weak-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  cursor: pointer;
  transition:
    border-color 0.22s var(--ease-ink),
    background 0.22s var(--ease-ink),
    transform 0.22s var(--ease-ink);
}
.weak-item:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
  transform: translateX(4px);
}
.weak-info {
  min-width: 140px;
  display: flex;
  flex-direction: column;
}
.weak-tag {
  font-weight: 600;
  font-size: 14px;
}
.weak-rate {
  font-size: 12px;
  color: var(--text-muted);
}
.weak-bar-bg {
  flex: 1;
  height: 4px;
  background: var(--bg-hover);
  overflow: hidden;
}
.weak-bar {
  height: 100%;
  transition: width 0.45s var(--ease-brush);
}
.weak-arrow {
  color: var(--text-muted);
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.section-hint {
  color: var(--text-muted);
  font-size: 13px;
  margin-bottom: 16px;
  line-height: 1.6;
}
.full-set-desc {
  color: var(--text-muted);
  font-size: 13px;
  margin: 0;
}

/* ---- Sub-bank cards ---- */
.subbank-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.subbank-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-left: 3px solid var(--border);
  cursor: pointer;
  transition:
    border-color 0.25s var(--ease-ink),
    border-left-color 0.25s var(--ease-ink),
    background 0.25s var(--ease-ink),
    transform 0.25s var(--ease-ink);
}
.subbank-card:hover {
  border-color: var(--accent);
  border-left-color: var(--accent);
  background: var(--bg-hover);
  transform: translateX(6px);
}
.sb-icon {
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
  color: #fff;
  background: var(--accent);
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sb-body {
  flex: 1;
  min-width: 0;
}
.sb-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.sb-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 4px;
}
.sb-meta {
  font-size: 12px;
  color: var(--text-muted);
}
.sb-arrow {
  font-size: 18px;
  color: var(--accent);
  flex-shrink: 0;
  transition: transform 0.25s var(--ease-brush);
}
.subbank-card:hover .sb-arrow {
  transform: translateX(4px);
}

/* ---- Full-set bar ---- */
.full-set-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 16px 20px;
  margin-bottom: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
}
.full-set-info {
  min-width: 0;
}
.full-set-info h2 {
  margin-bottom: 4px;
}
.full-set-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

/* ---- Back row ---- */
.subbank-back-row {
  margin-bottom: 12px;
}
.back-btn {
  font-size: 13px;
  padding: 4px 10px;
  transition: opacity 0.15s;
}
.back-btn:hover {
  opacity: 0.7;
}
.back-arrow {
  margin-right: 4px;
}

/* ---- Transition ---- */
.sb-fade-enter-active {
  transition:
    opacity 0.24s var(--ease-page),
    transform 0.28s var(--ease-page);
}
.sb-fade-leave-active {
  transition:
    opacity 0.14s var(--ease-ink),
    transform 0.16s var(--ease-ink);
}
.sb-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.sb-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.group-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition:
    border-color 0.22s var(--ease-ink),
    transform 0.22s var(--ease-ink);
}
.group-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}
.gc-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.gc-title {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.gc-count {
  font-size: 13px;
  color: var(--text-muted);
}
.gc-stats {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--text-secondary);
}
.gc-stats strong {
  color: var(--text-primary);
  font-weight: 600;
}
.gc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.grammar-entry-card {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 22px;
  margin-bottom: 32px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  cursor: pointer;
  transition:
    border-color 0.22s var(--ease-ink),
    background 0.22s var(--ease-ink),
    transform 0.22s var(--ease-ink);
}
.grammar-entry-card:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
  transform: translateX(4px);
}
.ge-arrow {
  font-size: 18px;
  color: var(--accent);
  flex-shrink: 0;
  transition: transform 0.25s var(--ease-brush);
}
.grammar-entry-card:hover .ge-arrow {
  transform: translateX(3px);
}
.ge-icon {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  background: var(--accent);
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 1px;
}
.ge-body {
  flex: 1;
  min-width: 0;
}
.ge-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  letter-spacing: 0.5px;
}
.ge-sub {
  font-size: 13px;
  color: var(--text-secondary);
}

/* 错误状态 */
.home-error {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
}
.error-box {
  text-align: center;
  padding: 48px 32px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  max-width: 400px;
}
.error-box h2 {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 12px;
}
.error-box p {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 24px;
  line-height: 1.6;
}
</style>
