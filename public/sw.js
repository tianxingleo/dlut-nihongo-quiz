// Service Worker 自动适应部署路径：所有路径基于 self.registration.scope 计算，
// 项目部署在 /dlut-nihongo-quiz/ 子路径下也能正常注册和缓存。
// CACHE_VERSION 由构建脚本写回（见 scripts/bump-sw-cache.mjs），每次发版自动 bump。
const CACHE_VERSION = '__SW_CACHE_VERSION__'
const CACHE_NAME = `quiz-cache-${CACHE_VERSION}`
const SW_VERSION = CACHE_VERSION

function withScope(path) {
  if (!path) return path
  // 绝对 URL 直接返回
  if (/^https?:\/\//.test(path)) return path
  const scope = self.registration.scope
  const base = scope.endsWith('/') ? scope : scope + '/'
  if (path === '/' || path === '') return base
  // 去掉前导 /
  const rel = path.startsWith('/') ? path.slice(1) : path
  return base + rel
}

const ASSETS_TO_CACHE = [
  '',
  'index.html',
  'manifest.json',
  'favicon.svg',
  'question-bank.json',
  'word-question-bank.json',
  'history-question-bank.json',
  'party-question-bank.json',
  'military-question-bank.json',
].map(withScope)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 单个失败不影响其他资源
      return Promise.allSettled(ASSETS_TO_CACHE.map((url) => cache.add(url)))
    }),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
      )
    }).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  const isSameOrigin = url.origin === self.location.origin
  if (!isSameOrigin) return

  const isQuizBank = url.pathname.endsWith('-question-bank.json')
  const isAsset = /\.(?:js|css|svg|woff2?)$/.test(url.pathname)
  const isDocument = event.request.destination === 'document'

  if (isQuizBank || isAsset || isDocument) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request).then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        }).catch(() => cached)
        return cached || network
      }),
    )
  }
})
