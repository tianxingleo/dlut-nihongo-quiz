/**
 * 合并 word-question-bank.json 和 question-bank.json (grammar)
 * 为 japanese2-question-bank.json，统一 category 字段。
 *
 * 题目 id 前缀 (w* / g*) 本就不冲突，合并后 Dexie 历史记录可无损保留。
 *
 * 用法：npx tsx scripts/merge-japanese2-banks.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const publicDir = path.resolve(__dirname, '..', 'public')

interface Question {
  id: string
  category?: string
  groupId: string
  [k: string]: unknown
}

function readJson(rel: string): Question[] {
  const p = path.join(publicDir, rel)
  if (!fs.existsSync(p)) {
    throw new Error(`找不到文件：${p}`)
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Question[]
}

function main(): void {
  const wordBank = readJson('word-question-bank.json')
  const grammarBank = readJson('question-bank.json')

  console.log(`读取 word: ${wordBank.length} 题`)
  console.log(`读取 grammar: ${grammarBank.length} 题`)

  const idSet = new Set<string>()
  const merged: Question[] = []
  for (const q of [...wordBank, ...grammarBank]) {
    if (idSet.has(q.id)) {
      throw new Error(`题目 id 冲突：${q.id}`)
    }
    idSet.add(q.id)
    merged.push({ ...q, category: 'japanese2' })
  }

  const out = path.join(publicDir, 'japanese2-question-bank.json')
  fs.writeFileSync(out, JSON.stringify(merged, null, 2), 'utf8')
  console.log(`写入 ${out}: ${merged.length} 题`)
}

main()
