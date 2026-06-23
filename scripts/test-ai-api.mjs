/**
 * AI API 测试脚本
 *
 * 使用 .env 中的配置测试 DeepSeek API 连接
 * 支持 Anthropic 格式和 OpenAI 格式
 * 用法: node scripts/test-ai-api.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 加载 .env
const envPath = path.resolve(__dirname, '../.env')
const envOverrides = {}
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m) envOverrides[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const API_KEY = envOverrides.ANTHROPIC_AUTH_TOKEN
const BASE_URL = envOverrides.ANTHROPIC_BASE_URL || 'https://api.deepseek.com'
const MODEL = envOverrides.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'deepseek-chat'

if (!API_KEY) {
  console.error('❌ ANTHROPIC_AUTH_TOKEN not set in .env')
  process.exit(1)
}

console.log('🔧 配置信息:')
console.log(`   Base URL: ${BASE_URL}`)
console.log(`   Model: ${MODEL}`)
console.log(`   API Key: ${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`)
console.log('')

// 判断是否使用 Anthropic 格式
const isAnthropicFormat = BASE_URL.includes('anthropic')

async function testWithAnthropicFormat() {
  console.log('📡 使用 Anthropic 格式测试...')
  try {
    const response = await fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 100,
        system: '你是一个助手。',
        messages: [{ role: 'user', content: '请回复"连接成功"这四个字。' }],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`   ❌ 请求失败: ${response.status} ${response.statusText}`)
      console.error(`   错误信息: ${errorText}`)
      return null
    }

    const data = await response.json()
    const content = data.content?.map((c) => c.text || '').join('') || ''
    console.log(`   ✅ 连接成功! AI 回复: "${content}"`)
    return content
  } catch (error) {
    console.error(`   ❌ 网络错误: ${error.message}`)
    return null
  }
}

async function testWithOpenAIFormat() {
  console.log('📡 使用 OpenAI 格式测试...')
  try {
    // 尝试标准 OpenAI 端点
    let url = `${BASE_URL}/v1/chat/completions`
    if (BASE_URL.includes('anthropic')) {
      // 如果是 anthropic 端点，尝试 deepseek 的 OpenAI 兼容端点
      url = 'https://api.deepseek.com/v1/chat/completions'
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: '你是一个助手。' },
          { role: 'user', content: '请回复"连接成功"这四个字。' },
        ],
        max_tokens: 50,
        temperature: 0,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`   ❌ 请求失败: ${response.status} ${response.statusText}`)
      console.error(`   错误信息: ${errorText}`)
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    console.log(`   ✅ 连接成功! AI 回复: "${content}"`)
    return content
  } catch (error) {
    console.error(`   ❌ 网络错误: ${error.message}`)
    return null
  }
}

async function testExplanation() {
  console.log('')
  console.log('📡 测试题目解析...')
  try {
    const systemPrompt = `你是一个中国近代史选择题的辅导助手。
请提供详细、准确的解析。解析要求：
1. 分析题目考查的知识点
2. 逐项分析每个选项的对错原因
3. 提供记忆技巧`

    const userMessage = `请解析以下题目：

【题干】
中国近代史的起点是？

【选项】
A. 鸦片战争
B. 太平天国运动
C. 洋务运动
D. 辛亥革命

【正确答案】A`

    let response
    if (isAnthropicFormat) {
      response = await fetch(`${BASE_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 500,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
      })
    } else {
      let url = `${BASE_URL}/v1/chat/completions`
      if (BASE_URL.includes('anthropic')) {
        url = 'https://api.deepseek.com/v1/chat/completions'
      }
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          max_tokens: 500,
          temperature: 0.7,
        }),
      })
    }

    if (!response.ok) {
      console.error(`   ❌ 请求失败: ${response.status}`)
      return false
    }

    const data = await response.json()
    let content = ''
    if (isAnthropicFormat) {
      content = data.content?.map((c) => c.text || '').join('') || ''
    } else {
      content = data.choices?.[0]?.message?.content || ''
    }

    console.log(`   ✅ 解析生成成功!`)
    console.log('   📝 AI 解析预览:')
    console.log('   ' + '-'.repeat(50))
    const preview = content.slice(0, 400)
    console.log('   ' + preview.replace(/\n/g, '\n   '))
    if (content.length > 400) {
      console.log('   ... (更多内容省略)')
    }
    console.log('   ' + '-'.repeat(50))
    return true
  } catch (error) {
    console.error(`   ❌ 错误: ${error.message}`)
    return false
  }
}

// 运行测试
console.log('='.repeat(60))
console.log('🚀 开始 AI API 测试')
console.log('='.repeat(60))
console.log('')

let connectionResult = null

// 先尝试对应的格式
if (isAnthropicFormat) {
  connectionResult = await testWithAnthropicFormat()
  // 如果失败，尝试 OpenAI 格式
  if (!connectionResult) {
    console.log('')
    connectionResult = await testWithOpenAIFormat()
  }
} else {
  connectionResult = await testWithOpenAIFormat()
  // 如果失败，尝试 Anthropic 格式
  if (!connectionResult) {
    console.log('')
    connectionResult = await testWithAnthropicFormat()
  }
}

console.log('')
const explanationResult = connectionResult ? await testExplanation() : false

console.log('')
console.log('='.repeat(60))
console.log('📊 测试结果汇总:')
console.log('='.repeat(60))
console.log(`   API 连接: ${connectionResult ? '✅ 通过' : '❌ 失败'}`)
console.log(`   题目解析: ${explanationResult ? '✅ 通过' : '❌ 失败'}`)
console.log('')

if (connectionResult && explanationResult) {
  console.log('🎉 所有测试通过! AI 功能可以正常使用。')
  console.log('')
  console.log('💡 提示: 你可以在应用的设置页面配置相同的 API 信息来使用 AI 功能。')
} else {
  console.log('⚠️  部分测试失败，请检查配置。')
  process.exit(1)
}
