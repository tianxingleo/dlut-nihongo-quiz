<script setup lang="ts">
import MarkdownNotesPage from '../components/MarkdownNotesPage.vue'
import rawNotes from '../content/grammar-notes.md?raw'
</script>
<template>
  <MarkdownNotesPage title="核心语法整理" chip="第 26–36 课 + 查漏补缺" :source="rawNotes" />
</template>
