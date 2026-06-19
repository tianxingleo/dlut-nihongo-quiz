// 兜底脚本：直接把 dist/sw.js 中的 __SW_CACHE_VERSION__ 占位符替换为时间戳。
// 默认 vite 构建已通过 vite.config.ts 的 swCacheVersionPlugin 自动处理；
// 此脚本保留以便手动重新 bump（例如不想重新 build 时）。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const swPath = resolve(__dirname, '../dist/sw.js')

try {
  const version = `${Date.now()}`
  const src = readFileSync(swPath, 'utf8')
  writeFileSync(swPath, src.replaceAll('__SW_CACHE_VERSION__', version))
  console.log(`[sw] CACHE_VERSION bumped to ${version}`)
} catch (err) {
  console.error('[sw] dist/sw.js not found. Run `npm run build` first.', err)
  process.exit(1)
}
