<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { loadQuestionBank } from '../services/quizEngine'
import { loadActiveCategory, setActiveCategory } from '../services/categoryStore'
import { db } from '../db/database'
import type { Category } from '../types/question'

const router = useRouter()

const counts = ref<Record<string, number>>({})
const totalDone = ref(0)
const totalQuestions = ref(0)

onMounted(async () => {
  await loadActiveCategory()
  const cats: Category[] = ['grammar', 'word', 'history', 'party', 'military']
  for (const cat of cats) {
    const qs = await loadQuestionBank(cat)
    counts.value[cat] = qs.length
  }
  totalQuestions.value = Object.values(counts.value).reduce((a, b) => a + b, 0)

  const stats = await db.questionStats.toArray()
  totalDone.value = stats.filter(s => s.attemptCount > 0).length
})

function enterSubject(cat: Category) {
  setActiveCategory(cat)
  router.push('/home')
}

function quickStart() {
  router.push('/home')
}

const subjects = [
  { key: 'grammar' as Category, title: '日语语法', desc: '大家的日语 第26–36课 · 语法点辨析与填空', icon: '文' },
  { key: 'word' as Category, title: '日语单词', desc: '汉字 ↔ 假名互选 · 课次标签分组', icon: '語' },
  { key: 'history' as Category, title: '中国近现代史', desc: '11个刷题单 · 单选/多选/判断 · 机考模拟', icon: '史' },
  { key: 'party' as Category, title: '中国共产党党史', desc: '7个刷题单 · 单选/多选/判断 · 优先级分层', icon: '党' },
  { key: 'military' as Category, title: '军事理论', desc: '22个刷题单 · 按章节/按优先级 · 必考核心标注', icon: '军' },
]
</script>

<template>
  <div class="landing">
    <!-- Hero -->
    <section class="hero">
      <div class="hero-badge">DLUT · 国际信息与软件学院</div>
      <h1 class="hero-title">题库</h1>
      <p class="hero-sub">日语语法词汇 · 近代史 · 党史 · 军事理论<br>一体化期末复习平台</p>
      <p class="hero-desc">
        覆盖 {{ totalQuestions.toLocaleString() }} 道题目，内置智能错题本、掌握度追踪、薄弱点分析。
        键盘驱动，高效刷题。
      </p>
      <div class="hero-actions">
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
        <span class="strip-num">5</span>
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
        <div
          v-for="s in subjects" :key="s.key"
          class="subject-card"
          @click="enterSubject(s.key)"
        >
          <div class="sc-icon">{{ s.icon }}</div>
          <div class="sc-body">
            <h3 class="sc-title">{{ s.title }}</h3>
            <p class="sc-desc">{{ s.desc }}</p>
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
          <p>A/B/C/D 选择，Enter 提交/下一题，N 下一题——手不离键盘。</p>
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
        <span>题库 &copy; 2025 tianxingleo</span>
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
.landing { max-width: 960px; margin: 0 auto; padding: 0 24px; }

/* Hero */
.hero { text-align: center; padding: 80px 0 60px; }
.hero-badge {
  display: inline-block; padding: 4px 16px; border: 1px solid var(--border);
  font-size: 13px; color: var(--text-muted); margin-bottom: 28px;
}
.hero-title {
  font-family: var(--font-display); font-size: 56px; font-weight: 700;
  letter-spacing: 8px; color: var(--text-primary); margin-bottom: 20px;
  line-height: 1.2;
}
.hero-sub {
  font-family: var(--font-display); font-size: 18px;
  color: var(--text-secondary); line-height: 1.8; margin-bottom: 16px;
}
.hero-desc {
  font-size: 14px; color: var(--text-muted); max-width: 500px;
  margin: 0 auto 36px; line-height: 1.7;
}
.hero-actions { display: flex; gap: 10px; justify-content: center; }

/* Stats strip */
.stats-strip {
  display: flex; align-items: center; justify-content: center; gap: 0;
  padding: 32px 0; margin-bottom: 64px;
  border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
}
.strip-item {
  display: flex; flex-direction: column; align-items: center;
  padding: 0 36px;
}
.strip-num {
  font-family: var(--font-display); font-size: 28px; font-weight: 600;
  color: var(--accent);
}
.strip-label { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
.strip-divider { width: 1px; height: 36px; background: var(--border); }

/* Subjects */
.subjects { margin-bottom: 72px; }
.subjects h2 {
  font-family: var(--font-display); font-size: 18px; font-weight: 600;
  text-align: center; margin-bottom: 28px; letter-spacing: 1px;
}
.subject-grid { display: flex; flex-direction: column; gap: 8px; }
.subject-card {
  display: flex; align-items: center; gap: 20px;
  padding: 20px 24px; border: 1px solid var(--border);
  background: var(--bg-card); cursor: pointer;
  transition: all .15s;
}
.subject-card:hover { border-color: var(--accent); transform: translateX(4px); }
.sc-icon {
  width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-size: 22px; color: var(--accent);
  border: 1px solid var(--border); flex-shrink: 0;
}
.sc-body { flex: 1; min-width: 0; }
.sc-title { font-family: var(--font-display); font-size: 16px; font-weight: 600; margin-bottom: 2px; }
.sc-desc { font-size: 13px; color: var(--text-muted); }
.sc-count { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
.sc-arrow { color: var(--text-muted); font-size: 18px; }

/* Features */
.features { margin-bottom: 72px; }
.features h2 {
  font-family: var(--font-display); font-size: 18px; font-weight: 600;
  text-align: center; margin-bottom: 28px; letter-spacing: 1px;
}
.feature-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;
}
.feature-card {
  padding: 20px; border: 1px solid var(--border);
  background: var(--bg-card);
}
.feature-card h3 { font-family: var(--font-display); font-size: 15px; font-weight: 600; margin-bottom: 8px; }
.feature-card p { font-size: 13px; color: var(--text-secondary); line-height: 1.7; }

/* CTA */
.cta {
  text-align: center; padding: 60px 0; margin-bottom: 48px;
  border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
}
.cta h2 {
  font-family: var(--font-display); font-size: 22px; font-weight: 700;
  margin-bottom: 8px; letter-spacing: 1px;
}
.cta p { font-size: 14px; color: var(--text-muted); margin-bottom: 24px; }

/* Footer */
.landing-footer { text-align: center; padding: 24px 0 48px; }
.footer-row { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 13px; color: var(--text-muted); }
.footer-row a { color: var(--text-secondary); }
.footer-row a:hover { color: var(--accent); text-decoration: none; }
.footer-dot { color: var(--border); }
.footer-note { font-size: 12px; color: var(--text-muted); margin-top: 8px; }

@media (max-width: 640px) {
  .hero { padding: 40px 0 32px; }
  .hero-title { font-size: 36px; letter-spacing: 4px; }
  .hero-sub { font-size: 15px; }
  .stats-strip { flex-wrap: wrap; gap: 12px; padding: 20px 0; }
  .strip-item { padding: 0 20px; }
  .strip-divider { display: none; }
  .subject-card { padding: 14px 16px; }
  .sc-icon { width: 40px; height: 40px; font-size: 18px; }
  .feature-grid { grid-template-columns: 1fr; }
}
</style>
