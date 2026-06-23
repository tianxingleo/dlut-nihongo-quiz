<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { Marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import GrammarToc from './GrammarToc.vue'
import { sanitizeHtml } from '../../utils/renderMarkdown'
import { useTextSelection } from '../../composables/useTextSelection'
import { useAI } from '../../composables/useAI'
import { useFurigana } from '../../composables/useFurigana'
import TextSelectionToolbar from '../ai/TextSelectionToolbar.vue'
import NotesAIChat from '../ai/NotesAIChat.vue'
import type { TextSelection } from '../../composables/useTextSelection'

const props = withDefaults(
  defineProps<{
    title: string
    source: string
    chip?: string
    subtitle?: string
    enableKatex?: boolean
    footerNote?: string
  }>(),
  {
    chip: '',
    subtitle: '',
    enableKatex: false,
    footerNote: '',
  },
)

const markdownRenderer = new Marked({
  gfm: true,
  breaks: false,
})

if (props.enableKatex) {
  markdownRenderer.use(markedKatex({ throwOnError: false, nonStandard: true }))
}

if (props.enableKatex) {
  import('katex/dist/katex.min.css')
}

interface TocItem {
  id: string
  text: string
  level: 2 | 3
}

const html = ref<string>('')
const rawHtml = ref<string>('') // 未添加注音的原始 HTML
const toc = ref<TocItem[]>([])
const activeId = ref<string>('')
const mobileLesson = ref<string>('')
const mobileLessons = ref<TocItem[]>([])

// AI 相关状态
const { aiEnabled } = useAI()
const notesContentRef = ref<HTMLElement | null>(null)
const { selection, isVisible: isToolbarVisible } = useTextSelection(notesContentRef)

// 假名注音相关状态
const {
  furiganaEnabled,
  isLoading: isFuriganaLoading,
  toggle: toggleFurigana,
  processHtml,
} = useFurigana()

// 笔记 AI 聊天状态
const showNotesAI = ref(false)
const aiMode = ref<'explain' | 'ask'>('ask')
const currentSelection = ref<TextSelection | null>(null)

/** 处理 AI 解释请求 */
function handleExplain(sel: TextSelection) {
  currentSelection.value = { ...sel }
  aiMode.value = 'explain'
  showNotesAI.value = true
}

/** 处理 AI 问答请求 */
function handleAskAI(sel: TextSelection) {
  currentSelection.value = { ...sel }
  aiMode.value = 'ask'
  showNotesAI.value = true
}

/** 关闭笔记 AI 聊天 */
function closeNotesAI() {
  showNotesAI.value = false
  currentSelection.value = null
}

function slugify(text: string): string {
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
    if (line.startsWith('>')) continue
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const level = m[1].length as 2 | 3
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
  const raw = markdownRenderer.parse(markdown, { async: false }) as string
  const withHeadingIds = raw.replace(/<(h[23])>([^<]+)<\/\1>/g, (_full, tag, text) => {
    const id = slugify(text)
    return `<${tag} id="${id}">${text}</${tag}>`
  })
  return sanitizeHtml(withHeadingIds)
}

let observer: IntersectionObserver | null = null

function setupObserver() {
  if (observer) observer.disconnect()
  const headings = document.querySelectorAll<HTMLElement>(
    '.notes-content h2[id], .notes-content h3[id]',
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
  const top = el.getBoundingClientRect().top + window.scrollY - 60
  window.scrollTo({ top, behavior: 'smooth' })
  activeId.value = id
}

function selectMobileLesson(id: string) {
  mobileLesson.value = id
  nextTick(() => navigateTo(id))
}

function onScroll() {
  if (window.scrollY < 60 && toc.value.length > 0) {
    activeId.value = toc.value[0].id
  }
}

onMounted(async () => {
  rawHtml.value = renderMarkdown(props.source)
  // 如果假名注音已启用，立即应用
  if (furiganaEnabled.value) {
    html.value = await processHtml(rawHtml.value)
  } else {
    html.value = rawHtml.value
  }
  toc.value = buildToc(props.source)
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

// 监听注音开关变化，动态添加/移除注音
watch(furiganaEnabled, async (enabled) => {
  if (enabled) {
    html.value = await processHtml(rawHtml.value)
  } else {
    html.value = rawHtml.value
  }
  nextTick(() => setupObserver())
})

onBeforeUnmount(() => {
  if (observer) observer.disconnect()
  window.removeEventListener('scroll', onScroll)
})

const computedSubtitle = computed(() => {
  if (props.subtitle) return props.subtitle
  const lessons = mobileLessons.value.length
  const total = toc.value.length
  return `${lessons} 章 · 共 ${total} 个小节 · 滚动阅读，点击目录跳转`
})
</script>
<template>
  <div class="notes-page">
    <header class="notes-header">
      <div class="title-row">
        <h1>{{ title }}</h1>
        <span v-if="chip" class="meta-chip">{{ chip }}</span>
        <button
          class="furigana-toggle"
          :class="{ active: furiganaEnabled, loading: isFuriganaLoading }"
          :disabled="isFuriganaLoading"
          :title="furiganaEnabled ? '关闭假名注音' : '开启假名注音'"
          @click="toggleFurigana"
        >
          <span v-if="isFuriganaLoading" class="loading-spinner" />
          <span v-else>{{ furiganaEnabled ? '假名 ✓' : '假名' }}</span>
        </button>
      </div>
      <p class="subtitle">{{ computedSubtitle }}</p>
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

    <div class="notes-body">
      <aside class="notes-side">
        <GrammarToc :items="toc" :active-id="activeId" @navigate="navigateTo" />
      </aside>
      <div class="notes-content-wrapper">
        <article ref="notesContentRef" class="notes-content markdown-body" v-html="html" />

        <!-- 文字选中浮动工具栏（仅在 AI 已配置时显示） -->
        <TextSelectionToolbar
          v-if="aiEnabled"
          :selection="selection"
          :visible="isToolbarVisible"
          @ask-ai="handleAskAI"
          @explain="handleExplain"
          @close="isToolbarVisible = false"
        />
      </div>
    </div>

    <!-- 笔记 AI 聊天组件（仅在 AI 已配置时显示） -->
    <NotesAIChat
      v-if="aiEnabled"
      :visible="showNotesAI"
      :note-title="title"
      :selection="currentSelection"
      :mode="aiMode"
      @close="closeNotesAI"
    />

    <div class="notes-footer-actions">
      <button class="btn btn-outline" @click="navigateTo(toc[0]?.id || '')">回到顶部</button>
      <p v-if="footerNote" class="footer-note">{{ footerNote }}</p>
    </div>
  </div>
</template>
<style scoped>
.notes-page {
  max-width: 1100px;
  margin: 0 auto;
}
.notes-header {
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

.furigana-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-family: var(--font-body);
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-left: auto;
}
.furigana-toggle:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--bg-hover);
}
.furigana-toggle.active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--bg-hover);
}
.furigana-toggle:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.loading-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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

.notes-body {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 32px;
  align-items: start;
}
.notes-side {
  position: sticky;
  top: 60px;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  align-self: start;
}
.notes-content-wrapper {
  position: relative;
  min-width: 0;
}
.notes-content {
  min-width: 0;
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 28px 32px;
}

.notes-footer-actions {
  margin-top: 24px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.footer-note {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}

@media (max-width: 959px) {
  .notes-body {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .notes-content {
    padding: 18px 16px;
  }
  .mobile-lesson-switcher {
    display: flex;
  }
}
</style>
