<script setup lang="ts">
import MarkdownNotesPage from '../components/notes/MarkdownNotesPage.vue'
import rawNotes from '../content/physics-notes.md?raw'
</script>
<template>
  <MarkdownNotesPage
    title="大学物理1 · 复习笔记"
    chip="期末冲刺"
    :source="rawNotes"
    enable-katex
    footer-note="覆盖力学、振动与波、相对论、静电场 · 含考试范围与不考内容标注"
  />
</template>
