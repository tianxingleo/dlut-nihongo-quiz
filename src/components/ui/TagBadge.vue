<script setup lang="ts">
defineProps<{ tag: string; active?: boolean; clickable?: boolean }>()
defineEmits<{ click: [tag: string] }>()
</script>
<template>
  <span
    class="tag-badge"
    :class="{ active, clickable }"
    :role="clickable ? 'button' : undefined"
    :tabindex="clickable ? 0 : undefined"
    @click="clickable && $emit('click', tag)"
    @keydown.enter="clickable && $emit('click', tag)"
    @keydown.space.prevent="clickable && $emit('click', tag)"
  >
    {{ tag }}
  </span>
</template>
<style scoped>
.tag-badge {
  display: inline-block;
  padding: 4px 12px;
  font-size: 13px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  margin: 2px 4px 2px 0;
  transition:
    background 0.2s var(--ease-ink),
    color 0.2s var(--ease-ink),
    border-color 0.2s var(--ease-ink),
    transform 0.2s var(--ease-ink);
  border: 1px solid transparent;
  line-height: 1.5;
  max-width: 100%;
  overflow-wrap: break-word;
  word-break: break-word;
}
.tag-badge.active {
  background: var(--accent);
  color: #fff;
}
.tag-badge.clickable {
  cursor: pointer;
}
.tag-badge.clickable:hover {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  transform: translateY(-1px);
}
.tag-badge.clickable:active {
  transform: translateY(0) scale(0.97);
}
</style>
