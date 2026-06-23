<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { exportData, importData, clearAllData, getSetting, setSetting } from '../db/database'
import { getCategoryCounts } from '../services/quizEngine'
import { CATEGORIES } from '../config/categories'
import type { Category } from '../types/question'

const darkMode = ref(false)
const counts = ref<Record<Category, number>>({} as Record<Category, number>)
const statusMsg = ref('')
const confirmClear = ref(false)
const dailyGoal = ref(30)

onMounted(async () => {
  darkMode.value = await getSetting('darkMode', false)
  dailyGoal.value = await getSetting('dailyGoal', 30)
  applyTheme()
  // 5 个分类并发加载，不再串行 await 5 次
  counts.value = await getCategoryCounts()
})

function applyTheme() {
  document.documentElement.setAttribute('data-theme', darkMode.value ? 'dark' : 'light')
}

async function toggleDark() {
  darkMode.value = !darkMode.value
  await setSetting('darkMode', darkMode.value)
  applyTheme()
}

async function saveDailyGoal() {
  const val = Math.max(1, Math.min(200, Math.round(dailyGoal.value)))
  dailyGoal.value = val
  await setSetting('dailyGoal', val)
  statusMsg.value = '每日目标已更新'
  setTimeout(() => (statusMsg.value = ''), 2000)
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
  statusMsg.value = '导出成功'
  setTimeout(() => (statusMsg.value = ''), 2000)
}

function handleImport() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      await importData(text)
      statusMsg.value = '导入成功'
    } catch {
      statusMsg.value = '导入失败，请检查文件格式'
    }
    setTimeout(() => (statusMsg.value = ''), 3000)
  }
  input.click()
}

async function handleClear() {
  if (!confirmClear.value) {
    confirmClear.value = true
    setTimeout(() => (confirmClear.value = false), 5000)
    return
  }
  await clearAllData()
  confirmClear.value = false
  statusMsg.value = '数据已清空'
  setTimeout(() => (statusMsg.value = ''), 2000)
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
      <div class="info-row"><span>版本</span><span>v0.3.0</span></div>
    </div>

    <div class="section">
      <h2>外观</h2>
      <div class="toggle-row" @click="toggleDark">
        <span>深色模式</span>
        <span class="toggle-state">{{ darkMode ? '开' : '关' }}</span>
      </div>
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
            @change="saveDailyGoal"
            @blur="saveDailyGoal"
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
      <p v-if="statusMsg" class="status">{{ statusMsg }}</p>
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
.status {
  font-size: 13px;
  color: var(--accent);
  margin-top: 6px;
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
</style>
