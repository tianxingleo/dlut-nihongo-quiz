import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'landing', component: () => import('../pages/LandingPage.vue') },
    { path: '/home', name: 'home', component: () => import('../pages/HomePage.vue') },
    { path: '/quiz', name: 'quiz', component: () => import('../pages/QuizPage.vue') },
    { path: '/wrong', name: 'wrong', component: () => import('../pages/WrongBookPage.vue') },
    { path: '/bookmarks', name: 'bookmarks', component: () => import('../pages/BookmarksPage.vue') },
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
  ],
})

export default router
