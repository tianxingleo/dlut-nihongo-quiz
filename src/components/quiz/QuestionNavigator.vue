<script setup lang="ts">
import { ref, computed } from 'vue'

type Status = 'correct' | 'wrong' | 'draft' | 'unanswered'

const props = defineProps<{
  currentIndex: number
  total: number
  statusOf: (index: number) => Status
  labels?: (index: number) => string
}>()

const emit = defineEmits<{ jump: [index: number] }>()

const isExpanded = ref(false)
const currentPage = ref(0)
const PAGE_SIZE = 100

// 计算总页数
const totalPages = computed(() => Math.ceil(props.total / PAGE_SIZE))

// 当前页的题目范围
const pageRange = computed(() => {
  const start = currentPage.value * PAGE_SIZE
  const end = Math.min(start + PAGE_SIZE, props.total)
  return { start, end }
})

// 自动跳转到当前题目所在的页
function scrollToCurrentPage() {
  const targetPage = Math.floor(props.currentIndex / PAGE_SIZE)
  if (targetPage !== currentPage.value) {
    currentPage.value = targetPage
  }
}

function labelAt(i: number): string {
  if (props.labels) return props.labels(i)
  return String(i + 1)
}

function toggleExpand() {
  isExpanded.value = !isExpanded.value
  if (isExpanded.value) {
    scrollToCurrentPage()
  }
}

function pick(i: number) {
  emit('jump', i)
  isExpanded.value = false
}

function goToPage(page: number) {
  currentPage.value = Math.max(0, Math.min(page, totalPages.value - 1))
}
</script>

<template>
  <div class="navigator">
    <button
      class="expand-btn"
      :class="{ active: isExpanded }"
      :aria-expanded="isExpanded"
      :title="isExpanded ? '收起题号网格' : '展开题号网格'"
      @click="toggleExpand"
    >
      <span class="expand-icon" :class="{ rotated: isExpanded }" aria-hidden="true">▦</span>
      <span class="expand-text">题目列表</span>
      <span class="expand-pos">
        <span class="cur">{{ currentIndex + 1 }}</span>
        <span class="sep">/</span>
        <span class="tot">{{ total }}</span>
      </span>
    </button>

    <Transition name="drawer">
      <div v-if="isExpanded" class="grid-drawer" role="dialog" aria-label="题目列表">
        <div class="grid-head">
          <span class="grid-title">点击题号直接跳转</span>
          <span class="grid-stats">
            <span class="legend"><span class="dot s-correct"></span>对</span>
            <span class="legend"><span class="dot s-wrong"></span>错</span>
            <span class="legend"><span class="dot s-draft"></span>草稿</span>
            <span class="legend"><span class="dot s-unanswered"></span>未答</span>
          </span>
        </div>
        <!-- 分页控制（仅在题目数量超过 PAGE_SIZE 时显示） -->
        <div v-if="totalPages > 1" class="pagination">
          <button class="page-btn" :disabled="currentPage <= 0" @click="goToPage(currentPage - 1)">
            ‹
          </button>
          <span class="page-info">{{ currentPage + 1 }} / {{ totalPages }}</span>
          <button
            class="page-btn"
            :disabled="currentPage >= totalPages - 1"
            @click="goToPage(currentPage + 1)"
          >
            ›
          </button>
        </div>
        <div class="grid">
          <button
            v-for="i in pageRange.end - pageRange.start"
            :key="`g-${pageRange.start + i - 1}`"
            class="gcell"
            :class="[
              `s-${statusOf(pageRange.start + i - 1)}`,
              { active: pageRange.start + i - 1 === currentIndex },
            ]"
            :aria-current="pageRange.start + i - 1 === currentIndex ? 'true' : undefined"
            @click="pick(pageRange.start + i - 1)"
          >
            <span class="gnum">{{ labelAt(pageRange.start + i - 1) }}</span>
            <span class="gmark">{{
              statusOf(pageRange.start + i - 1) === 'correct'
                ? '✓'
                : statusOf(pageRange.start + i - 1) === 'wrong'
                  ? '✗'
                  : statusOf(pageRange.start + i - 1) === 'draft'
                    ? '·'
                    : ''
            }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.navigator {
  position: relative;
  margin: 6px 0 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.expand-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px 10px;
  height: 30px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 12px;
  transition:
    border-color 0.22s var(--ease-ink),
    color 0.22s var(--ease-ink),
    background 0.22s var(--ease-ink);
}
.expand-btn:hover,
.expand-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}
.expand-icon {
  font-size: 13px;
  line-height: 1;
  transition: transform 0.22s;
}
.expand-icon.rotated {
  transform: rotate(90deg);
}
.expand-text {
  letter-spacing: 0.04em;
}
.expand-pos {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 12px;
  padding-left: 6px;
  margin-left: 2px;
  border-left: 1px solid var(--border);
}
.expand-pos .cur {
  color: var(--accent);
}
.expand-pos .sep {
  opacity: 0.5;
  margin: 0 2px;
}

.grid-drawer {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: 0 12px 28px -10px rgba(0, 0, 0, 0.18);
  padding: 12px 12px 10px;
  z-index: 20;
  max-height: min(60vh, 460px);
  overflow-y: auto;
}
.grid-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.grid-title {
  font-weight: 500;
}
.grid-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
}
.legend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
}
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.dot.s-correct {
  background: var(--correct);
}
.dot.s-wrong {
  background: var(--wrong);
}
.dot.s-draft {
  background: color-mix(in srgb, var(--accent) 60%, transparent);
}
.dot.s-unanswered {
  background: var(--bg-hover);
  border: 1px solid var(--border);
}

.grid {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 4px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}
.page-btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition:
    border-color 0.18s var(--ease-ink),
    color 0.18s var(--ease-ink);
}
.page-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.page-info {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.gcell {
  position: relative;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  padding: 2px;
  transition:
    transform 0.2s var(--ease-ink),
    border-color 0.2s var(--ease-ink),
    background 0.2s var(--ease-ink),
    color 0.2s var(--ease-ink);
}
.gcell:hover {
  transform: scale(1.1);
  border-color: var(--accent);
  color: var(--accent);
  z-index: 1;
}
.gnum {
  line-height: 1;
}
.gmark {
  position: absolute;
  top: 0;
  right: 2px;
  font-size: 8px;
  line-height: 1;
  opacity: 0.85;
}
.gcell.s-correct {
  background: color-mix(in srgb, var(--correct) 14%, transparent);
  border-color: color-mix(in srgb, var(--correct) 50%, transparent);
  color: var(--correct);
}
.gcell.s-wrong {
  background: color-mix(in srgb, var(--wrong) 14%, transparent);
  border-color: color-mix(in srgb, var(--wrong) 50%, transparent);
  color: var(--wrong);
}
.gcell.s-draft {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent) 38%, transparent);
  color: var(--accent);
}
.gcell.active {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* drawer transition */
.drawer-enter-active {
  transition:
    transform 0.26s var(--ease-drawer),
    opacity 0.2s var(--ease-ink);
  transform-origin: top left;
}
.drawer-leave-active {
  transition:
    transform 0.18s var(--ease-ink),
    opacity 0.14s var(--ease-ink);
  transform-origin: top left;
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateY(-10px) scaleY(0.9);
  opacity: 0;
}

@media (max-width: 480px) {
  .expand-btn {
    height: 28px;
    padding: 4px 10px 4px 8px;
    font-size: 11px;
  }
  .grid {
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 3px;
  }
  .gcell {
    font-size: 11px;
  }
  .gmark {
    font-size: 7px;
  }
}
</style>
