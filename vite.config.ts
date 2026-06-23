import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 读取 package.json 的版本号
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
const packageVersion = packageJson.version || '0.0.0'

// 把 dist/sw.js 中的 __SW_CACHE_VERSION__ 占位符替换为构建时间戳，
// 让每次发版 CACHE_NAME 都不同，旧客户端能立即拿到新题库与前端资源。
function swCacheVersionPlugin(): Plugin {
  return {
    name: 'sw-cache-version',
    apply: 'build',
    closeBundle() {
      const swPath = resolve(process.cwd(), 'dist/sw.js')
      try {
        const version = `${Date.now()}`
        const src = readFileSync(swPath, 'utf8')
        writeFileSync(swPath, src.replaceAll('__SW_CACHE_VERSION__', version))
        console.log(`[sw] CACHE_VERSION bumped to ${version}`)
      } catch {
        console.warn('[sw] dist/sw.js not found, skipping version bump')
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [vue(), swCacheVersionPlugin()],
  base: mode === 'production' ? '/dlut-nihongo-quiz/' : '/',
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageVersion),
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/katex') || id.includes('node_modules/marked-katex')) {
            return 'katex'
          }
          if (id.includes('node_modules/vue') || id.includes('node_modules/vue-router')) {
            return 'vendor'
          }
        },
      },
    },
  },
}))
