/** * 文字选中浮动工具栏 - 选中文字后显示AI图标，点击可呼出AI对话 */
<script setup lang="ts">
import { computed } from 'vue'
import type { TextSelection } from '../../composables/useTextSelection'

const props = defineProps<{
  selection: TextSelection | null
  visible: boolean
}>()

const emit = defineEmits<{
  'ask-ai': [selection: TextSelection]
  explain: [selection: TextSelection]
  close: []
}>()

/** 计算工具栏位置 - 显示在选中文字的右上方，不遮挡文字 */
const toolbarStyle = computed((): Record<string, string> => {
  if (!props.selection) return { display: 'none' }

  const { viewportRect, containerRect } = props.selection
  const toolbarWidth = 180
  const offset = 12

  // 计算选中文字相对于容器的位置
  const relativeTop = viewportRect.top - containerRect.top
  const relativeRight = viewportRect.right - containerRect.left

  // 显示在选中文字的右上方
  let top = relativeTop - offset
  let left = relativeRight + offset

  // 如果右侧空间不足，显示在左侧
  if (left + toolbarWidth > containerRect.width) {
    left = viewportRect.left - containerRect.left - toolbarWidth - offset
  }

  // 如果左侧也不够，显示在上方居中
  if (left < 0) {
    left = relativeTop - toolbarWidth / 2
    top = relativeTop - 60 - offset
  }

  // 确保不超出顶部
  if (top < 0) {
    top = viewportRect.bottom - containerRect.top + offset
  }

  // 确保不超出左边界
  if (left < 0) left = 8
  // 确保不超出右边界
  if (left + toolbarWidth > containerRect.width) {
    left = containerRect.width - toolbarWidth - 8
  }

  return {
    position: 'absolute',
    top: `${top}px`,
    left: `${left}px`,
    zIndex: '9999',
  }
})

/** 选中文字的简短预览 */
const textPreview = computed(() => {
  if (!props.selection) return ''
  const text = props.selection.text
  return text.length > 20 ? text.slice(0, 20) + '...' : text
})

function handleAskAI(e: Event) {
  e.stopPropagation()
  if (props.selection) {
    emit('ask-ai', props.selection)
  }
}

function handleExplain(e: Event) {
  e.stopPropagation()
  if (props.selection) {
    emit('explain', props.selection)
  }
}
</script>

<template>
  <Transition name="toolbar-fade">
    <div
      v-if="visible && selection"
      class="text-selection-toolbar"
      :style="toolbarStyle"
      @click.stop
    >
      <div class="toolbar-content">
        <div class="toolbar-preview">{{ textPreview }}</div>
        <div class="toolbar-actions">
          <button class="toolbar-btn" @click="handleExplain" title="AI 解释选中内容">
            <span class="btn-icon">✦</span>
            <span class="btn-text">解释</span>
          </button>
          <button class="toolbar-btn" @click="handleAskAI" title="向 AI 提问">
            <span class="btn-icon">💬</span>
            <span class="btn-text">问答</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.text-selection-toolbar {
  position: absolute;
  z-index: 9999;
  animation: toolbar-appear 0.15s var(--ease-ink);
}

.toolbar-content {
  background: var(--bg-card);
  border: 1px solid var(--accent);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
  padding: 6px 10px;
  min-width: 160px;
}

.toolbar-preview {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar-actions {
  display: flex;
  gap: 6px;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s var(--ease-ink);
  font-family: inherit;
  white-space: nowrap;
}

.toolbar-btn:hover {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.toolbar-btn:active {
  transform: scale(0.95);
}

.btn-icon {
  font-size: 13px;
}

.btn-text {
  font-weight: 500;
}

@keyframes toolbar-appear {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.toolbar-fade-enter-active {
  transition:
    opacity 0.12s var(--ease-ink),
    transform 0.12s var(--ease-ink);
}

.toolbar-fade-leave-active {
  transition:
    opacity 0.08s var(--ease-ink),
    transform 0.08s var(--ease-ink);
}

.toolbar-fade-enter-from,
.toolbar-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

@media (max-width: 480px) {
  .toolbar-content {
    min-width: 140px;
    padding: 5px 8px;
  }

  .toolbar-btn {
    padding: 6px 8px;
    font-size: 11px;
  }
}
</style>
