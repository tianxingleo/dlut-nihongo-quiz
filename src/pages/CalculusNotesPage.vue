<script setup lang="ts">
import MarkdownNotesPage from '../components/MarkdownNotesPage.vue'
import rawNotes from '../content/calculus-notes.md?raw'
</script>
<template>
  <MarkdownNotesPage title="微积分2 · 核心笔记" chip="第 1–18 课" :source="rawNotes" enable-katex />
</template>
