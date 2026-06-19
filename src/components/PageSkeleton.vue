<script setup lang="ts">
defineProps<{
  type: 'card' | 'list' | 'detail'
}>()
</script>
<template>
  <div :class="['skeleton', `skeleton--${type}`]">
    <!-- Detail skeleton (question page) -->
    <template v-if="type === 'detail'">
      <div class="sk-progress">
        <div class="sk-bar"></div>
      </div>
      <div class="sk-mode"></div>
      <div class="sk-stem">
        <div class="sk-line sk-line--full"></div>
        <div class="sk-line sk-line--long"></div>
        <div class="sk-line sk-line--medium"></div>
      </div>
      <div class="sk-options">
        <div v-for="i in 4" :key="i" class="sk-option">
          <div class="sk-opt-label"></div>
          <div class="sk-opt-text"></div>
        </div>
      </div>
      <div class="sk-submit"></div>
    </template>

    <!-- Card skeleton (dashboard / home) -->
    <template v-if="type === 'card'">
      <div class="sk-card-header">
        <div class="sk-line sk-line--medium"></div>
      </div>
      <div class="sk-card-body">
        <div class="sk-line sk-line--full"></div>
        <div class="sk-line sk-line--long"></div>
        <div class="sk-line sk-line--short"></div>
      </div>
      <div class="sk-card-stats">
        <div class="sk-stat-box" v-for="i in 4" :key="i">
          <div class="sk-line sk-line--short"></div>
          <div class="sk-line sk-line--xshort"></div>
        </div>
      </div>
      <div class="sk-card-actions">
        <div class="sk-btn"></div>
        <div class="sk-btn"></div>
      </div>
    </template>

    <!-- List skeleton (analysis page) -->
    <template v-if="type === 'list'">
      <div class="sk-list">
        <div v-for="i in 6" :key="i" class="sk-row">
          <div class="sk-circle"></div>
          <div class="sk-row-content">
            <div class="sk-line sk-line--full"></div>
            <div class="sk-line sk-line--medium"></div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
<style scoped>
.skeleton {
  padding: 16px 0;
}

/* Shimmer animation */
@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

.sk-line,
.sk-bar,
.sk-opt-label,
.sk-opt-text,
.sk-btn,
.sk-circle {
  background: linear-gradient(
    90deg,
    var(--bg-hover) 25%,
    color-mix(in srgb, var(--bg-hover) 60%, var(--bg-card)) 50%,
    var(--bg-hover) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: 2px;
}

.sk-line {
  height: 12px;
  margin-bottom: 8px;
}

.sk-line--xshort {
  width: 20%;
}
.sk-line--short {
  width: 30%;
}
.sk-line--medium {
  width: 55%;
}
.sk-line--long {
  width: 75%;
}
.sk-line--full {
  width: 90%;
}

/* Progress bar skeleton (detail) */
.sk-progress {
  margin-bottom: 16px;
}
.sk-bar {
  height: 4px;
  width: 100%;
  border-radius: 0;
}

.sk-mode {
  height: 12px;
  width: 40%;
  margin-bottom: 24px;
  background: linear-gradient(
    90deg,
    var(--bg-hover) 25%,
    color-mix(in srgb, var(--bg-hover) 60%, var(--bg-card)) 50%,
    var(--bg-hover) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: 2px;
}

/* Stem */
.sk-stem {
  padding: 20px 0;
  margin-bottom: 12px;
}

/* Options */
.sk-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 24px;
}

.sk-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border);
}

.sk-opt-label {
  width: 28px;
  height: 28px;
  border-radius: 2px;
  flex-shrink: 0;
}

.sk-opt-text {
  flex: 1;
  height: 14px;
  border-radius: 2px;
}

/* Submit button */
.sk-submit {
  width: 120px;
  height: 40px;
  border-radius: 2px;
}

/* Card skeleton */
.sk-card-header {
  margin-bottom: 16px;
}
.sk-card-body {
  margin-bottom: 20px;
}
.sk-card-stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.sk-stat-box {
  flex: 1;
  min-width: 80px;
  padding: 16px 20px;
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sk-card-actions {
  display: flex;
  gap: 8px;
}
.sk-btn {
  width: 100px;
  height: 36px;
  border-radius: 2px;
}

/* List skeleton */
.sk-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sk-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--border);
}

.sk-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sk-row-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}
</style>
