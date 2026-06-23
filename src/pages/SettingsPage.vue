<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { exportData, importData, clearAllData } from '../db/database'
import { getCategoryCounts } from '../services/quizEngine'
import { CATEGORIES } from '../config/categories'
import { UI } from '../constants'
import { useToast } from '../composables/useToast'
import { useSettings } from '../composables/useSettings'
import { useAI } from '../composables/useAI'
import { AI_DEFAULTS } from '../types/ai'
import type { Category } from '../types/question'
import type { AIConfig } from '../types/ai'

const { showToast } = useToast()
const { darkMode, dailyGoal, toggleDark, saveDailyGoal, applyTheme, loadSettings } = useSettings()
const { aiEnabled, aiConfig, saveAIConfig, toggleAI, testConnection: testAIConnection } = useAI()
const counts = ref<Record<Category, number>>({} as Record<Category, number>)
const confirmClear = ref(false)
const appVersion = import.meta.env.PACKAGE_VERSION || '0.0.0'

// AI 配置表单
const aiForm = ref<AIConfig>({
  apiKey: '',
  baseUrl: AI_DEFAULTS.baseUrl,
  model: AI_DEFAULTS.model,
  maxTokens: AI_DEFAULTS.maxTokens,
  temperature: AI_DEFAULTS.temperature,
})
const showApiKey = ref(false)
const testingConnection = ref(false)
const testResult = ref<{ success: boolean; message: string } | null>(null)

onMounted(async () => {
  try {
    await loadSettings()
    applyTheme()
    // 5 个分类并发加载，不再串行 await 5 次
    counts.value = await getCategoryCounts()

    // 加载 AI 配置
    if (aiConfig.value) {
      aiForm.value = { ...aiConfig.value }
    }
  } catch {
    // 设置页加载失败不阻断页面，题库计数会显示 "—"
    applyTheme()
  }
})

async function refreshCounts() {
  try {
    counts.value = await getCategoryCounts()
  } catch {
    // 刷新失败不阻断页面
  }
}

async function handleExport() {
  const data = await exportData()
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `japanese-quiz-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  showToast('导出成功', 'success')
}

function handleImport() {
  // 导入前显示确认提示，支持选择导入模式
  const mode = confirm(
    '选择导入模式：\n\n' +
      '【确定】= 覆盖模式（清空现有数据后导入）\n' +
      '【取消】= 合并模式（保留现有数据，合并导入）\n\n' +
      '注意：系统会在导入前自动备份当前数据。',
  )

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      if (mode) {
        // 覆盖模式
        await importData(text)
        showToast('导入成功（覆盖模式）', 'success')
      } else {
        // 合并模式
        await importData(text, { merge: true })
        showToast('导入成功（合并模式）', 'success')
      }
      // 刷新页面数据
      await refreshCounts()
    } catch {
      showToast('导入失败，请检查文件格式', 'error')
    }
  }
  input.click()
}

async function handleClear() {
  if (!confirmClear.value) {
    confirmClear.value = true
    setTimeout(() => (confirmClear.value = false), UI.CLEAR_CONFIRM_TIMEOUT)
    return
  }
  await clearAllData()
  confirmClear.value = false
  // 清空数据后刷新页面状态
  counts.value = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0])) as Record<Category, number>
  showToast('数据已清空', 'success')
}

// AI 配置相关函数
async function handleSaveAIConfig() {
  try {
    await saveAIConfig(aiForm.value)
    showToast('AI 配置已保存', 'success')
    testResult.value = null
  } catch {
    showToast('保存失败', 'error')
  }
}

async function handleTestConnection() {
  testingConnection.value = true
  testResult.value = null

  try {
    // 先保存配置
    await saveAIConfig(aiForm.value)
    // 测试连接
    testResult.value = await testAIConnection()
  } catch {
    testResult.value = { success: false, message: '测试失败' }
  } finally {
    testingConnection.value = false
  }
}

async function handleToggleAI(enabled: boolean) {
  if (enabled && !aiForm.value.apiKey) {
    showToast('请先配置 API Key', 'error')
    return
  }
  await toggleAI(enabled)
  showToast(enabled ? 'AI 功能已启用' : 'AI 功能已禁用', 'success')
}

const totalCount = computed(() => Object.values(counts.value).reduce((a, b) => a + b, 0))
</script>
<template>
  <div class="settings-page">
    <header class="page-header">
      <h1>设置</h1>
    </header>

    <div class="section">
      <h2>题库信息</h2>
      <div v-for="c in CATEGORIES" :key="c.key" class="info-row">
        <span>{{ c.long }}</span>
        <span>{{ counts[c.key] || '—' }} 题</span>
      </div>
      <div class="info-row total">
        <span>合计</span><span>{{ totalCount }} 题</span>
      </div>
      <div class="info-row">
        <span>版本</span><span>v{{ appVersion }}</span>
      </div>
    </div>

    <div class="section">
      <h2>外观</h2>
      <button class="toggle-row" role="switch" :aria-checked="darkMode" @click="toggleDark">
        <span>深色模式</span>
        <span class="toggle-state">{{ darkMode ? '开' : '关' }}</span>
      </button>
    </div>

    <div class="section">
      <h2>学习目标</h2>
      <div class="goal-row">
        <span>每日答题目标</span>
        <div class="goal-input-group">
          <input
            v-model.number="dailyGoal"
            type="number"
            min="1"
            max="200"
            class="goal-input"
            @change="saveDailyGoal()"
            @blur="saveDailyGoal()"
          />
          <span class="goal-unit">题/天</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>数据管理</h2>
      <div class="action-row">
        <button class="btn btn-outline" @click="handleExport">导出备份</button>
        <button class="btn btn-outline" @click="handleImport">导入备份</button>
      </div>
      <div class="action-row">
        <button class="btn btn-outline danger" @click="handleClear">
          {{ confirmClear ? '再次点击确认清空' : '清空所有数据' }}
        </button>
      </div>
    </div>

    <div class="section">
      <h2>AI 助手</h2>
      <p class="ai-description">配置 AI 后，可以在做题时获取详细解析，也可以进行自由问答。</p>

      <div class="ai-toggle-row">
        <span>启用 AI 功能</span>
        <button
          class="toggle-btn"
          :class="{ active: aiEnabled }"
          @click="handleToggleAI(!aiEnabled)"
        >
          {{ aiEnabled ? '已启用' : '未启用' }}
        </button>
      </div>

      <div class="ai-config-form">
        <div class="form-group">
          <label for="ai-api-key">API Key</label>
          <div class="api-key-input">
            <input
              id="ai-api-key"
              v-model="aiForm.apiKey"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="输入你的 API Key"
              @change="testResult = null"
            />
            <button class="toggle-visibility" @click="showApiKey = !showApiKey">
              {{ showApiKey ? '隐藏' : '显示' }}
            </button>
          </div>
          <span class="form-hint">支持 DeepSeek、OpenAI 等兼容格式的 API</span>
        </div>

        <div class="form-group">
          <label for="ai-base-url">API 地址</label>
          <input
            id="ai-base-url"
            v-model="aiForm.baseUrl"
            type="text"
            placeholder="https://api.deepseek.com"
          />
          <span class="form-hint">DeepSeek: https://api.deepseek.com</span>
        </div>

        <div class="form-group">
          <label for="ai-model">模型名称</label>
          <input id="ai-model" v-model="aiForm.model" type="text" placeholder="deepseek-chat" />
          <span class="form-hint">DeepSeek: deepseek-chat | OpenAI: gpt-4o-mini</span>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="ai-max-tokens">最大 Token 数</label>
            <input
              id="ai-max-tokens"
              v-model.number="aiForm.maxTokens"
              type="number"
              min="256"
              max="8192"
              step="256"
            />
          </div>
          <div class="form-group">
            <label for="ai-temperature">温度 (0-2)</label>
            <input
              id="ai-temperature"
              v-model.number="aiForm.temperature"
              type="number"
              min="0"
              max="2"
              step="0.1"
            />
          </div>
        </div>

        <div class="ai-actions">
          <button class="btn btn-accent" @click="handleSaveAIConfig">保存配置</button>
          <button
            class="btn btn-outline"
            :disabled="!aiForm.apiKey || testingConnection"
            @click="handleTestConnection"
          >
            {{ testingConnection ? '测试中...' : '测试连接' }}
          </button>
        </div>

        <div
          v-if="testResult"
          class="test-result"
          :class="testResult.success ? 'success' : 'error'"
        >
          {{ testResult.message }}
        </div>
      </div>
    </div>

    <div class="section">
      <h2>快捷键</h2>
      <div class="shortcut-list">
        <div class="shortcut"><kbd>A/B/C/D 或 1/2/3/4</kbd><span>选择选项</span></div>
        <div class="shortcut"><kbd>E 或 5</kbd><span>多选第五选项</span></div>
        <div class="shortcut"><kbd>Enter</kbd><span>提交 / 下一题</span></div>
        <div class="shortcut"><kbd>N</kbd><span>下一题</span></div>
        <div class="shortcut"><kbd>P</kbd><span>上一题</span></div>
        <div class="shortcut"><kbd>B</kbd><span>收藏题目</span></div>
      </div>
    </div>

    <div class="section">
      <h2>关于</h2>
      <p class="about-text">
        本平台整合了日语语法词汇、中国近现代史、党史、军事理论等学科的期末复习题库。
        支持多种刷题模式、智能错题本、掌握度分析，所有数据存储在浏览器本地，无需联网。
      </p>
      <p class="about-links">
        <a href="https://github.com/tianxingleo/dlut-nihongo-quiz" target="_blank">GitHub 仓库</a>
        <span class="sep">·</span>
        <span>Apache-2.0</span>
      </p>
    </div>
  </div>
</template>
<style scoped>
.settings-page {
  max-width: 560px;
  margin: 0 auto;
}
.page-header {
  margin-bottom: 24px;
}
h1 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
}

.section {
  margin-bottom: 20px;
  padding: 18px 22px;
  border: 1px solid var(--border);
  background: var(--bg-card);
}
.section h2 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--text-primary);
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 14px;
  color: var(--text-secondary);
}
.info-row.total {
  border-top: 1px solid var(--border);
  margin-top: 4px;
  padding-top: 10px;
  font-weight: 600;
  color: var(--text-primary);
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  padding: 6px 0;
  font-size: 14px;
  color: var(--text-secondary);
  user-select: none;
  background: none;
  border: none;
  width: 100%;
  text-align: left;
  font-family: inherit;
}
.toggle-row:hover .toggle-state {
  border-color: var(--accent);
}
.toggle-state {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  padding: 3px 14px;
  border: 1px solid var(--border);
  transition:
    border-color 0.18s var(--ease-ink),
    color 0.18s var(--ease-ink);
}

.action-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.goal-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 14px;
  color: var(--text-secondary);
}
.goal-input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.goal-input {
  width: 64px;
  padding: 4px 8px;
  font-size: 14px;
  text-align: center;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-family: var(--font-mono);
  transition: border-color 0.18s var(--ease-ink);
}
.goal-input:focus {
  outline: none;
  border-color: var(--accent);
}
.goal-unit {
  font-size: 13px;
  color: var(--text-muted);
}

.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.shortcut {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 14px;
}
.shortcut kbd {
  padding: 3px 8px;
  background: var(--bg-hover);
  font-family: var(--font-mono);
  font-size: 12px;
  border: 1px solid var(--border);
  min-width: 64px;
  text-align: center;
}
.shortcut span {
  color: var(--text-secondary);
}

.about-text {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.8;
}
.about-links {
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 8px;
}
.about-links a {
  color: var(--accent);
}
.sep {
  color: var(--border);
}

/* AI 配置样式 */
.ai-description {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 16px;
  line-height: 1.6;
}

.ai-toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  color: var(--text-secondary);
}

.toggle-btn {
  padding: 4px 14px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.18s var(--ease-ink);
}

.toggle-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.ai-config-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.form-group input {
  padding: 8px 12px;
  font-size: 14px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: var(--font-mono);
  transition: border-color 0.18s var(--ease-ink);
}

.form-group input:focus {
  outline: none;
  border-color: var(--accent);
}

.form-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.api-key-input {
  display: flex;
  gap: 8px;
}

.api-key-input input {
  flex: 1;
}

.toggle-visibility {
  padding: 8px 12px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.18s var(--ease-ink);
}

.toggle-visibility:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.ai-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.test-result {
  padding: 10px 14px;
  font-size: 13px;
  border-left: 3px solid;
}

.test-result.success {
  border-left-color: var(--correct);
  background: color-mix(in srgb, var(--correct) 10%, transparent);
  color: var(--correct);
}

.test-result.error {
  border-left-color: var(--wrong);
  background: color-mix(in srgb, var(--wrong) 8%, transparent);
  color: var(--wrong);
}

@media (max-width: 480px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
