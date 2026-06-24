/** * 笔记 AI 聊天组件 - 专门用于笔记页面的AI问答 * 支持选中文字作为上下文，提供更精准的解答 */
<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { useAI } from '../../composables/useAI'
import { renderMarkdown } from '../../utils/renderMarkdown'
import type { TextSelection } from '../../composables/useTextSelection'

const props = defineProps<{
  visible: boolean
  /** 笔记标题 */
  noteTitle?: string
  /** 选中的文字上下文 */
  selection?: TextSelection | null
  /** 初始提问模式：explain=解释选中文字, ask=自由问答 */
  mode?: 'explain' | 'ask'
}>()

const emit = defineEmits<{
  close: []
}>()

const {
  aiEnabled,
  isLoading,
  currentResponse,
  error,
  conversationHistory,
  chat,
  clearHistory,
  clearError,
} = useAI()

const userInput = ref('')
const responseContainer = ref<HTMLDivElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const isNearBottom = ref(true)
const hasAutoAsked = ref(false)
/** 内部保存的选中内容，避免被外部清除影响 */
const savedSelection = ref<TextSelection | null>(null)
/** 本地错误提示（用于 AI 未配置等情况） */
const localError = ref<string | null>(null)

/** 判断滚动容器是否在底部附近 */
function checkNearBottom() {
  const el = responseContainer.value
  if (!el) return
  isNearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

/** 构建笔记上下文信息 */
function buildNoteContext(): string {
  const parts: string[] = []
  const sel = savedSelection.value

  if (props.noteTitle) {
    parts.push(`笔记标题：${props.noteTitle}`)
  }

  if (sel) {
    // 优先使用章节标题，帮助 AI 理解上下文
    if (sel.sectionTitle) {
      parts.push(`所在章节：${sel.sectionTitle}`)
    }

    parts.push(`用户选中的文字：「${sel.text}」`)

    if (sel.contextBefore) {
      parts.push(`选中文字前面的内容：${sel.contextBefore}`)
    }

    if (sel.contextAfter) {
      parts.push(`选中文字后面的内容：${sel.contextAfter}`)
    }
  }

  return parts.join('\n')
}

/** 构建初始提问 */
function buildInitialQuestion(): string {
  const sel = savedSelection.value
  if (!sel) return ''

  const context = buildNoteContext()

  if (props.mode === 'explain') {
    return `请解释以下内容的含义和用法：

${context}

请提供：
1. 详细的解释和说明
2. 相关的知识点或背景
3. 如果是外文，请提供翻译和语法分析
4. 如果是公式或定理，请提供推导或证明思路
5. 相关的例子或应用场景`
  }

  return `我在阅读笔记时遇到了以下内容，请帮我理解：

${context}

请详细解释这部分内容。`
}

/** 合并历史消息和当前响应 */
const displayMessages = computed(() => {
  const messages: Array<{
    role: 'user' | 'assistant'
    content: string
    isStreaming?: boolean
    isContext?: boolean
  }> = []

  // 如果有选中文字，显示上下文提示
  if (savedSelection.value && conversationHistory.value.length > 0) {
    messages.push({
      role: 'user',
      content: `📌 选中内容：「${savedSelection.value.text}」`,
      isContext: true,
    })
  }

  // 添加历史消息
  messages.push(
    ...conversationHistory.value.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  )

  // 如果正在生成响应，添加当前流式内容
  if (isLoading.value && currentResponse.value) {
    messages.push({
      role: 'assistant',
      content: currentResponse.value,
      isStreaming: true,
    })
  }

  return messages
})

// 流式传输时自动滚动
watch(
  displayMessages,
  async () => {
    await nextTick()
    if (responseContainer.value && isNearBottom.value) {
      responseContainer.value.scrollTop = responseContainer.value.scrollHeight
    }
  },
  { deep: true },
)

// 打开时自动提问
watch(
  () => props.visible,
  async (val) => {
    if (val) {
      // 保存选中内容，避免被外部清除
      savedSelection.value = props.selection || null

      // 只有 AI 已配置且是解释模式时才自动提问
      if (
        aiEnabled.value &&
        savedSelection.value &&
        props.mode === 'explain' &&
        !hasAutoAsked.value
      ) {
        hasAutoAsked.value = true
        await nextTick()
        const question = buildInitialQuestion()
        if (question) {
          try {
            await chat(question, { category: 'notes' })
          } catch {
            // 错误已在 composable 中处理
          }
        }
      }

      await nextTick()
      inputRef.value?.focus()
    }
  },
)

// 重置 autoAsk 状态
watch(
  () => props.selection,
  () => {
    hasAutoAsked.value = false
  },
)

function handleClose() {
  emit('close')
}

function dismissError() {
  localError.value = null
  clearError()
}

async function handleSend() {
  const message = userInput.value.trim()
  if (!message || isLoading.value) return

  // 检查 AI 是否配置
  if (!aiEnabled.value) {
    localError.value =
      '⚠️ AI 功能未配置。请先在设置页面配置 AI API，然后启用 AI 功能后即可使用笔记 AI 助手。'
    userInput.value = ''
    return
  }

  userInput.value = ''
  localError.value = null
  clearError()
  isNearBottom.value = true

  // 构建包含笔记上下文的完整消息
  let fullMessage = message
  const noteContext = buildNoteContext()
  if (noteContext && conversationHistory.value.length === 0) {
    fullMessage = `笔记上下文：\n${noteContext}\n\n用户问题：${message}`
  }

  try {
    await chat(fullMessage, { category: 'notes' })
  } catch {
    // 错误已在 composable 中处理
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function handleClear() {
  clearHistory()
  hasAutoAsked.value = false
}

/** 格式化消息文本 */
function formatMessage(text: string): string {
  return renderMarkdown(text)
}

/** 快捷提问 */
function quickAsk(question: string) {
  userInput.value = question
  handleSend()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="ai-overlay" @mousedown.self="handleClose">
        <div class="ai-chat-modal notes-ai-modal">
          <div class="ai-header">
            <div class="header-title">
              <span class="ai-icon">✦</span>
              <h3>笔记 AI 助手</h3>
            </div>
            <div class="header-actions">
              <button class="clear-btn" @click="handleClear" title="清空对话">清空</button>
              <button class="close-btn" @click="handleClose">&times;</button>
            </div>
          </div>

          <!-- 选中文字预览 -->
          <div v-if="savedSelection" class="selection-preview">
            <div class="preview-label">选中内容</div>
            <div class="preview-text">{{ savedSelection.text }}</div>
          </div>

          <div class="ai-messages" ref="responseContainer" @scroll="checkNearBottom">
            <!-- 欢迎消息 -->
            <div v-if="displayMessages.length === 0" class="welcome-message">
              <div class="welcome-icon">✦</div>
              <p>我是笔记 AI 助手，可以帮你理解笔记中的内容。</p>
              <p class="hint">
                {{
                  savedSelection ? '正在为你解释选中的内容...' : '你可以问我任何关于笔记的问题。'
                }}
              </p>

              <!-- 快捷提问 -->
              <div v-if="!savedSelection" class="quick-questions">
                <button class="quick-btn" @click="quickAsk('请总结这部分笔记的核心要点')">
                  总结要点
                </button>
                <button class="quick-btn" @click="quickAsk('请用更简单的语言解释这部分内容')">
                  简化解释
                </button>
                <button class="quick-btn" @click="quickAsk('请提供这部分内容的练习题')">
                  生成练习
                </button>
              </div>
            </div>

            <!-- 消息列表 -->
            <div
              v-for="(msg, index) in displayMessages"
              :key="index"
              :class="['message', msg.role, { 'is-context': msg.isContext }]"
            >
              <div class="message-avatar">
                {{ msg.role === 'user' ? '你' : 'AI' }}
              </div>
              <div class="message-content">
                <div class="message-text markdown-body" v-html="formatMessage(msg.content)" />
                <div v-if="msg.isStreaming" class="typing-indicator">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>

            <!-- 加载状态 -->
            <div v-if="isLoading && !currentResponse" class="loading-message">
              <div class="loading-dots">
                <span />
                <span />
                <span />
              </div>
              <p>正在分析中...</p>
            </div>

            <!-- 错误状态 -->
            <div v-if="error || localError" class="error-message">
              <p>{{ localError || error }}</p>
              <button class="btn btn-outline" @click="dismissError">关闭</button>
            </div>
          </div>

          <div class="ai-input-area">
            <textarea
              ref="inputRef"
              v-model="userInput"
              :placeholder="
                savedSelection ? '继续提问...' : '输入你的问题... (Enter 发送，Shift+Enter 换行)'
              "
              rows="2"
              :disabled="isLoading"
              @keydown="handleKeydown"
            />
            <button class="send-btn" :disabled="!userInput.trim() || isLoading" @click="handleSend">
              {{ isLoading ? '生成中...' : '发送' }}
            </button>
          </div>

          <div class="ai-footer">
            <span class="ai-note">AI 回答仅供参考，请结合教材和老师讲解综合判断</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ai-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.notes-ai-modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  width: 100%;
  max-width: 680px;
  height: 80vh;
  max-height: 700px;
  display: flex;
  flex-direction: column;
}

.ai-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ai-icon {
  font-size: 20px;
  color: var(--accent);
}

.ai-header h3 {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.clear-btn {
  background: none;
  border: 1px solid var(--border);
  padding: 4px 12px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.18s var(--ease-ink);
  font-family: inherit;
}

.clear-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: var(--text-primary);
}

/* 选中文字预览 */
.selection-preview {
  padding: 10px 20px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.preview-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.preview-text {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;
  max-height: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.ai-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.welcome-message {
  text-align: center;
  padding: 30px 20px;
  color: var(--text-muted);
}

.welcome-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  background: var(--accent);
  color: #fff;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.welcome-message p {
  margin: 8px 0;
}

.welcome-message .hint {
  font-size: 13px;
}

/* 快捷提问按钮 */
.quick-questions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 20px;
}

.quick-btn {
  padding: 8px 16px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s var(--ease-ink);
  font-family: inherit;
}

.quick-btn:hover {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.message.user {
  flex-direction: row-reverse;
}

.message.is-context {
  opacity: 0.8;
  margin-bottom: 12px;
}

.message.is-context .message-text {
  background: var(--bg);
  border-style: dashed;
  font-size: 13px;
}

.message-avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--border);
}

.message.user .message-avatar {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.message.assistant .message-avatar {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.message-content {
  max-width: 80%;
  min-width: 0;
}

.message.user .message-content {
  text-align: right;
}

.message-text {
  font-size: 14px;
  line-height: 1.7;
  padding: 12px 16px;
  border: 1px solid var(--border);
  word-break: break-word;
}

.message.user .message-text {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.message.assistant .message-text {
  background: var(--bg-card);
  color: var(--text-primary);
}

.message-text :deep(strong) {
  font-weight: 600;
}

.message-text :deep(em) {
  font-style: italic;
}

.message-text :deep(code) {
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 2px 6px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
}

.message.user .message-text :deep(code) {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
}

.message-text :deep(pre) {
  background: var(--bg-hover);
  border: 1px solid var(--border);
  padding: 10px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 13px;
  margin: 8px 0;
}

.message-text :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
}

.message-text :deep(ul),
.message-text :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}

.message-text :deep(li) {
  margin: 3px 0;
}

.message-text :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
}

.message-text :deep(th),
.message-text :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}

.message-text :deep(th) {
  background: var(--bg-hover);
  font-weight: 600;
}

/* 加载状态 */
.loading-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px;
  color: var(--text-muted);
}

.loading-dots {
  display: flex;
  gap: 6px;
}

.loading-dots span {
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out;
}

.loading-dots span:nth-child(1) {
  animation-delay: -0.32s;
}

.loading-dots span:nth-child(2) {
  animation-delay: -0.16s;
}

.typing-indicator {
  display: inline-flex;
  gap: 4px;
  padding: 8px 0;
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out;
}

.typing-indicator span:nth-child(1) {
  animation-delay: -0.32s;
}

.typing-indicator span:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%,
  80%,
  100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}

.error-message {
  text-align: center;
  padding: 16px;
  color: var(--wrong);
}

.error-message p {
  margin-bottom: 12px;
}

.ai-input-area {
  display: flex;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
}

.ai-input-area textarea {
  flex: 1;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.5;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  resize: none;
  font-family: inherit;
}

.ai-input-area textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.ai-input-area textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.send-btn {
  padding: 10px 20px;
  background: var(--accent);
  color: #fff;
  border: 1px solid var(--accent);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s var(--ease-ink);
  font-family: inherit;
}

.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-footer {
  padding: 8px 20px;
  border-top: 1px solid var(--border);
}

.ai-note {
  font-size: 12px;
  color: var(--text-muted);
}

/* 模态框动画 */
.modal-fade-enter-active {
  transition: opacity 0.2s var(--ease-ink);
}

.modal-fade-leave-active {
  transition: opacity 0.15s var(--ease-ink);
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

@media (max-width: 480px) {
  .ai-overlay {
    padding: 0;
  }

  .notes-ai-modal {
    height: 100vh;
    max-height: 100vh;
    border: none;
  }

  .message-content {
    max-width: 90%;
  }

  .quick-questions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
