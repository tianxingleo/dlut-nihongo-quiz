const VERSION = '__SW_CACHE_VERSION__'
const scope = self.registration.scope
const prefix = `quiz:${scope}:`
const shellName = `${prefix}shell:${VERSION}`
const bankName = `${prefix}banks`
const indexName = `${prefix}index:${VERSION}`
const scoped = (path) => new URL(path, scope).href
const isBank = (url) => new URL(url).pathname.endsWith('-question-bank.json')
const assets = [
  'index.html',
  'manifest.json',
  'favicon.svg',
  'question-catalog.json',
  /* __PRECACHE_ASSETS__ */
].map(scoped)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(shellName).then((cache) => cache.addAll(assets)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      const banks = await caches.open(bankName)
      for (const name of names.filter((name) => name.startsWith('quiz-cache-'))) {
        const old = await caches.open(name)
        for (const request of await old.keys()) {
          if (!request.url.startsWith(scope) || !isBank(request.url)) continue
          if (await banks.match(request)) continue
          const response = await old.match(request)
          if (response?.ok) await banks.put(request, response)
        }
      }
      await Promise.all(
        names
          .filter(
            (name) =>
              (name.startsWith(prefix + 'shell:') && name !== shellName) ||
              (name.startsWith(prefix + 'index:') && name !== indexName),
          )
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

async function fetchBank(request) {
  const cache = await caches.open(bankName)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    return (await cache.match(request)) || Response.error()
  }
}

async function cachedResource(request, name) {
  const cache = await caches.open(name)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return
  const path = new URL(request.url).pathname
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(shellName).then((cache) => cache.match(scoped('index.html'))))
  } else if (isBank(request.url)) {
    event.respondWith(fetchBank(request))
  } else if (/\/question-(?:search|explanations)\.json$/.test(path)) {
    event.respondWith(cachedResource(request, indexName))
  } else if (path.startsWith(new URL('assets/', scope).pathname) || assets.includes(request.url)) {
    event.respondWith(cachedResource(request, shellName))
  }
})
