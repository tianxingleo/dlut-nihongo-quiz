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
      <div class="nav-brand" @click="router.push('/')">题库</div>
      <div class="category-switch">
        <button
          :class="['cat-btn', { active: activeCategory === 'grammar' }]"
          @click="switchCategory('grammar')"
        >语法</button>
        <button
          :class="['cat-btn', { active: activeCategory === 'word' }]"
          @click="switchCategory('word')"
        >单词</button>
        <button
          :class="['cat-btn', { active: activeCategory === 'history' }]"
          @click="switchCategory('history')"
        >近代史</button>
        <button
          :class="['cat-btn', { active: activeCategory === 'party' }]"
          @click="switchCategory('party')"
        >党史</button>
        <button
          :class="['cat-btn', { active: activeCategory === 'military' }]"
          @click="switchCategory('military')"
        >军事理论</button>
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
      <router-view v-slot="{ Component }">
        <transition name="page-fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>
<style scoped>
.app-shell { min-height: 100vh; }

/* Nav — thin bar, editorial feel */
.nav {
  display: flex; align-items: center; gap: 14px; padding: 0 24px;
  height: 44px; background: var(--bg-card); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 100;
  overflow: hidden;
}
.nav-brand {
  font-family: var(--font-display); font-size: 17px; font-weight: 700;
  cursor: pointer; color: var(--text-primary); white-space: nowrap;
  flex-shrink: 0; letter-spacing: 1px; user-select: none;
}
.category-switch { display: flex; gap: 2px; flex-shrink: 0; }
.cat-btn {
  padding: 3px 8px; border: none; background: transparent;
  color: var(--text-secondary); font-size: 13px; transition: color .15s;
  white-space: nowrap; position: relative;
}
.cat-btn:hover { color: var(--text-primary); }
.cat-btn.active { color: var(--accent); font-weight: 500; }

.nav-links { display: flex; gap: 4px; margin-left: auto; flex-shrink: 0; }
.nav-links a {
  padding: 4px 8px; text-decoration: none; color: var(--text-secondary);
  font-size: 13px; transition: color .15s; white-space: nowrap;
  border-radius: 2px;
}
.nav-links a:hover { color: var(--text-primary); background: var(--bg-hover); }
.nav-links a.router-link-active { color: var(--accent); font-weight: 500; }

.main { padding: 32px 24px; max-width: 1100px; margin: 0 auto; }

/* Page transition */
.page-fade-enter-active, .page-fade-leave-active { transition: opacity .15s, transform .15s; }
.page-fade-enter-from { opacity: 0; transform: translateY(4px); }
.page-fade-leave-to { opacity: 0; transform: translateY(-4px); }

@media (max-width: 640px) {
  .nav { gap: 8px; padding: 0 14px; overflow-x: auto; }
  .nav-brand { font-size: 15px; }
  .cat-btn { padding: 2px 5px; font-size: 12px; }
  .nav-links a { padding: 3px 5px; font-size: 12px; }
  .main { padding: 20px 16px; }
}
</style>
