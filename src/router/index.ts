import { createRouter, createWebHashHistory } from 'vue-router'
import { findEntry } from '../config/entries'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'landing', component: () => import('../pages/LandingPage.vue') },
    { path: '/home', name: 'home', component: () => import('../pages/HomePage.vue') },
    { path: '/quiz', name: 'quiz', component: () => import('../pages/QuizPage.vue') },
    { path: '/wrong', name: 'wrong', component: () => import('../pages/WrongBookPage.vue') },
    {
      path: '/bookmarks',
      name: 'bookmarks',
      component: () => import('../pages/BookmarksPage.vue'),
    },
    { path: '/history', name: 'history', component: () => import('../pages/HistoryPage.vue') },
    { path: '/analysis', name: 'analysis', component: () => import('../pages/AnalysisPage.vue') },
    { path: '/settings', name: 'settings', component: () => import('../pages/SettingsPage.vue') },
    {
      path: '/grammar-notes',
      name: 'grammar-notes',
      component: () => import('../pages/GrammarNotesPage.vue'),
    },
    {
      path: '/calculus-notes',
      name: 'calculus-notes',
      component: () => import('../pages/CalculusNotesPage.vue'),
    },
    {
      path: '/digital-circuit-notes',
      name: 'digital-circuit-notes',
      component: () => import('../pages/DigitalCircuitNotesPage.vue'),
    },
    {
      path: '/physics-notes',
      name: 'physics-notes',
      component: () => import('../pages/PhysicsNotesPage.vue'),
    },
    {
      path: '/listening-speaking-notes',
      name: 'listening-speaking-notes',
      component: () => import('../pages/ListeningSpeakingNotesPage.vue'),
    },
    {
      path: '/hidden-portal',
      name: 'hidden-portal',
      component: () => import('../pages/HiddenPortal.vue'),
    },
    // 入口卡（学科/试卷集合）的二级页：路径就是入口 key，清单由 src/config/entries.ts 决定。
    // 放在所有静态路由之后；不认识的 key 直接回首页（而不是掉进 404 兜底）。
    {
      path: '/:entryKey',
      name: 'entry',
      component: () => import('../pages/LandingPage.vue'),
      beforeEnter: (to) => (findEntry(to.params.entryKey as string) ? true : { path: '/' }),
    },
    // 兜底：未知路径渲染 404 页，避免主区域空白
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../pages/NotFoundPage.vue'),
    },
  ],
})

export default router
