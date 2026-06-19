<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { exportData, importData, clearAllData, getSetting, setSetting } from '../db/database'
import { loadQuestionBank } from '../services/quizEngine'

const darkMode = ref(false)
const grammarCount = ref(0)
const wordCount = ref(0)
const statusMsg = ref('')
const confirmClear = ref(false)

onMounted(async () => {
  darkMode.value = await getSetting('darkMode', false)
  applyTheme()
  const g = await loadQuestionBank('grammar')
  const w = await loadQuestionBank('word')
  grammarCount.value = g.length
  wordCount.value = w.length
})

function applyTheme() {
  document.documentElement.setAttribute('data-theme', darkMode.value ? 'dark' : 'light')
}

async function toggleDark() {
  darkMode.value = !darkMode.value
  await setSetting('darkMode', darkMode.value)
  applyTheme()
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
  setTimeout(() => statusMsg.value = '', 2000)
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
    setTimeout(() => statusMsg.value = '', 3000)
  }
  input.click()
}

async function handleClear() {
  if (!confirmClear.value) {
    confirmClear.value = true
    setTimeout(() => confirmClear.value = false, 5000)
    return
  }
  await clearAllData()
  confirmClear.value = false
  statusMsg.value = '数据已清空'
  setTimeout(() => statusMsg.value = '', 2000)
}
</script>
<template>
  <div class="settings-page">
    <header class="page-header">
      <h1>设置</h1>
    </header>

    <div class="section">
      <h2>题库信息</h2>
      <div class="info-row"><span>语法题</span><span>{{ grammarCount }} 题</span></div>
      <div class="info-row"><span>单词题</span><span>{{ wordCount }} 题</span></div>
      <div class="info-row"><span>合计</span><span>{{ grammarCount + wordCount }} 题</span></div>
      <div class="info-row"><span>版本</span><span>v1.1</span></div>
    </div>

    <div class="section">
      <h2>外观</h2>
      <div class="toggle-row" @click="toggleDark">
        <span>深色模式</span>
        <span class="toggle-state">{{ darkMode ? '开' : '关' }}</span>
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
        <div class="shortcut"><kbd>A/B/C/D</kbd><span>选择选项</span></div>
        <div class="shortcut"><kbd>Enter</kbd><span>提交 / 下一题</span></div>
        <div class="shortcut"><kbd>N</kbd><span>下一题</span></div>
      </div>
    </div>

    <div class="section">
      <router-link to="/">返回首页</router-link>
    </div>
  </div>
</template>
<style scoped>
.settings-page { max-width: 560px; margin: 0 auto; }
.page-header { margin-bottom: 24px; }
h1 { font-family: var(--font-display); font-size: 22px; font-weight: 700; }

.section { margin-bottom: 20px; padding: 18px 22px; border: 1px solid var(--border); background: var(--bg-card); }
.section h2 { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--text-primary); }

.info-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; color: var(--text-secondary); }

.toggle-row {
  display: flex; justify-content: space-between; align-items: center;
  cursor: pointer; padding: 6px 0; font-size: 14px; color: var(--text-secondary);
  user-select: none;
}
.toggle-row:hover .toggle-state { border-color: var(--accent); }
.toggle-state {
  font-size: 12px; font-weight: 600; color: var(--accent);
  padding: 3px 14px; border: 1px solid var(--border); transition: border-color .12s;
}

.action-row { display: flex; gap: 8px; margin-bottom: 8px; }
.btn { padding: 9px 20px; border: 1px solid var(--border); font-size: 13px; transition: all .12s; }
.btn-outline { background: transparent; color: var(--text-primary); }
.btn-outline:hover { border-color: var(--accent); color: var(--accent); }
.btn-outline.danger { color: var(--wrong); border-color: rgba(196,69,54,.3); }
.btn-outline.danger:hover { background: #fdf5f4; border-color: var(--wrong); }

.status { font-size: 13px; color: var(--accent); margin-top: 6px; }

.shortcut-list { display: flex; flex-direction: column; gap: 6px; }
.shortcut { display: flex; align-items: center; gap: 14px; font-size: 14px; }
.shortcut kbd {
  padding: 3px 8px; background: var(--bg-hover); font-family: var(--font-mono);
  font-size: 12px; border: 1px solid var(--border); min-width: 64px; text-align: center;
}
.shortcut span { color: var(--text-secondary); }
</style>
