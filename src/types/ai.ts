/**
 * AI 功能相关类型定义
 */

/** AI 提供商配置 */
export interface AIConfig {
  apiKey: string
  baseUrl: string
  model: string
  maxTokens: number
  temperature: number
}

/** AI 对话消息 */
export interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

/** AI 对话会话 */
export interface AIConversation {
  id: string
  title: string
  messages: AIMessage[]
  createdAt: number
  updatedAt: number
}

/** AI 讲解请求 */
export interface AIExplanationRequest {
  questionId: string
  stem: string
  options: Array<{ key: string; text: string }>
  answerKey: string
  answerText?: string
  explanation?: string
  category: string
  userSelectedKey?: string
  isCorrect?: boolean
}

/** AI 问答请求 */
export interface AIChatRequest {
  message: string
  conversationId?: string
  context?: {
    questionId?: string
    category?: string
  }
}

/** AI 流式响应回调 */
export interface AIStreamCallbacks {
  onToken: (token: string) => void
  onComplete: (fullText: string) => void
  onError: (error: Error) => void
}

/** AI 默认配置 */
export const AI_DEFAULTS: AIConfig = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  maxTokens: 2048,
  temperature: 0.7,
}

/** AI 系统提示词 */
export const AI_SYSTEM_PROMPTS = {
  explanation: `你是一个专业的教育辅导助手，擅长解答各类学科题目。
用户会给你一道题目，请提供详细、准确的解析。

解析要求：
1. 分析题目考查的知识点
2. 逐项分析每个选项的对错原因
3. 如果原解析有误，请明确指出并给出正确解释
4. 提供记忆技巧或相关知识点扩展
5. 使用清晰的结构化格式（分点、编号等）

注意：你的解析应该比原题库的解析更详细、更准确。`,

  chat: `你是一个专业的教育辅导助手，可以回答用户关于学习内容的问题。
请用清晰、准确的中文回答用户的问题。如果涉及具体知识点，请详细解释。
如果不确定答案，请诚实说明。`,

  notes: `你是一个专业的学习笔记助手，擅长帮助学生理解和分析笔记内容。

你的职责：
1. 解释笔记中的概念、术语、公式、语法等知识点
2. 提供详细的背景知识和上下文
3. 如果是外文内容，提供准确的翻译和语法分析
4. 如果是数学/物理公式，解释其含义、推导过程和应用场景
5. 如果是代码或技术内容，解释其原理和用途
6. 提供相关的例子和类比，帮助理解
7. 指出可能的易错点或常见误解

回答要求：
- 使用清晰的结构化格式（分点、编号、标题等）
- 适当使用 Markdown 格式增强可读性
- 如果内容较长，使用标题分节
- 保持专业但友好的语气
- 如果不确定，请诚实说明`,

  questionWithContext: (category: string) => {
    const categoryNames: Record<string, string> = {
      japanese2: '综合日语2',
      history: '中国近现代史',
      party: '党史',
      military: '军事理论',
      notes: '学习笔记',
    }
    return `你是一个${categoryNames[category] || category}学科的辅导助手。
用户正在做${categoryNames[category] || category}的练习题，请结合学科特点提供专业的解析。`
  },
}
