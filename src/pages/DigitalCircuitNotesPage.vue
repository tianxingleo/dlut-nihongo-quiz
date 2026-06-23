<script setup lang="ts">
import MarkdownNotesPage from '../components/notes/MarkdownNotesPage.vue'
import rawNotes from '../content/digital-circuit-notes.md?raw'
</script>
<template>
  <MarkdownNotesPage
    title="数字电路 · 英文术语整理"
    chip="Lesson 1—16"
    :source="rawNotes"
    footer-note="来源：数字电路课程 PPT（第 1—16 讲，15 个文件）"
  />
</template>
