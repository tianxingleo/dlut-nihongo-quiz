<script setup lang="ts">
defineProps<{ tag: string; active?: boolean; clickable?: boolean }>()
defineEmits<{ click: [tag: string] }>()
</script>
<template>
  <span class="tag-badge" :class="{ active, clickable }" @click="clickable && $emit('click', tag)">
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
  transition: all 0.15s;
  border: 1px solid transparent;
  line-height: 1.5;
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
}
</style>
