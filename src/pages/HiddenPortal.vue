<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { marked } from 'marked'
import { useHiddenSite } from '../composables/useHiddenSite'
import { setActiveCategory, setActiveSubBankKey } from '../services/categoryStore'
import GrammarToc from '../components/GrammarToc.vue'
import rawNotes from '../content/grammar-notes.md?raw'

marked.setOptions({ gfm: true, breaks: false })

const router = useRouter()
const { isUnlocked, lock } = useHiddenSite()

if (!isUnlocked.value) {
  router.replace('/home')
}

const activeTab = ref<'catalog' | 'grammar'>('catalog')
const html = ref('')
const toc = ref<{ id: string; text: string; level: 2 | 3 }[]>([])
const activeId = ref('')
const mobileLesson = ref('')
const mobileLessons = ref<{ id: string; text: string; level: 2 | 3 }[]>([])

const subtitle = computed(() => {
  const lessons = mobileLessons.value.length
  const total = toc.value.length
  return `${lessons} 课 · 共 ${total} 个语法点 · 滚动阅读，点击目录跳转`
})

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s.·、，,:：()（）「」]/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildToc(markdown: string) {
  const items: { id: string; text: string; level: 2 | 3 }[] = []
  const seen = new Set<string>()
  for (const line of markdown.split('\n')) {
    if (line.startsWith('>')) continue
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const level = (m[1].length as 2) || 3
    const text = m[2].replace(/#+$/, '').trim()
    let id = slugify(text)
    let n = 2
    while (seen.has(id)) {
      id = `${slugify(text)}-${n++}`
    }
    seen.add(id)
    items.push({ id, text, level })
  }
  return items
}

function renderMarkdown(markdown: string): string {
  const raw = marked.parse(markdown, { async: false }) as string
  return raw.replace(/<(h[23])>([^<]+)<\/\1>/g, (_full, tag, text) => {
    return `<${tag} id="${slugify(text)}">${text}</${tag}>`
  })
}

function openGrammar() {
  activeTab.value = 'grammar'
  if (!html.value) {
    html.value = renderMarkdown(rawNotes)
    toc.value = buildToc(rawNotes)
    mobileLessons.value = toc.value.filter((t) => t.level === 2)
    if (toc.value.length > 0) {
      activeId.value = toc.value[0].id
      mobileLesson.value = toc.value[0].id
    }
    nextTick(() => setupObserver())
  }
}

function selectMobileLesson(id: string) {
  mobileLesson.value = id
  nextTick(() => navigateTo(id))
}

function backToCatalog() {
  activeTab.value = 'catalog'
}

function navigateTo(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const top = el.getBoundingClientRect().top + window.scrollY - 60
  window.scrollTo({ top, behavior: 'smooth' })
  activeId.value = id
}

let observer: IntersectionObserver | null = null
onUnmounted(() => {
  if (observer) observer.disconnect()
})
function setupObserver() {
  if (observer) observer.disconnect()
  const headings = document.querySelectorAll<HTMLElement>(
    '.grammar-embedded h2[id], .grammar-embedded h3[id]',
  )
  if (headings.length === 0) return
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible.length > 0) {
        const id = visible[0].target.getAttribute('id') || ''
        if (id) activeId.value = id
      }
    },
    { rootMargin: '-80px 0px -65% 0px', threshold: 0 },
  )
  headings.forEach((h) => observer!.observe(h))
}

async function openQuiz(subBank: 'grammar-2021' | 'grammar-2024') {
  await setActiveCategory('japanese2')
  setActiveSubBankKey(subBank)
  router.push('/quiz')
}

function closeHidden() {
  lock()
  router.replace('/home')
}

const hiddenCards = [
  {
    key: 'grammar',
    title: '核心语法整理',
    desc: '第 26–36 课 · 47 个语法点 · 左目录右正文',
    action: openGrammar,
    label: '进入阅读',
    accent: '文',
  },
  {
    key: '2024',
    title: '2024 年期末真题',
    desc: '80 题 · 汉字读音/假名→汉字/语法选择/语序',
    action: () => openQuiz('grammar-2024'),
    label: '开始刷题',
    accent: '肆',
  },
  {
    key: '2021',
    title: '2021 年期末真题',
    desc: '79 题 · 被动形/授受动词/可能形/読解',
    action: () => openQuiz('grammar-2021'),
    label: '开始刷题',
    accent: '壱',
  },
]
</script>

<template>
  <div class="hidden-portal">
    <!-- Catalog: bookshelf grid -->
    <template v-if="activeTab === 'catalog'">
      <div class="catalog">
        <div class="catalog-header">
          <h1 class="catalog-title">暗阁</h1>
          <p class="catalog-sub">山外青山楼外楼 · 此处别有洞天</p>
        </div>
        <div class="bookshelf">
          <button
            v-for="card in hiddenCards"
            :key="card.key"
            class="book-card"
            @click="card.action"
          >
            <span class="book-accent">{{ card.accent }}</span>
            <div class="book-body">
              <h3>{{ card.title }}</h3>
              <p>{{ card.desc }}</p>
              <span class="book-label">{{ card.label }} →</span>
            </div>
          </button>
        </div>
      </div>
    </template>

    <!-- Grammar notes inline -->
    <template v-if="activeTab === 'grammar'">
      <div class="grammar-page">
        <header class="grammar-header">
          <button class="grammar-back" @click="backToCatalog">← 返回暗阁目录</button>
          <div class="title-row">
            <h1>核心语法整理</h1>
            <span class="meta-chip">第 26–36 课</span>
          </div>
          <p class="grammar-subtitle">{{ subtitle }}</p>
        </header>

        <div class="mobile-lesson-switcher">
          <label for="lesson-select">跳转到</label>
          <select
            id="lesson-select"
            :value="mobileLesson"
            @change="selectMobileLesson(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="l in mobileLessons" :key="l.id" :value="l.id">{{ l.text }}</option>
          </select>
        </div>

        <div class="grammar-body">
          <aside class="grammar-side">
            <GrammarToc :items="toc" :active-id="activeId" @navigate="navigateTo" />
          </aside>
          <article class="grammar-content markdown-body grammar-embedded" v-html="html" />
        </div>

        <div class="grammar-footer-actions">
          <button class="btn btn-outline" @click="backToCatalog">返回目录</button>
        </div>
      </div>
    </template>

    <!-- "合上" exit button -->
    <div class="hidden-exit">
      <div class="exit-rule"></div>
      <button class="exit-btn" @click="closeHidden">合上</button>
      <div class="exit-rule"></div>
    </div>
  </div>
</template>

<style scoped>
.hidden-portal {
  max-width: 900px;
  margin: 0 auto;
  min-height: 70vh;
}

/* Catalog */
.catalog-header {
  text-align: center;
  margin-bottom: 36px;
}
.catalog-title {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--text-primary);
}
.catalog-sub {
  font-size: 14px;
  color: var(--text-muted);
  margin-top: 8px;
  letter-spacing: 2px;
}

/* Bookshelf grid */
.bookshelf {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin-bottom: 40px;
}

.book-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 28px 18px 20px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  cursor: pointer;
  transition:
    border-color 0.22s var(--ease-ink),
    transform 0.22s var(--ease-ink),
    background 0.22s var(--ease-ink);
  font-family: inherit;
  color: var(--text-primary);
}
.book-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}
.book-accent {
  font-family: var(--font-display);
  font-size: 32px;
  color: var(--accent);
  margin-bottom: 14px;
  display: block;
}
.book-body h3 {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-primary);
}
.book-body p {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  line-height: 1.5;
}
.book-label {
  font-size: 12px;
  color: var(--accent);
  letter-spacing: 0.5px;
}

/* Grammar page — full layout with TOC sidebar */
.grammar-page {
  margin-bottom: 40px;
}
.grammar-header {
  margin-bottom: 24px;
}
.grammar-back {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  margin-bottom: 16px;
  transition: color 0.18s var(--ease-ink);
  display: block;
}
.grammar-back:hover {
  color: var(--accent);
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.title-row h1 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--text-primary);
  margin: 0;
}
.meta-chip {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--accent);
  border: 1px solid var(--accent);
  padding: 2px 8px;
  letter-spacing: 0.5px;
}
.grammar-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.mobile-lesson-switcher {
  display: none;
  margin-bottom: 16px;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-secondary);
}
.mobile-lesson-switcher select {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
}

.grammar-body {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 32px;
  align-items: start;
}
.grammar-side {
  position: sticky;
  top: 60px;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  align-self: start;
}
.grammar-content {
  min-width: 0;
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 28px 32px;
}
.grammar-footer-actions {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

/* Exit section */
.hidden-exit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 24px;
  padding-bottom: 24px;
}
.exit-rule {
  flex: 1;
  max-width: 120px;
  height: 1px;
  background: var(--border);
}
.exit-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-family: var(--font-display);
  font-size: 14px;
  letter-spacing: 4px;
  padding: 8px 24px;
  cursor: pointer;
  transition:
    color 0.2s var(--ease-ink),
    border-color 0.2s var(--ease-ink),
    background 0.2s var(--ease-ink);
}
.exit-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

/* Mobile */
@media (max-width: 639px) {
  .bookshelf {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  .book-card {
    padding: 20px 12px 16px;
  }
  .book-accent {
    font-size: 26px;
    margin-bottom: 10px;
  }
  .book-body h3 {
    font-size: 14px;
  }
  .book-body p {
    font-size: 11px;
  }
  .catalog-title {
    font-size: 24px;
  }
  .grammar-body {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .grammar-content {
    padding: 18px 16px;
  }
  .mobile-lesson-switcher {
    display: flex;
  }
}

@media (min-width: 640px) and (max-width: 768px) {
  .bookshelf {
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
  .grammar-body {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .grammar-content {
    padding: 22px 20px;
  }
  .mobile-lesson-switcher {
    display: flex;
  }
}
</style>
