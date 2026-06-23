/**
 * AI 服务层 - 处理与 AI API 的交互
 *
 * 使用 OpenAI 兼容格式，支持 DeepSeek、OpenAI 等多种提供商
 * 所有 API 调用在本地进行，不经过任何中间服务器
 */
import { getSetting } from '../db/database'
import { AI_DEFAULTS, AI_SYSTEM_PROMPTS } from '../types/ai'
import type {
  AIConfig,
  AIMessage,
  AIExplanationRequest,
  AIStreamCallbacks,
} from '../types/ai'

/** AI 服务错误类型 */
export class AIServiceError extends Error {
  code: string
  status?: number

  constructor(message: string, code: string, status?: number) {
    super(message)
    this.name = 'AIServiceError'
    this.code = code
    this.status = status
  }
}

/** 获取 AI 配置 */
export async function getAIConfig(): Promise<AIConfig | null> {
  const config = await getSetting('aiConfig', null)
  if (!config || !config.apiKey) return null
  return { ...AI_DEFAULTS, ...config }
}

/** 检查 AI 是否已启用 */
export async function isAIEnabled(): Promise<boolean> {
  const enabled = await getSetting('aiEnabled', false)
  if (!enabled) return false
  const config = await getAIConfig()
  return !!config?.apiKey
}

/** 构建请求头 */
function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

/** 构建消息数组 */
function buildMessages(
  systemPrompt: string,
  userMessage: string,
  history: AIMessage[] = [],
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ]

  // 添加历史消息（最多保留最近 10 条）
  const recentHistory = history.slice(-10)
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content })
  }

  // 添加当前用户消息
  messages.push({ role: 'user', content: userMessage })

  return messages
}

/** 发送流式请求 */
export async function sendStreamRequest(
  config: AIConfig,
  messages: Array<{ role: string; content: string }>,
  callbacks: AIStreamCallbacks,
): Promise<void> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/v1/chat/completions`

  const body = JSON.stringify({
    model: config.model,
    messages,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: true,
  })

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(config.apiKey),
      body,
    })

    if (!response.ok) {
      let errorMessage = `API 请求失败 (${response.status})`

      if (response.status === 401) {
        errorMessage = 'API Key 无效或已过期'
      } else if (response.status === 429) {
        errorMessage = '请求过于频繁，请稍后再试'
      } else if (response.status === 500) {
        errorMessage = 'AI 服务暂时不可用，请稍后再试'
      }

      throw new AIServiceError(errorMessage, 'API_ERROR', response.status)
    }

    if (!response.body) {
      throw new AIServiceError('无法获取响应流', 'NO_BODY')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue

        const data = trimmed.slice(6)
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            fullText += content
            callbacks.onToken(content)
          }
        } catch {
          // 忽略解析错误，继续处理下一行
        }
      }
    }

    callbacks.onComplete(fullText)
  } catch (error) {
    if (error instanceof AIServiceError) {
      callbacks.onError(error)
    } else if (error instanceof TypeError && error.message.includes('fetch')) {
      callbacks.onError(
        new AIServiceError(
          '网络连接失败，请检查网络设置和 API 地址',
          'NETWORK_ERROR',
        ),
      )
    } else {
      callbacks.onError(
        new AIServiceError(
          error instanceof Error ? error.message : '未知错误',
          'UNKNOWN_ERROR',
        ),
      )
    }
  }
}

/** 生成题目解析 */
export async function generateExplanation(
  request: AIExplanationRequest,
  callbacks: AIStreamCallbacks,
  history: AIMessage[] = [],
): Promise<void> {
  const config = await getAIConfig()
  if (!config) {
    callbacks.onError(new AIServiceError('请先在设置中配置 AI', 'NO_CONFIG'))
    return
  }

  const systemPrompt = AI_SYSTEM_PROMPTS.questionWithContext(request.category)

  // 构建用户消息
  const optionsText = request.options.map((o) => `${o.key}. ${o.text}`).join('\n')
  let userMessage = `请详细解析以下题目：

【题干】
${request.stem}

【选项】
${optionsText}

【正确答案】${request.answerKey}${request.answerText ? `. ${request.answerText}` : ''}`

  if (request.explanation) {
    userMessage += `\n\n【原题库解析】（可能不准确，请甄别后使用）
${request.explanation}`
  }

  if (request.userSelectedKey) {
    userMessage += `\n\n【用户选择】${request.userSelectedKey}
用户${request.isCorrect ? '答对了' : '答错了'}，请针对用户的理解情况进行讲解。`
  }

  const messages = buildMessages(systemPrompt, userMessage, history)
  await sendStreamRequest(config, messages, callbacks)
}

/** 发送自由问答 */
export async function sendChatMessage(
  message: string,
  callbacks: AIStreamCallbacks,
  context?: { category?: string },
  history: AIMessage[] = [],
): Promise<void> {
  const config = await getAIConfig()
  if (!config) {
    callbacks.onError(new AIServiceError('请先在设置中配置 AI', 'NO_CONFIG'))
    return
  }

  let systemPrompt = AI_SYSTEM_PROMPTS.chat
  if (context?.category) {
    systemPrompt += '\n\n' + AI_SYSTEM_PROMPTS.questionWithContext(context.category)
  }

  const messages = buildMessages(systemPrompt, message, history)
  await sendStreamRequest(config, messages, callbacks)
}

/** 测试 API 连接 */
export async function testConnection(config: AIConfig): Promise<{ success: boolean; message: string }> {
  try {
    const testMessages = [
      { role: 'system', content: '你是一个助手。' },
      { role: 'user', content: '请回复"连接成功"这四个字。' },
    ]

    const url = `${config.baseUrl.replace(/\/$/, '')}/v1/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(config.apiKey),
      body: JSON.stringify({
        model: config.model,
        messages: testMessages,
        max_tokens: 50,
        temperature: 0,
      }),
    })

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, message: 'API Key 无效' }
      }
      return { success: false, message: `服务器返回错误 (${response.status})` }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    if (content.includes('连接成功')) {
      return { success: true, message: '连接成功' }
    }

    return { success: true, message: `连接成功（AI 回复：${content.slice(0, 50)}）` }
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return { success: false, message: '网络连接失败，请检查 API 地址' }
    }
    return {
      success: false,
      message: error instanceof Error ? error.message : '未知错误',
    }
  }
}
