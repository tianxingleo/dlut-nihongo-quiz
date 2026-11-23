<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { pruneInactiveSessions, sessionActivityMs } from '../services/sessionResume'
import { loadCatalog, summarizeProgress } from '../services/questionCatalog'
import { useHiddenSite } from '../composables/useHiddenSite'
import { CATEGORIES } from '../config/categories'
import { ENTRIES, findEntry, entryOfCategory } from '../config/entries'
import { db } from '../db/database'
import type { Category } from '../types/question'
import type { CategoryMeta } from '../config/categories'

const route = useRoute()
const { isUnlocked } = useHiddenSite()
/** 当前是不是某个入口的二级页（路由 `/<入口 key>`，入口清单在 src/config/entries.ts） */
const currentEntry = computed(() => findEntry(route.params.entryKey as string | undefined))
/** 该入口下的试卷，顺序就是 entries.ts 里 `papers` 的顺序 */
const currentGroup = computed(() =>
  currentEntry.value?.groups?.find((g) => g.key === route.query.group),
)
const showingFolders = computed(() =>
  Boolean(currentEntry.value?.groups?.length && !currentGroup.value),
)
const folderCards = computed(() =>
  (currentEntry.value?.groups ?? []).map((g) => ({
    ...g,
    count: g.papers.reduce((sum, key) => sum + (counts.value[key] || 0), 0),
    progress: aggregateProgress(g.papers),
  })),
)
const entryPapers = computed(() =>
  (currentGroup.value?.papers ?? currentEntry.value?.papers ?? [])
    .map((key) => CATEGORIES.find((c) => c.key === key))
    .filter((c): c is CategoryMeta => Boolean(c)),
)
const entryQuestionCount = computed(() =>
  entryPapers.value.reduce((sum, c) => sum + (counts.value[c.key] || 0), 0),
)
/** 第一层的入口卡（题数实时汇总各入口下的试卷） */
const entryCards = computed(() =>
  ENTRIES.map((entry) => ({
    key: entry.key,
    name: entry.name,
    icon: entry.icon,
    desc: entry.desc || `${entry.papers.length} 份试卷 · 按卷选择题单 · 答案解析`,
    questions: entry.papers.reduce((sum, key) => sum + (counts.value[key] || 0), 0),
    progress: aggregateProgress(entry.papers),
  })),
)

const counts = ref<Record<Category, number>>({} as Record<Category, number>)
const categoryProgress = ref<Partial<Record<Category, ReturnType<typeof summarizeProgress>>>>({})
function aggregateProgress(papers: Category[]) {
  const stats = papers.map((key) => categoryProgress.value[key])
  const done = stats.reduce((sum, item) => sum + (item?.done ?? 0), 0)
  const correct = stats.reduce((sum, item) => sum + (item?.correct ?? 0), 0)
  const attempts = stats.reduce((sum, item) => sum + (item?.attempts ?? 0), 0)
  return { done, rate: attempts ? Math.round((correct / attempts) * 100) : 0 }
}
const totalDone = ref(0)
const totalQuestions = ref(0)
const loading = ref(true)
const error = ref('')
const currentYear = new Date().getFullYear()
const recent = ref<{
  key: string
  category: Category
  label: string
  index: number
  total: number
}>()

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const [banks, stats, sessions] = await Promise.all([
      loadCatalog(),
      db.questionStats.toArray(),
      pruneInactiveSessions(),
    ])
    const statsById = new Map(stats.map((s) => [s.questionId, s]))
    const share = banks.map(({ category, questions }) => ({
      category,
      ids: questions.filter((q) => isUnlocked.value || !q.hidden).map((q) => q.id),
    }))
    counts.value = Object.fromEntries(
      share.map(({ category, ids }) => [category, ids.length]),
    ) as Record<Category, number>
    categoryProgress.value = Object.fromEntries(
      share.map(({ category, ids }) => [category, summarizeProgress(ids, statsById)]),
    )
    totalQuestions.value = share.reduce((sum, { ids }) => sum + ids.length, 0)
    totalDone.value = Object.values(categoryProgress.value).reduce((sum, row) => sum + row.done, 0)
    recent.value = undefined
    const visibleIds = new Map(share.map(({ category, ids }) => [category, new Set(ids)]))
    const latest = Object.entries(sessions)
      .sort(([, a], [, b]) => sessionActivityMs(b) - sessionActivityMs(a))
      .find(([key, session]) => {
        const hasProgress =
          session.lastActivityAt || !session.optionSignatures || session.currentIndex > 0
        const ids = visibleIds.get(key.split('|')[0] as Category)
        return hasProgress && ids && session.questionIds.every((id) => ids.has(id))
      })
    if (latest) {
      const [key, session] = latest
      const bank = banks.find((bank) => bank.category === key.split('|')[0])
      const course = CATEGORIES.find((category) => category.key === bank?.category)
      if (bank && course) {
        const [, scope] = key.split('|')
        const groups = new Set(scope.split(','))
        const title = bank.questions.find((q) => groups.has(q.groupId))?.groupTitle
        const label =
          scope === 'all'
            ? session.mode.startsWith('tag:')
              ? session.mode.slice(4).trim()
              : '整科练习'
            : scope === 'review' || groups.size > 1
              ? session.mode
              : title || session.mode
        recent.value = {
          key,
          category: course.key,
          label: `${course.long} · ${label}`,
          index: session.currentIndex + Number(session.submitted) + 1,
          total: session.totalQuestions,
        }
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载题库失败，请刷新页面重试'
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
watch(isUnlocked, refresh)

const subjects = computed(() =>
  (showingFolders.value
    ? []
    : currentEntry.value
      ? entryPapers.value
      : CATEGORIES.filter((c) => !entryOfCategory(c.key))
  ).map((c) => ({
    key: c.key,
    title: currentEntry.value ? c.short : c.long,
    desc: c.desc,
    icon: c.icon,
  })),
)

// 第一层的卡片数：不归属任何入口的学科 + 各入口 + 微积分笔记
const subjectCount = CATEGORIES.filter((c) => !entryOfCategory(c.key)).length + ENTRIES.length + 1
</script>

<template>
  <div class="landing">
    <!-- Hero -->
    <header v-if="currentEntry" class="paper-header">
      <RouterLink class="btn btn-ghost" :to="currentGroup ? '/' + currentEntry.key : '/'">{{
        currentGroup ? '← 返回' + currentEntry.name : '← 返回学科首页'
      }}</RouterLink>
      <h1>{{ currentEntry.name }}{{ currentGroup ? ' · ' + currentGroup.name : '' }}</h1>
      <p>
        {{ entryPapers.length }} 份试卷 · {{ loading || error ? '—' : entryQuestionCount }} 题，{{
          showingFolders ? '选择分类后查看试卷。' : '选择试卷后进入题单。'
        }}
      </p>
    </header>
    <section v-else class="hero">
      <h1 class="hero-title">期末复习题库</h1>
      <p class="hero-sub">大连理工大学国际信息与软件学院</p>
      <div v-if="recent" class="hero-actions">
        <RouterLink
          class="btn btn-accent btn-lg"
          :to="{
            path: '/quiz',
            query: { resume: '1', category: recent.category, paper: recent.key },
          }"
          >继续上次</RouterLink
        >
      </div>
      <p v-if="recent" class="resume-detail">
        {{ recent.label }} · 第 {{ recent.index }}/{{ recent.total }} 题
      </p>
    </section>

    <!-- Subject cards -->
    <section class="subjects" :class="{ 'subjects-index': !currentEntry }">
      <h2>
        {{ showingFolders ? '选择分类' : currentEntry ? '选择试卷' : '课程列表' }}
      </h2>
      <div class="subject-grid">
        <template v-if="showingFolders && currentEntry">
          <RouterLink
            v-for="folder in folderCards"
            :key="folder.key"
            class="subject-card subject-link"
            :to="{ path: '/' + currentEntry.key, query: { group: folder.key } }"
          >
            <div class="sc-body">
              <h3 class="sc-title">{{ folder.name }}</h3>
              <p class="sc-desc">{{ folder.papers.length }} 份题库</p>
              <p v-if="folder.progress.done" class="sc-progress-text">
                已做 {{ folder.progress.done }} 题 · 正确率 {{ folder.progress.rate }}%
              </p>
            </div>
            <div class="sc-count">{{ loading || error ? '—' : folder.count }} 题</div>
          </RouterLink>
        </template>
        <!-- 入口卡：清单与顺序都由 src/config/entries.ts 决定 -->
        <template v-if="!currentEntry">
          <RouterLink
            v-for="e in entryCards"
            :key="e.key"
            class="subject-card subject-link"
            :to="`/${e.key}`"
          >
            <div class="sc-body">
              <h3 class="sc-title">{{ e.name }}</h3>
              <p class="sc-desc">{{ e.desc }}</p>
              <p v-if="e.progress.done" class="sc-progress-text">
                已做 {{ e.progress.done }} 题 · 正确率 {{ e.progress.rate }}%
              </p>
            </div>
            <div class="sc-count">{{ loading || error ? '—' : e.questions }} 题</div>
          </RouterLink>
        </template>
        <RouterLink
          v-for="s in subjects"
          :key="s.key"
          class="subject-card subject-link"
          :to="{ path: '/home', query: { category: s.key } }"
        >
          <div class="sc-body">
            <h3 class="sc-title">{{ s.title }}</h3>
            <p class="sc-desc">{{ s.desc }}</p>
            <div class="sc-progress" v-if="categoryProgress[s.key]?.done">
              <div class="sc-progress-bar">
                <div
                  class="sc-progress-fill"
                  :style="{
                    width:
                      Math.min(
                        100,
                        ((categoryProgress[s.key]?.done ?? 0) / (counts[s.key] || 1)) * 100,
                      ) + '%',
                  }"
                />
              </div>
              <span class="sc-progress-text">
                已做 {{ categoryProgress[s.key]?.done ?? 0 }} 题 · 正确率
                {{ categoryProgress[s.key]?.rate }}%
              </span>
            </div>
          </div>
          <div class="sc-count">{{ counts[s.key] || '—' }} 题</div>
        </RouterLink>
        <RouterLink v-if="!currentEntry" class="subject-card subject-link" to="/calculus-notes">
          <div class="sc-body">
            <h3 class="sc-title">微积分2</h3>
            <p class="sc-desc">第1–18课 · 级数至高斯公式 · 笔记整理</p>
          </div>
          <div class="sc-count">18 课</div>
        </RouterLink>
      </div>
      <p v-if="loading" role="status">正在读取题库目录…</p>
      <div v-else-if="error" role="status">
        {{ error }} <button class="btn btn-outline" @click="refresh">重试</button>
      </div>
    </section>

    <section v-if="!currentEntry && !loading && !error" class="stats-strip" aria-label="题库统计">
      <div class="strip-item">
        <span class="strip-num">{{ totalQuestions.toLocaleString() }}</span>
        <span class="strip-label">题库总量</span>
      </div>
      <div class="strip-divider" />
      <div class="strip-item">
        <span class="strip-num">{{ totalDone.toLocaleString() }}</span>
        <span class="strip-label">已做题数</span>
      </div>
      <div class="strip-divider" />
      <div class="strip-item">
        <span class="strip-num">{{ subjectCount }}</span>
        <span class="strip-label">课程入口</span>
      </div>
    </section>

    <!-- Features -->
    <section v-if="!currentEntry" class="features">
      <h2>功能一览</h2>
      <div class="feature-grid">
        <div class="feature-card">
          <h3>多种刷题模式</h3>
          <p>顺序刷题、随机打乱、错题重刷、弱点突破、未做题攻克——选你喜欢的节奏。</p>
        </div>
        <div class="feature-card">
          <h3>智能错题本</h3>
          <p>自动收录错题，按错误次数排序，支持一键重刷全部错题或逐题标记掌握。</p>
        </div>
        <div class="feature-card">
          <h3>掌握度分析</h3>
          <p>每题追踪掌握等级，按题组/标签查看正确率，一眼看清强弱项。</p>
        </div>
        <div class="feature-card">
          <h3>会话恢复</h3>
          <p>中途退出自动保存进度，回来继续刷，不用担心白做。</p>
        </div>
        <div class="feature-card">
          <h3>键盘快捷键</h3>
          <p>A/B/C/D 或 1/2/3/4 选择，Enter 提交/下一题，N 下一题——手不离键盘。</p>
        </div>
        <div class="feature-card">
          <h3>数据备份</h3>
          <p>支持导出/导入 JSON 备份，刷题记录随身携带，换设备无缝切换。</p>
        </div>
      </div>
    </section>

    <footer class="landing-footer">
      <div class="footer-row">
        <span>题库 &copy; {{ currentYear }} tianxingleo</span>
        <span class="footer-dot">·</span>
        <a href="https://github.com/tianxingleo/dlut-nihongo-quiz" target="_blank">GitHub</a>
        <span class="footer-dot">·</span>
        <span>Apache-2.0</span>
      </div>
      <p class="footer-note">大连理工大学国际信息与软件学院 · 期末复习辅助工具</p>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 24px;
}

.paper-header {
  padding: 40px 0 28px;
}
.paper-header h1 {
  margin: 20px 0 12px;
  font-family: var(--font-display);
  font-size: clamp(24px, 5vw, 36px);
}
.paper-header p {
  color: var(--text-secondary);
  line-height: 1.7;
}
.subject-link {
  color: inherit;
  text-decoration: none;
}

/* Hero */
.hero {
  padding: 24px 0 28px;
  border-bottom: 1px solid var(--border);
}
.hero-title {
  font-family: var(--font-display);
  font-size: clamp(26px, 5vw, 40px);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
  overflow-wrap: break-word;
  min-width: 0;
  line-height: 1.2;
}
.hero-sub {
  font-family: var(--font-display);
  font-size: 15px;
  color: var(--text-secondary);
}
.hero-actions {
  display: flex;
  margin-top: 16px;
}

.resume-detail {
  margin-top: 16px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

/* Stats strip */
.stats-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 32px 0;
  margin-bottom: 64px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.strip-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 36px;
}
.strip-num {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 600;
  color: var(--accent);
}
.strip-label {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 4px;
}
.strip-divider {
  width: 1px;
  height: 36px;
  background: var(--border);
}

/* Subjects */
.subjects {
  margin-bottom: 72px;
}
.subjects h2 {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 600;
  margin-block: 20px 4px;
}
.subject-grid {
  display: flex;
  flex-direction: column;
}
.subject-card {
  display: flex;
  align-items: baseline;
  gap: 16px;
  padding: 14px 12px;
  border-bottom: 1px solid var(--border);
  transition: background-color 0.18s var(--ease-ink);
}
.subject-card:hover {
  background-color: var(--bg-hover);
}
.subject-card:focus-visible {
  outline-offset: -2px;
}
.sc-body {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.sc-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 2px;
}
.sc-desc {
  font-size: 13px;
  color: var(--text-muted);
}
.sc-progress {
  margin-top: 8px;
}
.sc-progress-bar {
  height: 4px;
  background: var(--bg-hover);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 4px;
}
.sc-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
}
.sc-progress-text {
  font-size: 11px;
  color: var(--text-muted);
}
.sc-count {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.subjects-index {
  margin-bottom: clamp(32px, 5vw, 56px);
}
.subjects-index h2 {
  margin-bottom: 8px;
}
.subjects-index .subject-card {
  padding-block: 16px;
}
.subjects-index .sc-title {
  line-height: 1.4;
  margin-bottom: 4px;
}
.subjects-index .sc-desc {
  line-height: 1.5;
  text-wrap: pretty;
}

/* Features */
.features {
  margin-bottom: 72px;
}
.features h2 {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 600;
  text-align: center;
  margin-bottom: 28px;
  letter-spacing: 1px;
}
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.feature-card {
  padding: 20px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  transition:
    border-color 0.22s var(--ease-ink),
    background 0.22s var(--ease-ink),
    transform 0.22s var(--ease-ink);
}
.feature-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}
.feature-card h3 {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 8px;
}
.feature-card p {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}

/* Footer */
.landing-footer {
  text-align: center;
  padding: 24px 0 48px;
}
.footer-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-muted);
}
.footer-row a {
  color: var(--text-secondary);
  transition: color 0.18s var(--ease-ink);
}
.footer-row a:hover {
  color: var(--accent);
  text-decoration: none;
}
.footer-dot {
  color: var(--border);
}
.footer-note {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 8px;
}

@media (max-width: 639px) {
  .landing {
    padding-inline: 14px;
  }
  .hero {
    padding: 16px 0 20px;
  }
  .stats-strip {
    flex-wrap: wrap;
    gap: 12px;
    padding: 20px 0;
  }
  .strip-item {
    padding: 0 20px;
  }
  .strip-divider {
    display: none;
  }
  .subject-card {
    padding-inline: 4px;
    gap: 8px;
  }
  .subjects-index .subject-card {
    padding-block: 12px;
    gap: 12px;
  }
  .feature-grid {
    grid-template-columns: 1fr;
  }
}
</style>
