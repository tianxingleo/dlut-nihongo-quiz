<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useActiveCategory, loadActiveCategory, setActiveCategory } from './services/categoryStore'
import type { Category } from './types/question'

const router = useRouter()
const activeCategory = useActiveCategory()

onMounted(async () => {
  await loadActiveCategory()
})

function switchCategory(cat: Category) {
  if (cat === activeCategory.value) return
  setActiveCategory(cat)
  router.push('/')
}
</script>
<template>
  <div class="app-shell">
    <nav class="nav">
      <div class="nav-brand" @click="router.push('/')">日语题库</div>
      <div class="category-switch">
        <button
          :class="['cat-btn', { active: activeCategory === 'grammar' }]"
          @click="switchCategory('grammar')"
        >📝 语法题</button>
        <button
          :class="['cat-btn', { active: activeCategory === 'word' }]"
          @click="switchCategory('word')"
        >📖 单词题</button>
      </div>
      <div class="nav-links">
        <router-link to="/">首页</router-link>
        <router-link to="/quiz">刷题</router-link>
        <router-link to="/wrong">错题本</router-link>
        <router-link to="/analysis">分析</router-link>
        <router-link to="/settings">设置</router-link>
      </div>
    </nav>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>
<style scoped>
.app-shell { min-height: 100vh; }
.nav {
  display: flex; align-items: center; gap: 16px; padding: 0 20px;
  height: 52px; background: var(--bg-card); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 100;
  overflow: hidden;
}
.nav-brand {
  font-size: 17px; font-weight: 700; cursor: pointer; color: var(--text-primary);
  white-space: nowrap; flex-shrink: 0;
}
.category-switch { display: flex; gap: 4px; flex-shrink: 0; }
.cat-btn {
  padding: 6px 12px; border-radius: 7px; border: 1px solid var(--border);
  background: transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer; transition: all .2s;
  white-space: nowrap;
}
.cat-btn:hover { background: var(--bg-hover); }
.cat-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.nav-links { display: flex; gap: 2px; margin-left: auto; flex-shrink: 0; }
.nav-links a {
  padding: 7px 12px; border-radius: 7px; text-decoration: none; color: var(--text-secondary);
  font-size: 13px; transition: all .2s; white-space: nowrap;
}
.nav-links a:hover, .nav-links a.router-link-active { background: var(--bg-hover); color: var(--accent); }
.main { padding: 20px 24px; max-width: 1100px; margin: 0 auto; }

@media (max-width: 600px) {
  .nav { gap: 8px; padding: 0 12px; overflow-x: auto; }
  .nav-brand { font-size: 15px; }
  .cat-btn { padding: 4px 8px; font-size: 12px; }
  .nav-links { gap: 1px; }
  .nav-links a { padding: 5px 8px; font-size: 12px; }
  .main { padding: 16px; }
}

@media (max-width: 430px) {
  .nav { gap: 6px; padding: 0 8px; }
  .nav-brand { font-size: 14px; }
  .cat-btn { padding: 3px 6px; font-size: 11px; }
  .nav-links a { padding: 4px 6px; font-size: 11px; }
}
</style>
