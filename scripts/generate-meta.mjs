/**
 * 构建时生成 public/_meta.json，包含各分类题库的题目数。
 * 运行时 getCategoryCounts() 优先读取此文件，避免加载全部题库 JSON（~8MB）。
 *
 * 用法：node scripts/generate-meta.mjs
 * 通常由 parse:all 脚本在所有 parser 完成后自动调用。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '..', 'public')

const banks = [
  { key: 'japanese2', file: 'japanese2-question-bank.json' },
  { key: 'history', file: 'history-question-bank.json' },
  { key: 'party', file: 'party-question-bank.json' },
  { key: 'military', file: 'military-question-bank.json' },
]

const meta = {}

for (const bank of banks) {
  const filePath = resolve(publicDir, bank.file)
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    meta[bank.key] = { count: Array.isArray(data) ? data.length : 0 }
    console.log(`[meta] ${bank.key}: ${meta[bank.key].count} 题`)
  } catch {
    console.warn(`[meta] ${bank.file} 未找到，跳过`)
    meta[bank.key] = { count: 0 }
  }
}

const outPath = resolve(publicDir, '_meta.json')
writeFileSync(outPath, JSON.stringify(meta, null, 2) + '\n')
console.log(`[meta] 写入 ${outPath}`)
