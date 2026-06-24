<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  current: number
  total: number
  correct: number
  /** 0-based index of current question (defaults to current-1) */
  currentIndex?: number
  /** Number of questions answered so far (for accuracy calculation) */
  answered?: number
}>()

const emit = defineEmits<{ scrub: [idx: number] }>()

const trackRef = ref<HTMLElement | null>(null)
const dragging = ref(false)
const dragRatio = ref(0) // continuous 0–1 during drag (无极)

const curIdx = computed(() => props.currentIndex ?? Math.max(0, props.current - 1))
const denominator = computed(() => Math.max(1, props.total - 1))
const pct = computed(() => {
  if (dragging.value) return dragRatio.value * 100
  return (curIdx.value / denominator.value) * 100
})
const previewIdx = computed(() => {
  if (!dragging.value) return curIdx.value
  const raw = Math.round(dragRatio.value * denominator.value)
  return Math.max(0, Math.min(props.total - 1, raw))
})
const previewLabel = computed(() => `第 ${previewIdx.value + 1} 题 / 共 ${props.total} 题`)

const accuracy = computed(() => {
  const answered = props.answered ?? 0
  if (answered === 0) return null
  return Math.round((props.correct / answered) * 100)
})

function ratioFromX(clientX: number): number {
  const el = trackRef.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
  return rect.width > 0 ? x / rect.width : 0
}

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (props.total <= 1) return
  dragging.value = true
  dragRatio.value = ratioFromX(e.clientX)
  ;(trackRef.value as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  dragRatio.value = ratioFromX(e.clientX)
}

function onPointerUp(_e: PointerEvent) {
  if (!dragging.value) return
  const target = previewIdx.value
  dragging.value = false
  emit('scrub', target)
}
</script>

<template>
  <div class="progress-wrap" :class="{ dragging }">
    <div
      ref="trackRef"
      class="progress-bar"
      :class="{ dragging }"
      role="progressbar"
      :aria-valuenow="current"
      aria-valuemin="0"
      :aria-valuemax="total"
      :aria-label="`第 ${current} 题，共 ${total} 题`"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="fill" :style="{ width: pct + '%' }" />
      <div class="thumb" :style="{ left: pct + '%' }" />
      <Transition name="tip">
        <div v-if="dragging" class="tooltip" :style="{ left: pct + '%' }">
          <span class="tip-text">{{ previewLabel }}</span>
          <span class="tip-arrow" aria-hidden="true"></span>
        </div>
      </Transition>
    </div>
    <span class="progress-text">
      <span class="pos">{{ current }}</span>
      <span class="sep">/</span>
      <span class="total">{{ total }}</span>
      <span class="sep sep-dot">·</span>
      <span class="correct">对 {{ correct }}</span>
      <span v-if="accuracy !== null" class="accuracy">({{ accuracy }}%)</span>
    </span>
  </div>
</template>

<style scoped>
.progress-wrap {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
}
.progress-bar {
  flex: 1;
  height: 14px;
  position: relative;
  cursor: pointer;
  display: flex;
  align-items: center;
  touch-action: none;
}
.progress-bar::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--bg-hover);
  border-radius: 2px;
}
.progress-bar.dragging {
  cursor: grabbing;
}
.fill {
  position: absolute;
  left: 0;
  height: 4px;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s var(--ease-drawer);
  pointer-events: none;
}
.progress-bar.dragging .fill {
  transition: none;
}
.thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  border-radius: 50%;
  background: var(--accent);
  transform: translateY(-50%) scale(1);
  transition:
    transform 0.2s var(--ease-ink),
    left 0.3s var(--ease-drawer);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 30%, transparent);
  pointer-events: none;
}
.progress-bar:hover .thumb {
  transform: translateY(-50%) scale(1.18);
}
.progress-bar.dragging .thumb {
  transform: translateY(-50%) scale(1.35);
  transition: transform 0.15s var(--ease-ink);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 18%, transparent);
}

.tooltip {
  position: absolute;
  top: -8px;
  transform: translate(-50%, -100%);
  background: var(--text-primary);
  color: var(--bg-card);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
  font-family: var(--font-mono);
}
.tip-arrow {
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 8px;
  height: 8px;
  background: var(--text-primary);
}

.tip-enter-active {
  transition:
    transform 0.2s var(--ease-brush),
    opacity 0.18s var(--ease-ink);
}
.tip-leave-active {
  transition:
    transform 0.15s var(--ease-ink),
    opacity 0.12s var(--ease-ink);
}
.tip-enter-from,
.tip-leave-to {
  transform: translate(-50%, -90%);
  opacity: 0;
}

.progress-text {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  font-family: var(--font-mono);
}
.progress-text .pos {
  color: var(--accent);
  font-weight: 700;
}
.progress-text .sep {
  opacity: 0.5;
  margin: 0 2px;
}
.progress-text .sep-dot {
  margin: 0 6px 0 8px;
}
.progress-text .accuracy {
  color: var(--text-muted);
  margin-left: 4px;
}

@media (max-width: 480px) {
  .progress-wrap {
    gap: 10px;
  }
  .progress-text {
    font-size: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fill,
  .thumb {
    transition: none;
  }
}
</style>
