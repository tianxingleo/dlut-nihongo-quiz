<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useAI } from '../../composables/useAI'
import type { AIExplanationRequest } from '../../types/ai'

const props = defineProps<{
  request: AIExplanationRequest | null
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { isLoading, currentResponse, error, explainQuestion, clearError, aiEnabled } = useAI()

const responseContainer = ref<HTMLDivElement | null>(null)
const hasStarted = ref(false)
const isNearBottom = ref(true)

/** 判断滚动容器是否在底部附近（80px 容差） */
function checkNearBottom() {
  const el = responseContainer.value
  if (!el) return
  isNearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

// 当 request 变化时自动开始生成
watch(
  () => props.request,
  async (newRequest) => {
    if (newRequest && props.visible && aiEnabled.value) {
      hasStarted.value = true
      isNearBottom.value = true
      try {
        await explainQuestion(newRequest)
      } catch {
        // 错误已在 composable 中处理
      }
    }
  },
  { immediate: true },
)

// 流式传输时，仅当用户在底部附近才自动跟随滚动
watch(currentResponse, async () => {
  await nextTick()
  if (responseContainer.value && isNearBottom.value) {
    responseContainer.value.scrollTop = responseContainer.value.scrollHeight
  }
})

function handleClose() {
  emit('close')
}

function handleRetry() {
  if (props.request) {
    clearError()
    explainQuestion(props.request).catch(() => {})
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="ai-overlay" @click.self="handleClose">
        <div class="ai-modal">
          <div class="ai-header">
            <h3>AI 详细解析</h3>
            <button class="close-btn" @click="handleClose">&times;</button>
          </div>

          <div class="ai-content" ref="responseContainer" @scroll="checkNearBottom">
            <!-- 加载状态 -->
            <div v-if="isLoading && !currentResponse" class="ai-loading">
              <div class="loading-spinner"></div>
              <span>AI 正在思考...</span>
            </div>

            <!-- 错误状态 -->
            <div v-else-if="error" class="ai-error">
              <p>{{ error }}</p>
              <button class="btn btn-outline" @click="handleRetry">重试</button>
            </div>

            <!-- 响应内容 -->
            <div v-else-if="currentResponse" class="ai-response">
              <div
                class="response-text markdown-body"
                v-html="formatResponse(currentResponse)"
              ></div>
              <div v-if="isLoading" class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>

            <!-- 未启用状态 -->
            <div v-else-if="!aiEnabled" class="ai-not-enabled">
              <p>AI 功能未启用</p>
              <p class="hint">请在设置中配置 API Key</p>
            </div>
          </div>

          <div class="ai-footer">
            <span class="ai-note">AI 解析仅供参考，请结合原解析综合判断</span>
            <button class="btn btn-outline" @click="handleClose">关闭</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script lang="ts">
import { renderMarkdown } from '../../utils/renderMarkdown'

/** 格式化 AI 响应文本 */
function formatResponse(text: string): string {
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

.ai-modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  width: 100%;
  max-width: 640px;
  max-height: 80vh;
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

.ai-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  min-height: 200px;
  max-height: 60vh;
}

.ai-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--text-muted);
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-error {
  text-align: center;
  padding: 20px;
  color: var(--wrong);
}

.ai-error p {
  margin-bottom: 16px;
}

.ai-response {
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-primary);
}

.ai-response :deep(strong) {
  font-weight: 600;
  color: var(--text-primary);
}

.ai-response :deep(em) {
  font-style: italic;
  color: var(--text-secondary);
}

.ai-response :deep(code) {
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 2px 6px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
}

.ai-response :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}

.ai-response :deep(th),
.ai-response :deep(td) {
  border: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
}

.ai-response :deep(th) {
  background: var(--bg-hover);
  font-weight: 600;
}

.ai-response :deep(tr:nth-child(even)) {
  background: var(--bg-hover);
}

.ai-response :deep(ul),
.ai-response :deep(ol) {
  padding-left: 20px;
  margin: 8px 0;
}

.ai-response :deep(li) {
  margin: 4px 0;
}

.ai-response :deep(pre) {
  background: var(--bg-hover);
  border: 1px solid var(--border);
  padding: 12px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 13px;
  margin: 8px 0;
}

.ai-response :deep(pre code) {
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

.ai-not-enabled {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
}

.ai-not-enabled .hint {
  font-size: 13px;
  margin-top: 8px;
}

.ai-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
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
  .ai-modal {
    max-height: 90vh;
  }

  .ai-content {
    max-height: 70vh;
  }

  .ai-footer {
    flex-direction: column;
    gap: 8px;
  }
}
</style>
