<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { getCategoryCounts } from '../services/quizEngine'
import { loadActiveCategory, setActiveCategory } from '../services/categoryStore'
import { CATEGORIES } from '../config/categories'
import { db } from '../db/database'
import type { Category } from '../types/question'

const router = useRouter()

const counts = ref<Record<Category, number>>({} as Record<Category, number>)
const categoryProgress = ref<Record<Category, { done: number; rate: number }>>(
  {} as Record<Category, { done: number; rate: number }>,
)
const totalDone = ref(0)
const totalQuestions = ref(0)
const loading = ref(true)
const error = ref('')
const currentYear = new Date().getFullYear()

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    await loadActiveCategory()
    // 5 个分类并发加载
    const [c, stats] = await Promise.all([getCategoryCounts(), db.questionStats.toArray()])
    counts.value = c
    totalQuestions.value = Object.values(c).reduce((a, b) => a + b, 0)
    totalDone.value = stats.filter((s) => s.attemptCount > 0).length

    // 计算每个学科的进度
    const progress: Record<string, { done: number; rate: number }> = {}
    for (const cat of CATEGORIES) {
      // 这里简化处理，实际需要根据 questionId 判断所属 category
      progress[cat.key] = { done: 0, rate: 0 }
    }
    // 使用全量 stats 计算总进度
    const doneCount = stats.filter((s) => s.attemptCount > 0).length
    const totalCorrect = stats.reduce((sum, s) => sum + s.correctCount, 0)
    const totalAttempts = stats.reduce((sum, s) => sum + s.attemptCount, 0)
    for (const cat of CATEGORIES) {
      progress[cat.key] = {
        done: doneCount,
        rate: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
      }
    }
    categoryProgress.value = progress as Record<Category, { done: number; rate: number }>
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载题库失败，请刷新页面重试'
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

async function enterSubject(cat: Category) {
  await setActiveCategory(cat)
  router.push('/home')
}

function quickStart() {
  router.push('/home')
}

function goCalculusNotes() {
  router.push('/calculus-notes')
}

const subjects = computed(() =>
  CATEGORIES.map((c) => ({ key: c.key, title: c.long, desc: c.desc, icon: c.icon })),
)

const subjectCount = computed(() => CATEGORIES.length)
</script>

<template>
  <div v-if="loading" class="landing">
    <section class="hero">
      <div class="hero-badge">DLUT · 国际信息与软件学院</div>
      <h1 class="hero-title">题库</h1>
      <p class="hero-sub">加载中…</p>
    </section>
  </div>
  <div v-else-if="error" class="landing">
    <section class="hero">
      <h1 class="hero-title">题库</h1>
      <p class="hero-sub" style="color: var(--wrong)">{{ error }}</p>
      <div class="hero-actions">
        <button class="btn btn-accent btn-lg" @click="refresh">重试</button>
      </div>
    </section>
  </div>
  <div v-else class="landing">
    <!-- Hero -->
    <section class="hero">
      <div class="hero-badge stagger-1">DLUT · 国际信息与软件学院</div>
      <h1 class="hero-title stagger-2">题库</h1>
      <p class="hero-sub stagger-3">
        日语语法词汇 · 近代史 · 党史 · 军事理论<br />一体化期末复习平台
      </p>
      <p class="hero-desc stagger-4">
        覆盖 {{ totalQuestions.toLocaleString() }} 道题目，内置智能错题本、掌握度追踪、薄弱点分析。
        键盘驱动，高效刷题。
      </p>
      <div class="hero-actions stagger-5">
        <button class="btn btn-accent btn-lg" @click="quickStart">开始复习</button>
        <button class="btn btn-outline btn-lg" @click="router.push('/settings')">了解更多</button>
      </div>
    </section>

    <!-- Stats strip -->
    <section class="stats-strip">
      <div class="strip-item">
        <span class="strip-num">{{ totalQuestions.toLocaleString() }}</span>
        <span class="strip-label">题库总量</span>
      </div>
      <div class="strip-divider" />
      <div class="strip-item">
        <span class="strip-num">{{ subjectCount }}</span>
        <span class="strip-label">学科门类</span>
      </div>
      <div class="strip-divider" />
      <div class="strip-item">
        <span class="strip-num">键盘</span>
        <span class="strip-label">驱动刷题</span>
      </div>
      <div class="strip-divider" />
      <div class="strip-item">
        <span class="strip-num">离线</span>
        <span class="strip-label">本地可用</span>
      </div>
    </section>

    <!-- Subject cards -->
    <section class="subjects">
      <h2>选择学科，开始复习</h2>
      <div class="subject-grid">
        <div class="subject-card calculus-card" @click="goCalculusNotes">
          <div class="sc-icon">微</div>
          <div class="sc-body">
            <h3 class="sc-title">微积分2</h3>
            <p class="sc-desc">第1–18课 · 级数→高斯公式 · 笔记整理</p>
          </div>
          <div class="sc-count">18 课</div>
          <span class="sc-arrow">&rarr;</span>
        </div>
        <div v-for="s in subjects" :key="s.key" class="subject-card" @click="enterSubject(s.key)">
          <div class="sc-icon">{{ s.icon }}</div>
          <div class="sc-body">
            <h3 class="sc-title">{{ s.title }}</h3>
            <p class="sc-desc">{{ s.desc }}</p>
            <div class="sc-progress" v-if="categoryProgress[s.key]?.done">
              <div class="sc-progress-bar">
                <div
                  class="sc-progress-fill"
                  :style="{ width: Math.min(100, (categoryProgress[s.key].done / (counts[s.key] || 1)) * 100) + '%' }"
                />
              </div>
              <span class="sc-progress-text">
                已做 {{ categoryProgress[s.key].done }} 题 · 正确率 {{ categoryProgress[s.key].rate }}%
              </span>
            </div>
          </div>
          <div class="sc-count">{{ counts[s.key] || '—' }} 题</div>
          <span class="sc-arrow">&rarr;</span>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="features">
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

    <!-- Footer CTA -->
    <section class="cta">
      <h2>准备好了吗？</h2>
      <p>选择一个学科，开始高效刷题。</p>
      <button class="btn btn-accent btn-lg" @click="quickStart">进入仪表盘</button>
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

/* Hero */
.hero {
  text-align: center;
  padding: 80px 0 60px;
}
.hero-badge {
  display: inline-block;
  padding: 4px 16px;
  border: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 28px;
  transition:
    border-color 0.25s var(--ease-ink),
    color 0.25s var(--ease-ink);
}
.hero-badge:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.hero-title {
  font-family: var(--font-display);
  font-size: 56px;
  font-weight: 700;
  letter-spacing: 8px;
  color: var(--text-primary);
  margin-bottom: 20px;
  line-height: 1.2;
}
.hero-sub {
  font-family: var(--font-display);
  font-size: 18px;
  color: var(--text-secondary);
  line-height: 1.8;
  margin-bottom: 16px;
}
.hero-desc {
  font-size: 14px;
  color: var(--text-muted);
  max-width: 500px;
  margin: 0 auto 36px;
  line-height: 1.7;
}
.hero-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
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
  text-align: center;
  margin-bottom: 28px;
  letter-spacing: 1px;
}
.subject-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.subject-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px 24px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--border);
  background: var(--bg-card);
  cursor: pointer;
  transition:
    border-color 0.25s var(--ease-ink),
    border-left-color 0.25s var(--ease-ink),
    background 0.25s var(--ease-ink),
    transform 0.25s var(--ease-ink);
  position: relative;
}
.subject-card::before {
  content: '';
  position: absolute;
  inset: -1px;
  border: 1px solid transparent;
  transition: border-color 0.3s var(--ease-ink);
  pointer-events: none;
  z-index: -1;
}
.subject-card:hover {
  border-color: var(--accent);
  border-left-color: var(--accent);
  transform: translateX(6px);
  background: var(--bg-hover);
}
.subject-card:hover::before {
  border-color: var(--accent);
}
.sc-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 22px;
  color: var(--accent);
  border: 1px solid var(--border);
  flex-shrink: 0;
  transition:
    border-color 0.25s var(--ease-ink),
    background 0.25s var(--ease-ink);
}
.subject-card:hover .sc-icon {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}
.sc-body {
  flex: 1;
  min-width: 0;
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
  transition: width 0.3s var(--ease-brush);
}
.sc-progress-text {
  font-size: 11px;
  color: var(--text-muted);
}
.sc-count {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}
.sc-arrow {
  color: var(--text-muted);
  font-size: 18px;
  transition:
    transform 0.25s var(--ease-brush),
    color 0.25s var(--ease-ink);
}
.subject-card:hover .sc-arrow {
  transform: translateX(4px);
  color: var(--accent);
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

/* CTA */
.cta {
  text-align: center;
  padding: 60px 0;
  margin-bottom: 48px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.cta h2 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 8px;
  letter-spacing: 1px;
}
.cta p {
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 24px;
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

@media (max-width: 640px) {
  .hero {
    padding: 40px 0 32px;
  }
  .hero-title {
    font-size: 36px;
    letter-spacing: 4px;
  }
  .hero-sub {
    font-size: 15px;
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
    padding: 14px 16px;
  }
  .sc-icon {
    width: 40px;
    height: 40px;
    font-size: 18px;
  }
  .feature-grid {
    grid-template-columns: 1fr;
  }
}
</style>
