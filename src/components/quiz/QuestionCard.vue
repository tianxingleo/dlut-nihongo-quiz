<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Question } from '../../types/question'
import { UI } from '../../constants'
import { toggleMultiSelect, isMultiAnswerCorrect } from '../../utils/multiAnswer'
import { renderExplanation } from '../../utils/renderExplanation'
import { renderMarkdown } from '../../utils/renderMarkdown'
import { useAI } from '../../composables/useAI'
import TagBadge from '../ui/TagBadge.vue'
import AIExplanation from '../ai/AIExplanation.vue'
import AIChat from '../ai/AIChat.vue'
import type { AIExplanationRequest } from '../../types/ai'

const props = defineProps<{
  question: Question
  selectedKey: string
  submitted: boolean
  mode: string
  questionIndex: number
  totalQuestions: number
  bookmarked: boolean
  showExplanation?: boolean
  category?: string
}>()

const emit = defineEmits<{
  select: [key: string]
  submit: []
  next: []
  prev: []
  bookmark: []
  'swipe-prev': []
  'swipe-next': []
  'update:showExplanation': [value: boolean]
}>()

const { aiEnabled } = useAI()
const showAIExplanation = ref(false)
const showAIChat = ref(false)
const aiExplanationRequest = ref<AIExplanationRequest | null>(null)

const showExplanation = ref(props.showExplanation ?? false)
const shareStatus = ref<'' | 'copied' | 'unsupported'>('')

// 同步父组件的 showExplanation prop 变化
watch(
  () => props.showExplanation,
  (val) => {
    if (val !== undefined) showExplanation.value = val
  },
)

const dragOffset = ref(0)
const dragActive = ref(false)
let dragStartX = 0
let dragStartY = 0
let dragPointer: number | null = null
let dragHorizontal: boolean | null = null

// 缓存 isMobile 结果，避免在每次 pointer event 中重复查询
const isMobile =
  typeof window !== 'undefined' ? window.matchMedia('(max-width: 480px)').matches : false

/** 检查鼠标点击位置是否在可选择文字的元素上（题干、选项文本、解析等） */
function isOnSelectableText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const el = target.closest(
    '.q-stem, .q-stem *, .opt-text, .opt-text *, .q-explanation, .q-explanation *, p, span, li',
  )
  if (!el) return false
  const cs = window.getComputedStyle(el)
  return cs.userSelect !== 'none'
}

function onPointerDown(e: PointerEvent) {
  if (props.submitted) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  // 鼠标点击可选择文字区域时，跳过拖拽手势，让浏览器处理文字选择
  if (e.pointerType === 'mouse' && isOnSelectableText(e.target)) return
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragPointer = e.pointerId
  dragHorizontal = null
  dragOffset.value = 0
  dragActive.value = false
}

function onPointerMove(e: PointerEvent) {
  if (dragPointer !== e.pointerId) return
  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY
  if (dragHorizontal === null) {
    if (Math.abs(dx) < UI.DRAG_LOCK && Math.abs(dy) < UI.DRAG_LOCK) return
    dragHorizontal = Math.abs(dx) > Math.abs(dy)
    if (dragHorizontal) {
      dragActive.value = true
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } else {
      dragPointer = null
      return
    }
  }
  if (!dragHorizontal) return
  dragOffset.value = dx
}

function onPointerUp(e: PointerEvent) {
  if (dragPointer !== e.pointerId) return
  const wasActive = dragActive.value
  const offset = dragOffset.value
  dragPointer = null
  dragActive.value = false
  dragOffset.value = 0
  if (!wasActive) return
  const threshold = isMobile ? UI.SWIPE_THRESHOLD_MOBILE : UI.SWIPE_THRESHOLD
  if (Math.abs(offset) < threshold) return
  if (offset > 0) emit('swipe-prev')
  else emit('swipe-next')
}

async function handleShare() {
  const url = `${location.origin}${location.pathname}#/quiz?ids=${props.question.id}`
  try {
    if (navigator.share) {
      await navigator.share({ title: '题库 · 单题', text: props.question.stem.slice(0, 80), url })
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
      shareStatus.value = 'copied'
      setTimeout(() => {
        shareStatus.value = ''
      }, 1500)
    } else {
      shareStatus.value = 'unsupported'
      setTimeout(() => {
        shareStatus.value = ''
      }, 2000)
    }
  } catch {
    // 用户取消 share 不算错误
  }
}

function handleSelect(key: string) {
  if (props.submitted) return
  if (props.question.multiAnswer) {
    emit('select', toggleMultiSelect(props.selectedKey, key))
  } else {
    emit('select', key)
  }
}

function selectAll() {
  if (props.submitted) return
  const allKeys = props.question.options.map((o) => o.key).join('')
  emit('select', allKeys)
}

function clearSelection() {
  if (props.submitted) return
  emit('select', '')
}

function toggleExplanation() {
  showExplanation.value = !showExplanation.value
  emit('update:showExplanation', showExplanation.value)
}

function openAIExplanation() {
  const q = props.question
  aiExplanationRequest.value = {
    questionId: q.id,
    stem: q.stem,
    options: q.options,
    answerKey: q.answerKey,
    answerText: q.answerText,
    explanation: q.explanation,
    category: props.category || 'japanese2',
    userSelectedKey: props.selectedKey || undefined,
    isCorrect: props.selectedKey
      ? q.multiAnswer
        ? isMultiAnswerCorrect(props.selectedKey, q.answerKey)
        : props.selectedKey === q.answerKey
      : undefined,
  }
  showAIExplanation.value = true
}

function openAIChat() {
  showAIChat.value = true
}

const optionLabels = ['A', 'B', 'C', 'D', 'E']

function isSelected(key: string) {
  return props.selectedKey.includes(key)
}
function isCorrectOption(key: string) {
  if (props.question.multiAnswer) {
    return (
      props.submitted && props.question.answerKey.includes(key) && props.selectedKey.includes(key)
    )
  }
  return props.submitted && key === props.question.answerKey
}
function isWrongOption(key: string) {
  if (props.question.multiAnswer) {
    return (
      props.submitted && props.selectedKey.includes(key) && !props.question.answerKey.includes(key)
    )
  }
  return props.submitted && props.selectedKey === key && key !== props.question.answerKey
}
function isMissedOption(key: string) {
  if (!props.question.multiAnswer) return false
  return (
    props.submitted && props.question.answerKey.includes(key) && !props.selectedKey.includes(key)
  )
}

const canSubmit = computed(() => props.selectedKey.length > 0)
const renderedStem = computed(() => renderMarkdown(props.question.stem))

const isCorrectOverall = computed(() => {
  if (props.question.multiAnswer) {
    return isMultiAnswerCorrect(props.selectedKey, props.question.answerKey)
  }
  return props.selectedKey === props.question.answerKey
})

const subTypeLabel = computed(() => {
  if (props.question.questionType === 'multi') return '多选'
  if (props.question.questionType === 'judgement') return '判断'
  if (props.question.questionType === 'single') return '单选'
  if (props.question.subType === 'kana-to-kanji') return '选汉字'
  if (props.question.subType === 'kanji-to-kana') return '选假名'
  return ''
})

const tagsSectionTitle = computed(() =>
  props.question.subType === 'kana-to-kanji' || props.question.subType === 'kanji-to-kana'
    ? '标签'
    : '考点',
)

const cardStyle = computed(() => ({
  transform: dragOffset.value ? `translateX(${dragOffset.value}px)` : '',
}))
const dragOpacity = computed(() => {
  if (!dragActive.value) return 1
  return Math.max(0.45, 1 - Math.abs(dragOffset.value) / 320)
})
</script>
<template>
  <div
    class="question-card"
    :class="{ dragging: dragActive }"
    :style="[{ opacity: dragOpacity }, cardStyle]"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div class="q-header">
      <span class="q-id">{{ question.id }}</span>
      <span class="q-group">{{ question.groupTitle }}</span>
      <span class="q-sub" v-if="subTypeLabel">{{ subTypeLabel }}</span>
      <span class="q-mode">{{ mode }}</span>
    </div>

    <div class="q-stem" v-html="renderedStem" />
    <div class="q-hint" v-if="question.multiAnswer">
      多选，请勾选所有正确选项
      <span class="q-hint-actions" v-if="!submitted">
        <button class="hint-btn" @click="selectAll">全选</button>
        <button class="hint-btn" @click="clearSelection">清除</button>
      </span>
    </div>

    <div
      class="q-options"
      :role="question.multiAnswer ? 'group' : 'radiogroup'"
      :aria-label="question.multiAnswer ? '多选选项（可多选）' : '单选选项'"
    >
      <button
        v-for="(opt, i) in question.options"
        :key="opt.key"
        :role="question.multiAnswer ? 'checkbox' : 'radio'"
        :aria-checked="isSelected(opt.key)"
        :class="[
          'opt-btn',
          {
            selected: isSelected(opt.key),
            correct: isCorrectOption(opt.key),
            wrong: isWrongOption(opt.key),
            missed: isMissedOption(opt.key),
            multi: !!question.multiAnswer,
          },
        ]"
        @click="handleSelect(opt.key)"
        :disabled="submitted"
      >
        <span class="opt-key">{{ optionLabels[i] }}</span>
        <span class="opt-text">{{ opt.text }}</span>
        <span v-if="isCorrectOption(opt.key)" class="opt-icon c" aria-hidden="true">&#10003;</span>
        <span v-if="isWrongOption(opt.key)" class="opt-icon w" aria-hidden="true">&#10007;</span>
        <span v-if="isMissedOption(opt.key)" class="opt-icon m" aria-hidden="true">&middot;</span>
      </button>
    </div>

    <div class="q-actions" v-if="!submitted">
      <button v-if="questionIndex > 0" class="btn btn-ghost" @click="emit('prev')">上一题</button>
      <button class="btn btn-submit" :disabled="!canSubmit" @click="emit('submit')">
        提交答案
      </button>
    </div>
    <div class="q-actions" v-else>
      <button v-if="questionIndex > 0" class="btn btn-ghost" @click="emit('prev')">
        上一题（可修改）
      </button>
      <button class="btn btn-submit" @click="emit('next')">
        {{ questionIndex >= totalQuestions - 1 ? '完成' : '下一题' }}
      </button>
      <button
        class="btn btn-ghost"
        :class="{ 'bookmark-active': bookmarked }"
        @click="emit('bookmark')"
      >
        {{ bookmarked ? '已收藏' : '收藏' }}
      </button>
      <button
        class="btn btn-ghost"
        :aria-expanded="showExplanation"
        aria-controls="explanation-panel"
        @click="toggleExplanation"
      >
        {{ showExplanation ? '收起解析' : '查看解析' }}
      </button>
      <button class="btn btn-ghost" :title="`分享本题（复制链接）`" @click="handleShare">
        {{
          shareStatus === 'copied' ? '已复制' : shareStatus === 'unsupported' ? '不支持' : '分享'
        }}
      </button>
      <button
        v-if="aiEnabled"
        class="btn btn-ghost ai-btn"
        @click="openAIExplanation"
        title="AI 详细解析"
      >
        AI 解析
      </button>
      <button v-if="aiEnabled" class="btn btn-ghost ai-btn" @click="openAIChat" title="AI 问答">
        AI 问答
      </button>
    </div>

    <div class="q-result" v-if="submitted">
      <div class="result-line" :class="isCorrectOverall ? 'correct' : 'wrong'">
        <span class="result-badge">{{ isCorrectOverall ? '正确' : '错误' }}</span>
        答案：<strong
          >{{ question.answerKey
          }}<span v-if="question.answerText">. {{ question.answerText }}</span></strong
        >
      </div>
    </div>

    <div
      id="explanation-panel"
      class="q-explanation"
      v-if="submitted && showExplanation"
      tabindex="0"
    >
      <div class="exp-section" v-if="question.headword">
        <h4>词条</h4>
        <p>{{ question.headword }}</p>
      </div>
      <div class="exp-section" v-if="question.translation">
        <h4>中文翻译</h4>
        <p>{{ question.translation }}</p>
      </div>
      <div class="exp-section" v-if="question.tags.length > 0">
        <h4>{{ tagsSectionTitle }}</h4>
        <div class="tag-list">
          <TagBadge v-for="t in question.tags" :key="t" :tag="t" />
        </div>
      </div>
      <div class="exp-section">
        <h4>解析</h4>
        <div class="exp-text" v-html="renderExplanation(question.explanation)" />
      </div>
    </div>

    <div class="swipe-hint" aria-hidden="true">
      <span class="swipe-arrow prev">‹</span>
      <span class="swipe-label">左右滑动 / 拖拽题号 切换题目</span>
      <span class="swipe-arrow next">›</span>
    </div>

    <!-- AI 解析弹窗 -->
    <AIExplanation
      :request="aiExplanationRequest"
      :visible="showAIExplanation"
      @close="showAIExplanation = false"
    />

    <!-- AI 问答弹窗 -->
    <AIChat
      :visible="showAIChat"
      :context="{ questionId: question.id, category: category }"
      @close="showAIChat = false"
    />
  </div>
</template>
<style scoped>
.question-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 28px;
  max-width: 720px;
  margin: 0 auto;
  touch-action: pan-y;
}
.question-card.dragging {
  transition: none;
  cursor: grabbing;
  touch-action: none;
}
.question-card.dragging :where(.opt-btn, .btn, button) {
  pointer-events: none;
}

/* Header */
.q-header {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  font-size: 13px;
  align-items: center;
}
.q-id {
  color: var(--accent);
  font-weight: 600;
  font-family: var(--font-mono);
}
.q-group {
  color: var(--text-secondary);
}
.q-sub {
  padding: 1px 8px;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 11px;
}
.q-mode {
  color: var(--text-muted);
  margin-left: auto;
}

/* Stem */
.q-stem {
  font-size: 18px;
  line-height: 1.7;
  color: var(--text-primary);
  margin-bottom: 14px;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: break-word;
}
.q-stem :deep(strong) {
  font-weight: 700;
  color: var(--text-primary);
}
.q-stem :deep(p) {
  margin: 0;
}
.q-stem :deep(p + p) {
  margin-top: 0.4em;
}
.q-hint {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.q-hint-actions {
  display: flex;
  gap: 4px;
}
.hint-btn {
  padding: 2px 8px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition:
    border-color 0.18s var(--ease-ink),
    color 0.18s var(--ease-ink);
}
.hint-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* Options */
.q-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.opt-btn {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  cursor: pointer;
  transition:
    border-color 0.18s var(--ease-ink),
    border-left-color 0.18s var(--ease-ink),
    background 0.18s var(--ease-ink),
    color 0.18s var(--ease-ink),
    transform 0.18s var(--ease-ink);
  text-align: left;
  font-size: 15px;
  color: var(--text-primary);
  border-left: 3px solid transparent;
}
.opt-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--accent);
}
.opt-btn:active:not(:disabled) {
  transform: scale(0.985);
}
.opt-btn.selected {
  border-left-color: var(--accent);
  background: var(--bg-hover);
}
.opt-btn.correct {
  border-left-color: var(--correct);
  background: color-mix(in srgb, var(--correct) 10%, transparent);
}
.opt-btn.wrong {
  border-left-color: var(--wrong);
  background: color-mix(in srgb, var(--wrong) 8%, transparent);
}
.opt-btn.missed {
  border-left-color: var(--warning);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  border-left-style: dashed;
}
.opt-key {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 12px;
  flex-shrink: 0;
  color: var(--text-muted);
  border: 1px solid var(--border);
  font-family: var(--font-mono);
  transition:
    border-color 0.18s var(--ease-ink),
    color 0.18s var(--ease-ink),
    background 0.18s var(--ease-ink);
}
.opt-btn.selected .opt-key {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.opt-btn.multi .opt-key {
  border-radius: 0;
}
.opt-text {
  flex: 1;
  overflow-wrap: break-word;
  word-break: break-word;
  min-width: 0;
}
.opt-icon {
  font-weight: 700;
  font-size: 15px;
  min-width: 20px;
  text-align: center;
}
.opt-icon.c {
  color: var(--correct);
}
.opt-icon.w {
  color: var(--wrong);
}
.opt-icon.m {
  color: var(--warning);
  font-size: 20px;
}

/* Actions */
.q-actions {
  display: flex;
  gap: 8px;
  margin-top: 22px;
  flex-wrap: wrap;
}
.btn-submit {
  padding: 9px 22px;
  border: 1px solid var(--border);
  font-size: 14px;
  transition:
    background 0.18s var(--ease-ink),
    border-color 0.18s var(--ease-ink),
    transform 0.18s var(--ease-ink),
    opacity 0.18s var(--ease-ink);
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn-submit:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.btn-submit:hover:not(:disabled) {
  background: var(--accent-hover);
}
.btn-submit:active:not(:disabled) {
  transform: scale(0.97);
}
.bookmark-active {
  color: var(--warning);
  border-color: var(--warning);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  transition:
    color 0.18s var(--ease-ink),
    border-color 0.18s var(--ease-ink),
    background 0.18s var(--ease-ink);
}

/* Result */
.q-result {
  margin-top: 18px;
  animation: fade-up 0.3s var(--ease-brush) both;
  animation-delay: 0.05s;
}
.result-line {
  font-size: 15px;
  padding: 10px 14px;
  border-left: 3px solid;
}
.result-line.correct {
  border-left-color: var(--correct);
  background: color-mix(in srgb, var(--correct) 10%, transparent);
  color: var(--correct);
}
.result-line.wrong {
  border-left-color: var(--wrong);
  background: color-mix(in srgb, var(--wrong) 8%, transparent);
  color: var(--wrong);
}
.result-badge {
  font-weight: 600;
  margin-right: 4px;
}

/* Explanation */
.q-explanation {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  animation: ink-reveal 0.35s var(--ease-page) both;
  transform-origin: top center;
}
.exp-section {
  margin-bottom: 14px;
}
.exp-section h4 {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  font-weight: 600;
}
.exp-text {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.75;
  max-height: 420px;
  overflow-y: auto;
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
}

@media (max-width: 480px) {
  .question-card {
    padding: 18px 14px;
  }
  .q-header {
    flex-wrap: wrap;
    gap: 6px 10px;
    font-size: 12px;
  }
  .q-stem {
    font-size: 16px;
  }
  .opt-btn {
    padding: 10px 12px;
    gap: 10px;
    font-size: 14px;
  }
  .q-actions {
    gap: 6px;
  }
  .q-actions .btn,
  .btn-submit {
    padding: 8px 14px;
    font-size: 13px;
  }
  .result-line {
    font-size: 14px;
  }
}

.swipe-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 18px;
  padding-top: 12px;
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  user-select: none;
}
.swipe-arrow {
  font-size: 14px;
  line-height: 1;
  opacity: 0.6;
  font-family: var(--font-mono);
}
.swipe-label {
  opacity: 0.7;
}

@media (max-width: 480px) {
  .swipe-hint {
    margin-top: 14px;
  }
}

/* 在精确指针设备（鼠标）上隐藏滑动提示 */
@media (pointer: fine) {
  .swipe-hint {
    display: none;
  }
}

/* AI 按钮样式 */
.ai-btn {
  color: var(--accent);
  border-color: var(--accent);
  position: relative;
}

.ai-btn::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 12px;
  background: var(--accent);
  opacity: 0.5;
}

.ai-btn:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
</style>
