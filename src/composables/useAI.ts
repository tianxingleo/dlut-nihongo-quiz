/**
 * AI 功能 composable - 提供响应式的 AI 状态管理
 */
import { ref, readonly } from 'vue'
import { setSetting } from '../db/database'
import {
  getAIConfig,
  isAIEnabled as checkAIEnabled,
  generateExplanation,
  sendChatMessage,
  testConnection as testAIConnection,
} from '../services/aiService'
import type { AIConfig, AIMessage, AIExplanationRequest, AIStreamCallbacks } from '../types/ai'

/** 全局 AI 状态 */
const aiEnabled = ref(false)
const aiConfig = ref<AIConfig | null>(null)
const isLoading = ref(false)
const currentResponse = ref('')
const error = ref<string | null>(null)

/** 对话历史 */
const conversationHistory = ref<AIMessage[]>([])

/** 初始化 AI 状态 */
async function initAI() {
  try {
    aiEnabled.value = await checkAIEnabled()
    aiConfig.value = await getAIConfig()
  } catch {
    aiEnabled.value = false
    aiConfig.value = null
  }
}

export function useAI() {
  /** 保存 AI 配置 */
  async function saveAIConfig(config: AIConfig) {
    await setSetting('aiConfig', config)
    aiConfig.value = config
    aiEnabled.value = !!config.apiKey
    await setSetting('aiEnabled', aiEnabled.value)
  }

  /** 启用/禁用 AI */
  async function toggleAI(enabled: boolean) {
    aiEnabled.value = enabled
    await setSetting('aiEnabled', enabled)
  }

  /** 测试 API 连接 */
  async function testConnection(): Promise<{ success: boolean; message: string }> {
    if (!aiConfig.value) {
      return { success: false, message: '请先配置 AI' }
    }
    return testAIConnection(aiConfig.value)
  }

  /** 生成题目解析 */
  async function explainQuestion(request: AIExplanationRequest): Promise<string> {
    isLoading.value = true
    error.value = null
    currentResponse.value = ''

    return new Promise((resolve, reject) => {
      const callbacks: AIStreamCallbacks = {
        onToken(token) {
          currentResponse.value += token
        },
        onComplete(fullText) {
          isLoading.value = false
          // 添加到对话历史
          conversationHistory.value.push(
            {
              role: 'user',
              content: `解析题目: ${request.stem.slice(0, 50)}...`,
              timestamp: Date.now(),
            },
            {
              role: 'assistant',
              content: fullText,
              timestamp: Date.now(),
            },
          )
          resolve(fullText)
        },
        onError(err) {
          isLoading.value = false
          error.value = err.message
          reject(err)
        },
      }

      generateExplanation(request, callbacks, conversationHistory.value).catch(reject)
    })
  }

  /** 发送聊天消息 */
  async function chat(message: string, context?: { category?: string }): Promise<string> {
    isLoading.value = true
    error.value = null
    currentResponse.value = ''

    return new Promise((resolve, reject) => {
      const callbacks: AIStreamCallbacks = {
        onToken(token) {
          currentResponse.value += token
        },
        onComplete(fullText) {
          isLoading.value = false
          // 添加到对话历史
          conversationHistory.value.push(
            {
              role: 'user',
              content: message,
              timestamp: Date.now(),
            },
            {
              role: 'assistant',
              content: fullText,
              timestamp: Date.now(),
            },
          )
          resolve(fullText)
        },
        onError(err) {
          isLoading.value = false
          error.value = err.message
          reject(err)
        },
      }

      sendChatMessage(message, callbacks, context, conversationHistory.value).catch(reject)
    })
  }

  /** 清空对话历史 */
  function clearHistory() {
    conversationHistory.value = []
    currentResponse.value = ''
    error.value = null
  }

  /** 重置错误 */
  function clearError() {
    error.value = null
  }

  return {
    // 状态
    aiEnabled: readonly(aiEnabled),
    aiConfig: readonly(aiConfig),
    isLoading: readonly(isLoading),
    currentResponse: readonly(currentResponse),
    error: readonly(error),
    conversationHistory: readonly(conversationHistory),

    // 方法
    initAI,
    saveAIConfig,
    toggleAI,
    testConnection,
    explainQuestion,
    chat,
    clearHistory,
    clearError,
  }
}
