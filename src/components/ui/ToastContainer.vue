<script setup lang="ts">
import { useToast } from '../../composables/useToast'

const { toasts, removeToast } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="toast-container" aria-live="polite">
      <TransitionGroup name="toast-slide">
        <div
          v-for="t in toasts"
          :key="t.id"
          :class="['toast-item', `toast-${t.type}`]"
          role="status"
          @click="removeToast(t.id)"
        >
          {{ t.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.toast-item {
  padding: 10px 20px;
  font-size: 14px;
  color: #fff;
  background: var(--text-primary);
  border: 1px solid var(--border);
  cursor: pointer;
  pointer-events: auto;
  max-width: 360px;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}
.toast-success {
  background: var(--correct);
  border-color: var(--correct);
}
.toast-error {
  background: var(--wrong);
  border-color: var(--wrong);
}
.toast-slide-enter-active {
  transition:
    transform 0.25s var(--ease-ink),
    opacity 0.2s var(--ease-ink);
}
.toast-slide-leave-active {
  transition:
    transform 0.2s var(--ease-ink),
    opacity 0.15s var(--ease-ink);
}
.toast-slide-enter-from,
.toast-slide-leave-to {
  transform: translateY(12px);
  opacity: 0;
}
</style>
