<script setup lang="ts">
defineProps<{ label: string; value: string | number; sub?: string }>()
</script>
<template>
  <div class="stat-card">
    <div class="stat-value">{{ value }}</div>
    <div class="stat-label">{{ label }}</div>
    <div v-if="sub" class="stat-sub">{{ sub }}</div>
  </div>
</template>
<style scoped>
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 16px 20px;
  min-width: 100px;
  flex: 1;
  transition:
    border-color 0.22s var(--ease-ink),
    transform 0.22s var(--ease-ink);
}
.stat-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}
.stat-value {
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: 600;
  color: var(--accent);
  line-height: 1.1;
  letter-spacing: 0.5px;
  transition: color 0.22s var(--ease-ink);
}
.stat-card:hover .stat-value {
  color: var(--accent-hover);
}
.stat-label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 6px;
}
.stat-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}
</style>
