<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  useActiveCategory,
  loadActiveCategory,
  setActiveCategory,
  setActiveSubBankKey,
  useActiveSubBankKey,
} from './services/categoryStore'
import { getQuestionById } from './services/quizEngine'
import { COURSE_TREE } from './config/courseTree'
import { useHiddenSite } from './composables/useHiddenSite'
import type { Category } from './types/question'
import SearchOverlay from './components/SearchOverlay.vue'
import TreeNav from './components/TreeNav.vue'

const router = useRouter()
const route = useRoute()
const routeKey = ref(0)
const activeCategory = useActiveCategory()
const activeSubBank = useActiveSubBankKey()
const searchOpen = ref(false)
const drawerOpen = ref(false)

const { isUnlocked, unlockProgress, startLongPress, cancelLongPress, lock } = useHiddenSite()

function exitHidden() {
  lock()
}

let pressStartX = 0
let pressStartY = 0
function onPressStart(e: MouseEvent | TouchEvent) {
  if (e instanceof MouseEvent) {
    pressStartX = e.clientX
    pressStartY = e.clientY
  } else {
    const t = e.touches[0]
    pressStartX = t.clientX
    pressStartY = t.clientY
  }
  startLongPress()
}
function onPressMove(e: MouseEvent | TouchEvent) {
  let x: number, y: number
  if (e instanceof MouseEvent) {
    x = e.clientX
    y = e.clientY
  } else {
    x = e.touches[0].clientX
    y = e.touches[0].clientY
  }
  if (Math.abs(x - pressStartX) > 10 || Math.abs(y - pressStartY) > 10) {
    cancelLongPress()
  }
}
function onPressEnd() {
  if (unlockProgress.value < 100) {
    cancelLongPress()
  }
}

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

function navigateTo(path: string) {
  drawerOpen.value = false
  if (route.path === path) {
    routeKey.value++
  }
  router.push(path)
}

function openSearch() {
  searchOpen.value = true
  drawerOpen.value = false
}

async function onSelectLeaf(payload: {
  category: Category
  subBank: string | null
  route?: string
}) {
  drawerOpen.value = false
  if (payload.route) {
    if (route.path === payload.route) routeKey.value++
    router.push(payload.route)
    return
  }
  if (payload.category !== activeCategory.value) {
    await setActiveCategory(payload.category)
  }
  // 始终设置 subBank（包括 null），切换同 category 内的子题库
  setActiveSubBankKey(payload.subBank)
  if (route.path === '/home') {
    routeKey.value++
  }
  router.push('/home')
}

async function handleSearchNavigate(questionId: string) {
  searchOpen.value = false
  drawerOpen.value = false
  const q = getQuestionById(questionId)
  if (!q) return
  if (q.category !== activeCategory.value) {
    await setActiveCategory(q.category)
  }
  router.push({ path: '/quiz', query: { ids: questionId, fresh: '1' } })
}
</script>
<template>
  <div class="app-shell">
    <nav class="nav">
      <div class="nav-left">
        <button
          class="nav-drawer-btn"
          @click="drawerOpen = !drawerOpen"
          :aria-expanded="drawerOpen"
          aria-label="课程菜单"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        <div class="nav-brand" @click="router.push('/')">题库</div>
      </div>
      <div class="nav-desktop-links">
        <a
          v-for="l in navLinks"
          :key="l.to"
          :class="{ 'router-link-active': route.path === l.to }"
          href="#"
          @click.prevent="navigateTo(l.to)"
          >{{ l.label }}</a
        >
        <button class="search-trigger" @click="searchOpen = true">⌕ 搜索</button>
      </div>
      <div class="nav-right-mobile">
        <button class="nav-search-icon" @click="searchOpen = true" aria-label="搜索">⌕</button>
      </div>
    </nav>

    <Transition name="drawer">
      <div v-if="drawerOpen" class="drawer-backdrop" @click="drawerOpen = false">
        <div class="drawer-panel" @click.stop>
          <div class="drawer-header">
            <span class="drawer-title">课程导航</span>
            <button class="drawer-close" @click="drawerOpen = false" aria-label="关闭">✕</button>
          </div>
          <div class="drawer-body">
            <div class="drawer-section">
              <div class="drawer-section-title">主导航</div>
              <div class="drawer-nav-links">
                <a
                  v-for="l in navLinks"
                  :key="l.to"
                  :class="{ 'router-link-active': route.path === l.to }"
                  href="#"
                  @click.prevent="navigateTo(l.to)"
                  >{{ l.label }}</a
                >
                <button class="mobile-search-trigger" @click="openSearch">⌕ 搜索题目</button>
              </div>
            </div>
            <div class="drawer-section">
              <div class="drawer-section-title">题库</div>
              <TreeNav
                :nodes="COURSE_TREE"
                :active-category="activeCategory"
                :active-sub-bank="activeSubBank"
                :current-route="route.path"
                :is-unlocked="isUnlocked"
                @select-leaf="onSelectLeaf"
              />
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <main class="main">
      <router-view v-slot="{ Component }">
        <transition name="page-fade" mode="out-in">
          <component :is="Component" :key="routeKey" />
        </transition>
      </router-view>
    </main>
    <footer class="app-footer">
      <div class="footer-inner">
        <span
          class="footer-copyright"
          @mousedown="onPressStart"
          @mousemove="onPressMove"
          @mouseup="onPressEnd"
          @mouseleave="onPressEnd"
          @touchstart="onPressStart"
          @touchmove="onPressMove"
          @touchend="onPressEnd"
        >
          <span class="press-ring" :style="{ width: unlockProgress + '%' }"></span>
          题库 &copy; 2025 tianxingleo
        </span>
        <span class="footer-sep">·</span>
        <a href="https://github.com/tianxingleo/dlut-nihongo-quiz" target="_blank">GitHub</a>
        <span class="footer-sep">·</span>
        <span>Apache-2.0</span>
        <span class="footer-sep">·</span>
        <span>DLUT 国际信息与软件学院</span>
        <template v-if="isUnlocked">
          <span class="footer-sep">·</span>
          <button class="footer-exit-btn" @click="exitHidden">合上</button>
        </template>
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
}

.nav-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.nav-drawer-btn {
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: none;
  border: none;
  padding: 6px 4px;
  cursor: pointer;
  flex-shrink: 0;
}
.nav-drawer-btn span {
  display: block;
  width: 18px;
  height: 2px;
  background: var(--text-primary);
  transition: background 0.18s var(--ease-ink);
  border-radius: 1px;
}
.nav-drawer-btn:hover span {
  background: var(--accent);
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

.nav-desktop-links {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}
.nav-desktop-links a,
.nav-desktop-links button {
  padding: 4px 8px;
  text-decoration: none;
  color: var(--text-secondary);
  font-size: 13px;
  transition:
    color 0.18s var(--ease-ink),
    background 0.18s var(--ease-ink);
  white-space: nowrap;
  border-radius: 2px;
  position: relative;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
}
.nav-desktop-links a::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 2px;
  background: var(--accent);
  transform: scaleX(0);
  transition: transform 0.22s var(--ease-brush);
  transform-origin: left center;
}
.nav-desktop-links a:hover::after {
  transform: scaleX(1);
}
.nav-desktop-links a:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.nav-desktop-links a.router-link-active {
  color: var(--accent);
  font-weight: 500;
}
.nav-desktop-links a.router-link-active::after {
  transform: scaleX(1);
}

.search-trigger {
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.search-trigger:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.nav-right-mobile {
  display: none;
  margin-left: auto;
}
.nav-search-icon {
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

/* Drawer */
.drawer-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 200;
}
.drawer-panel {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(320px, 86vw);
  background: var(--bg-card);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.drawer-title {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--text-primary);
}
.drawer-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  line-height: 1;
}
.drawer-close:hover {
  color: var(--accent);
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0 20px;
}
.drawer-section {
  padding: 8px 12px;
}
.drawer-section + .drawer-section {
  border-top: 1px solid var(--border);
  margin-top: 8px;
  padding-top: 12px;
}
.drawer-section-title {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 1px;
  margin-bottom: 8px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 0 4px;
}
.drawer-nav-links {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.drawer-nav-links a,
.drawer-nav-links button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  font-size: 14px;
  color: var(--text-primary);
  text-decoration: none;
  background: none;
  border: none;
  font-family: inherit;
  cursor: pointer;
  border-radius: 3px;
  transition:
    background 0.15s var(--ease-ink),
    color 0.15s var(--ease-ink);
}
.drawer-nav-links a:hover,
.drawer-nav-links button:hover {
  background: var(--bg-hover);
}
.drawer-nav-links a.router-link-active {
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

/* Drawer transitions */
.drawer-enter-active {
  transition: opacity 0.18s var(--ease-page);
}
.drawer-leave-active {
  transition: opacity 0.14s var(--ease-ink);
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-active .drawer-panel {
  animation: drawer-slide-in 0.22s var(--ease-page) both;
}
.drawer-leave-active .drawer-panel {
  animation: drawer-slide-in 0.14s var(--ease-ink) both reverse;
}
@keyframes drawer-slide-in {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(0);
  }
}

.main {
  flex: 1;
  padding: 32px 24px;
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
}

.page-fade-enter-active {
  transition:
    opacity 0.22s var(--ease-page),
    transform 0.26s var(--ease-page);
}
.page-fade-leave-active {
  transition:
    opacity 0.14s var(--ease-ink),
    transform 0.16s var(--ease-ink);
}
.page-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .page-fade-enter-active,
  .page-fade-leave-active {
    transition: opacity 0.1s ease;
  }
  .page-fade-enter-from,
  .page-fade-leave-to {
    transform: none;
  }
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
.footer-exit-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-family: var(--font-display);
  font-size: 12px;
  letter-spacing: 2px;
  padding: 2px 10px;
  cursor: pointer;
  transition:
    color 0.18s var(--ease-ink),
    border-color 0.18s var(--ease-ink),
    background 0.18s var(--ease-ink);
}
.footer-exit-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

@media (max-width: 639px) {
  .nav {
    gap: 8px;
    padding: 0 12px;
  }
  .nav-desktop-links {
    display: none;
  }
  .nav-right-mobile {
    display: flex;
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
  }
  .nav-desktop-links a {
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

/* Hidden site entrance — long press trigger */
.footer-copyright {
  position: relative;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
  min-height: 44px;
  min-width: 44px;
  display: inline-flex;
  align-items: center;
  padding: 6px 4px;
}
.press-ring {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--accent);
  opacity: 0.6;
  transition: width 0.08s linear;
  pointer-events: none;
}
</style>
