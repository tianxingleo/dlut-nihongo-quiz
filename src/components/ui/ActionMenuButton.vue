<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface MenuItem {
  key: string
  label: string
  value: boolean
}

const props = withDefaults(
  defineProps<{
    label: string
    items: MenuItem[]
    variant?: 'default' | 'danger'
    size?: 'md' | 'sm'
    disabled?: boolean
  }>(),
  {
    variant: 'default',
    size: 'md',
    disabled: false,
  },
)

const emit = defineEmits<{ select: [value: boolean] }>()

const isOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)

function toggle() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
}

function close() {
  isOpen.value = false
}

function pick(item: MenuItem) {
  emit('select', item.value)
  close()
}

function onDocumentClick(e: MouseEvent) {
  if (!isOpen.value) return
  const target = e.target as Node | null
  if (rootRef.value && target && !rootRef.value.contains(target)) {
    close()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) close()
}

function onScroll() {
  if (isOpen.value) close()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', onScroll, true)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', onScroll, true)
})
</script>

<template>
  <div ref="rootRef" class="action-menu">
    <button
      class="btn"
      :class="[
        variant === 'danger' ? 'btn-outline danger' : 'btn-outline',
        size === 'sm' ? 'btn-sm' : '',
        { 'menu-open': isOpen },
      ]"
      :disabled="disabled"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <span class="action-label">{{ label }}</span>
      <span class="action-caret" aria-hidden="true">▾</span>
    </button>
    <Transition name="panel">
      <div v-if="isOpen" class="action-menu__panel" role="menu">
        <button
          v-for="item in items"
          :key="item.key"
          class="action-menu__item"
          role="menuitem"
          @click="pick(item)"
        >
          {{ item.label }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.action-menu {
  position: relative;
  display: inline-block;
}

.action-caret {
  margin-left: 6px;
  font-size: 0.85em;
  opacity: 0.7;
  transition: transform 0.18s var(--ease-ink);
}
.menu-open .action-caret {
  transform: rotate(180deg);
}

.action-menu__panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: 0 8px 24px -10px rgba(0, 0, 0, 0.18);
  z-index: 50;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.action-menu__item {
  display: block;
  width: 100%;
  padding: 8px 16px;
  text-align: left;
  background: transparent;
  border: 0;
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  transition:
    background 0.18s var(--ease-ink),
    color 0.18s var(--ease-ink);
}

.action-menu__item:hover {
  background: var(--bg-hover);
  color: var(--accent);
}

.panel-enter-active,
.panel-leave-active {
  transition:
    opacity 0.18s var(--ease-ink),
    transform 0.18s var(--ease-ink);
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 640px) {
  .action-menu__item {
    padding: 10px 18px;
    font-size: 14px;
  }
}
</style>
