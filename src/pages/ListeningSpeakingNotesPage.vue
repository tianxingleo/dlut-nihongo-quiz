<script setup lang="ts">
import MarkdownNotesPage from '../components/notes/MarkdownNotesPage.vue'
import rawNotes from '../content/listening-speaking-notes.md?raw'
</script>
<template>
  <MarkdownNotesPage
    title="日语听说进阶 · 单词表"
    chip="大一下"
    :source="rawNotes"
    footer-note="覆盖职场、通勤、日常生活、传统文化等场景 · 含易混词辨析"
  />
</template>
