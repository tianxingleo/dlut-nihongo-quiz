import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateQuestionCatalog } from './scripts/generate-question-catalog'

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
      const version = `${Date.now()}`
      const src = readFileSync(swPath, 'utf8')
      const assets = readdirSync(resolve('dist/assets')).filter((file) =>
        /\.(js|css|png|svg)$/.test(file),
      )
      writeFileSync(
        swPath,
        src
          .replaceAll('__SW_CACHE_VERSION__', version)
          .replace(
            '/* __PRECACHE_ASSETS__ */',
            assets.map((file) => JSON.stringify('assets/' + file) + ',').join('\n'),
          ),
      )

      console.log(`[sw] CACHE_VERSION bumped to ${version}`)
    },
  }
}

function questionCatalogPlugin(): Plugin {
  return {
    name: 'question-catalog',
    configureServer(server) {
      let files = generateQuestionCatalog()
      server.watcher.on('change', (file) => {
        if (file.endsWith('-question-bank.json')) files = generateQuestionCatalog()
      })
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].slice(1)
        if (!name || !Object.hasOwn(files, name)) return next()
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(files[name as keyof typeof files])
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(generateQuestionCatalog())) {
        this.emitFile({ type: 'asset', fileName, source })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [vue(), questionCatalogPlugin(), swCacheVersionPlugin()],
  base: mode === 'production' ? '/dlut-nihongo-quiz/' : '/',
  server: {
    headers: {
      // 防止 IDM 等下载管理器拦截 .gz 字典文件
      'Content-Disposition': 'inline',
    },
  },
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
          if (id.includes('node_modules/marked')) {
            return 'markdown'
          }
          if (id.includes('node_modules/dompurify')) {
            return 'sanitize'
          }
          if (id.includes('node_modules/dexie')) {
            return 'dexie'
          }
        },
      },
    },
  },
}))
