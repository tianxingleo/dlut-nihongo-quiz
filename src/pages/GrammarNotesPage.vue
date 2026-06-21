<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { marked } from 'marked'
import rawNotes from '../content/grammar-notes.md?raw'
import GrammarToc from '../components/GrammarToc.vue'

// 配置 marked：启用 GFM 表格、切断链；不要 mangle（marked v5+ 默认关闭）
marked.setOptions({
  gfm: true,
  breaks: false,
})

interface TocItem {
  id: string
  text: string
  level: 2 | 3
}

const html = ref<string>('')
const toc = ref<TocItem[]>([])
const activeId = ref<string>('')
const mobileLesson = ref<string>('')
const mobileLessons = ref<TocItem[]>([])

function slugify(text: string): string {
  // 课次/语法点标题里包含日文、中文、数字、符号，保留可读 slug
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s.·、，,:：()（）「」]/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildToc(markdown: string): TocItem[] {
  const items: TocItem[] = []
  const lines = markdown.split('\n')
  const seen = new Set<string>()
  for (const line of lines) {
    // 跳过代码块里的标题、引用块里的标题
    if (line.startsWith('>')) continue
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const level = m[1].length as 2 | 3
    const text = m[2].replace(/#+$/, '').trim()
    let id = slugify(text)
    // 防重
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
  // 给 h2/h3 注 id，方便目录跳转
  return raw.replace(/<(h[23])>([^<]+)<\/\1>/g, (_full, tag, text) => {
    const id = slugify(text)
    return `<${tag} id="${id}">${text}</${tag}>`
  })
}

let observer: IntersectionObserver | null = null

function setupObserver() {
  if (observer) observer.disconnect()
  const headings = document.querySelectorAll<HTMLElement>(
    '.grammar-content h2[id], .grammar-content h3[id]',
  )
  if (headings.length === 0) return
  // rootMargin 让标题进入"视口上 1/3"时即视为激活
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
    {
      rootMargin: '-80px 0px -65% 0px',
      threshold: 0,
    },
  )
  headings.forEach((h) => observer!.observe(h))
}

function navigateTo(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  // sticky nav 高 44px，再留 16px 余白
  const top = el.getBoundingClientRect().top + window.scrollY - 60
  window.scrollTo({ top, behavior: 'smooth' })
  activeId.value = id
}

function selectMobileLesson(id: string) {
  mobileLesson.value = id
  nextTick(() => navigateTo(id))
}

function onScroll() {
  // 滚动时，IntersectionObserver 已更新 activeId，这里只兜底：
  // 滚到顶部时激活第一个
  if (window.scrollY < 60 && toc.value.length > 0) {
    activeId.value = toc.value[0].id
  }
}

onMounted(() => {
  html.value = renderMarkdown(rawNotes)
  toc.value = buildToc(rawNotes)
  mobileLessons.value = toc.value.filter((t) => t.level === 2)
  if (toc.value.length > 0) {
    activeId.value = toc.value[0].id
    mobileLesson.value = toc.value[0].id
  }
  nextTick(() => {
    setupObserver()
    window.addEventListener('scroll', onScroll, { passive: true })
  })
})

onBeforeUnmount(() => {
  if (observer) observer.disconnect()
  window.removeEventListener('scroll', onScroll)
})

const subtitle = computed(() => {
  const lessons = mobileLessons.value.length
  const total = toc.value.length
  return `${lessons} 课 · 共 ${total} 个语法点 · 滚动阅读，点击目录跳转`
})
</script>
<template>
  <div class="grammar-page">
    <header class="grammar-header">
      <div class="title-row">
        <h1>核心语法整理</h1>
        <span class="meta-chip">第 26–36 课 + 查漏补缺</span>
      </div>
      <p class="subtitle">{{ subtitle }}</p>
    </header>

    <!-- 移动端课次切换 -->
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
      <article class="grammar-content markdown-body" v-html="html" />
    </div>

    <div class="grammar-footer-actions">
      <button class="btn btn-outline" @click="navigateTo(toc[0]?.id || '')">回到顶部</button>
    </div>
  </div>
</template>
<style scoped>
.grammar-page {
  max-width: 1100px;
  margin: 0 auto;
}
.grammar-header {
  margin-bottom: 24px;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
h1 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
}
.meta-chip {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--accent);
  border: 1px solid var(--accent);
  padding: 2px 8px;
  letter-spacing: 0.5px;
}
.subtitle {
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

@media (max-width: 959px) {
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
</style>
