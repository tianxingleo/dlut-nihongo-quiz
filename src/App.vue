<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useActiveCategory, loadActiveCategory, setActiveCategory } from './services/categoryStore'
import { getQuestionById } from './services/quizEngine'
import { CATEGORIES } from './config/categories'
import type { Category } from './types/question'
import SearchOverlay from './components/SearchOverlay.vue'

const router = useRouter()
const activeCategory = useActiveCategory()
const searchOpen = ref(false)
const mobileMenuOpen = ref(false)

const navLinks = [
  { to: '/', label: '首页' },
  { to: '/home', label: '仪表盘' },
  { to: '/quiz', label: '刷题' },
  { to: '/wrong', label: '错题本' },
  { to: '/analysis', label: '分析' },
  { to: '/settings', label: '设置' },
] as const

onMounted(async () => {
  await loadActiveCategory()
})

function switchCategory(cat: Category) {
  if (cat === activeCategory.value) return
  setActiveCategory(cat)
  router.push('/home')
  mobileMenuOpen.value = false
}

function handleSearchNavigate(questionId: string) {
  searchOpen.value = false
  mobileMenuOpen.value = false
  const q = getQuestionById(questionId)
  if (!q) return
  if (q.category !== activeCategory.value) {
    setActiveCategory(q.category)
  }
  router.push({ path: '/quiz', query: { ids: questionId } })
}

function openSearchFromMobile() {
  searchOpen.value = true
  mobileMenuOpen.value = false
}
</script>
<template>
  <div class="app-shell">
    <nav class="nav">
      <div class="nav-left">
        <div class="nav-brand" @click="router.push('/')">题库</div>
        <button class="nav-search-icon" @click="searchOpen = true" aria-label="搜索">⌕</button>
      </div>
      <div class="nav-desktop">
        <div class="category-switch">
          <button
            v-for="c in CATEGORIES"
            :key="c.key"
            :class="['cat-btn', { active: activeCategory === c.key }]"
            @click="switchCategory(c.key)"
          >
            {{ c.short }}
          </button>
        </div>
        <div class="nav-links">
          <router-link v-for="l in navLinks" :key="l.to" :to="l.to">{{ l.label }}</router-link>
          <button class="search-trigger" @click="searchOpen = true">⌕ 搜索</button>
        </div>
      </div>
      <button class="nav-hamburger" @click="mobileMenuOpen = !mobileMenuOpen" aria-label="菜单">
        <span></span>
        <span></span>
        <span></span>
      </button>
    </nav>

    <Transition name="nav-mobile">
      <div v-if="mobileMenuOpen" class="nav-mobile-backdrop" @click="mobileMenuOpen = false">
        <div class="nav-mobile-menu" @click.stop>
          <div class="nav-mobile-section">
            <div class="nav-mobile-section-title">导航</div>
            <router-link
              v-for="l in navLinks"
              :key="l.to"
              :to="l.to"
              @click="mobileMenuOpen = false"
              >{{ l.label }}</router-link
            >
            <button class="mobile-search-trigger" @click="openSearchFromMobile">⌕ 搜索题目</button>
          </div>
          <div class="nav-mobile-section">
            <div class="nav-mobile-section-title">切换题库</div>
            <button
              v-for="c in CATEGORIES"
              :key="c.key"
              :class="{ active: activeCategory === c.key }"
              @click="switchCategory(c.key)"
            >
              {{ c.short }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <main class="main">
      <router-view v-slot="{ Component }">
        <transition name="page-fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
    <footer class="app-footer">
      <div class="footer-inner">
        <span>题库 &copy; 2025 tianxingleo</span>
        <span class="footer-sep">·</span>
        <a href="https://github.com/tianxingleo/dlut-nihongo-quiz" target="_blank">GitHub</a>
        <span class="footer-sep">·</span>
        <span>Apache-2.0</span>
        <span class="footer-sep">·</span>
        <span>DLUT 国际信息与软件学院</span>
      </div>
    </footer>
  </div>

  <SearchOverlay
    :visible="searchOpen"
    @close="searchOpen = false"
    @navigate="handleSearchNavigate"
  />
</template>
<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.nav {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 24px;
  height: 44px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
  overflow: hidden;
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.nav-brand {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  cursor: pointer;
  color: var(--text-primary);
  white-space: nowrap;
  flex-shrink: 0;
  letter-spacing: 1px;
  user-select: none;
}

.nav-search-icon {
  display: none;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 20px;
  padding: 4px;
  cursor: pointer;
  line-height: 1;
}
.nav-search-icon:hover {
  color: var(--accent);
}

.nav-desktop {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
  min-width: 0;
}

.category-switch {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.cat-btn {
  padding: 3px 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  transition: color 0.15s;
  white-space: nowrap;
  position: relative;
}
.cat-btn:hover {
  color: var(--text-primary);
}
.cat-btn.active {
  color: var(--accent);
  font-weight: 500;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}
.nav-links a,
.nav-links button {
  padding: 4px 8px;
  text-decoration: none;
  color: var(--text-secondary);
  font-size: 13px;
  transition: color 0.15s;
  white-space: nowrap;
  border-radius: 2px;
}
.nav-links a {
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
}
.nav-links a:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.nav-links a.router-link-active {
  color: var(--accent);
  font-weight: 500;
}

.search-trigger {
  background: none;
  border: 1px solid var(--border);
  font-family: inherit;
  font-size: 13px;
  color: var(--text-muted);
  padding: 3px 8px;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}
.search-trigger:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.nav-hamburger {
  display: none;
  flex-direction: column;
  gap: 3px;
  background: none;
  border: none;
  padding: 6px;
  cursor: pointer;
  margin-left: auto;
  flex-shrink: 0;
}
.nav-hamburger span {
  display: block;
  width: 18px;
  height: 2px;
  background: var(--text-primary);
  transition: background 0.15s;
  border-radius: 1px;
}
.nav-hamburger:hover span {
  background: var(--accent);
}

.nav-mobile-backdrop {
  position: fixed;
  top: 44px;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.25);
  z-index: 99;
}
.nav-mobile-menu {
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  padding: 8px 0;
}
.nav-mobile-section {
  padding: 8px 16px;
}
.nav-mobile-section + .nav-mobile-section {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  margin-top: 4px;
}
.nav-mobile-section-title {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 1px;
  margin-bottom: 8px;
  font-weight: 600;
  text-transform: uppercase;
}
.nav-mobile-section a,
.nav-mobile-section button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--text-primary);
  text-decoration: none;
  background: none;
  border: none;
  font-family: inherit;
  cursor: pointer;
  border-radius: 2px;
  transition: background 0.1s;
}
.nav-mobile-section a:hover,
.nav-mobile-section button:hover {
  background: var(--bg-hover);
}
.nav-mobile-section a.router-link-active,
.nav-mobile-section button.active {
  color: var(--accent);
  font-weight: 500;
}

.mobile-search-trigger {
  color: var(--text-muted) !important;
  margin-top: 4px;
}
.mobile-search-trigger:hover {
  color: var(--accent) !important;
}

.nav-mobile-enter-active,
.nav-mobile-leave-active {
  transition: opacity 0.12s;
}
.nav-mobile-enter-from,
.nav-mobile-leave-to {
  opacity: 0;
}

.main {
  flex: 1;
  padding: 32px 24px;
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
}

.page-fade-enter-active,
.page-fade-leave-active {
  transition:
    opacity 0.15s,
    transform 0.15s;
}
.page-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.app-footer {
  padding: 20px 24px;
  border-top: 1px solid var(--border);
  background: var(--bg-card);
  margin-top: auto;
}
.footer-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-muted);
  flex-wrap: wrap;
}
.footer-inner a {
  color: var(--text-secondary);
}
.footer-inner a:hover {
  color: var(--accent);
  text-decoration: none;
}
.footer-sep {
  color: var(--border);
}

@media (max-width: 639px) {
  .nav {
    gap: 8px;
    padding: 0 12px;
  }
  .nav-hamburger {
    display: flex;
  }
  .nav-desktop {
    display: none;
  }
  .nav-search-icon {
    display: block;
  }
  .nav-brand {
    font-size: 15px;
  }
  .main {
    padding: 20px 16px;
  }
  .footer-inner {
    font-size: 12px;
    gap: 6px;
  }
}

@media (min-width: 640px) and (max-width: 768px) {
  .nav {
    gap: 8px;
    padding: 0 14px;
    overflow-x: auto;
  }
  .cat-btn {
    padding: 2px 5px;
    font-size: 12px;
  }
  .nav-links a {
    padding: 3px 5px;
    font-size: 12px;
  }
  .main {
    padding: 20px 16px;
  }
  .footer-inner {
    font-size: 12px;
    gap: 6px;
  }
}
</style>
