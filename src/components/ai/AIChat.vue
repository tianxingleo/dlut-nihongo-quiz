<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { useAI } from '../../composables/useAI'

const props = defineProps<{
  visible: boolean
  context?: {
    questionId?: string
    category?: string
  }
}>()

const emit = defineEmits<{
  close: []
}>()

const { isLoading, currentResponse, error, conversationHistory, chat, clearHistory, clearError } =
  useAI()

const userInput = ref('')
const responseContainer = ref<HTMLDivElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const isNearBottom = ref(true)

/** 判断滚动容器是否在底部附近（80px 容差） */
function checkNearBottom() {
  const el = responseContainer.value
  if (!el) return
  isNearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

// 合并历史消息和当前响应
const displayMessages = computed(() => {
  const messages: Array<{ role: 'user' | 'assistant'; content: string; isStreaming?: boolean }> = [
    ...conversationHistory.value.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ]

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

// 流式传输时，仅当用户在底部附近才自动跟随滚动
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

// 聚焦输入框
watch(
  () => props.visible,
  async (val) => {
    if (val) {
      await nextTick()
      inputRef.value?.focus()
    }
  },
)

function handleClose() {
  emit('close')
}

async function handleSend() {
  const message = userInput.value.trim()
  if (!message || isLoading.value) return

  userInput.value = ''
  clearError()
  isNearBottom.value = true

  try {
    await chat(message, props.context)
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
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="ai-overlay" @click.self="handleClose">
        <div class="ai-chat-modal">
          <div class="ai-header">
            <h3>AI 问答助手</h3>
            <div class="header-actions">
              <button class="clear-btn" @click="handleClear" title="清空对话">清空</button>
              <button class="close-btn" @click="handleClose">&times;</button>
            </div>
          </div>

          <div class="ai-messages" ref="responseContainer" @scroll="checkNearBottom">
            <!-- 欢迎消息 -->
            <div v-if="displayMessages.length === 0" class="welcome-message">
              <div class="welcome-icon">AI</div>
              <p>你好！我是 AI 学习助手，可以帮你解答学习中的问题。</p>
              <p class="hint">你可以问我关于题目、知识点或学习方法的问题。</p>
            </div>

            <!-- 消息列表 -->
            <div
              v-for="(msg, index) in displayMessages"
              :key="index"
              :class="['message', msg.role]"
            >
              <div class="message-avatar">
                {{ msg.role === 'user' ? '你' : 'AI' }}
              </div>
              <div class="message-content">
                <div class="message-text markdown-body" v-html="formatMessage(msg.content)"></div>
                <div v-if="msg.isStreaming" class="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>

            <!-- 错误状态 -->
            <div v-if="error" class="error-message">
              <p>{{ error }}</p>
              <button class="btn btn-outline" @click="clearError">关闭</button>
            </div>
          </div>

          <div class="ai-input-area">
            <textarea
              ref="inputRef"
              v-model="userInput"
              placeholder="输入你的问题... (Enter 发送，Shift+Enter 换行)"
              rows="2"
              :disabled="isLoading"
              @keydown="handleKeydown"
            ></textarea>
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

<script lang="ts">
import { renderMarkdown } from '../../utils/renderMarkdown'

/** 格式化消息文本 */
function formatMessage(text: string): string {
  return renderMarkdown(text)
}
</script>

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

.ai-chat-modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  width: 100%;
  max-width: 700px;
  height: 80vh;
  max-height: 700px;
  display: flex;
  flex-direction: column;
}

.ai-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
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

.ai-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.welcome-message {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
}

.welcome-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  font-size: 18px;
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

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.message.user {
  flex-direction: row-reverse;
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

.message-text :deep(tr:nth-child(even)) {
  background: var(--bg-hover);
}

.message.user .message-text :deep(th),
.message.user .message-text :deep(td) {
  border-color: rgba(255, 255, 255, 0.3);
}

.message.user .message-text :deep(th) {
  background: rgba(255, 255, 255, 0.15);
}

.message.user .message-text :deep(tr:nth-child(even)) {
  background: rgba(255, 255, 255, 0.1);
}

.message-text :deep(ul),
.message-text :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}

.message-text :deep(li) {
  margin: 3px 0;
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
  padding: 16px 20px;
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

  .ai-chat-modal {
    height: 100vh;
    max-height: 100vh;
    border: none;
  }

  .message-content {
    max-width: 90%;
  }
}
</style>
