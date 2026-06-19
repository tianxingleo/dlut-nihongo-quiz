import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

const spec = {
  name: 'party',
  path: 'data/raw/party/党史题库_按优先级整理.md',
  sectionStart: /^##\s+第一优先级/,
  sectionEnd: /^##\s+第二优先级/,
  qHdr: /^\*\*\s*(\d+)\s*[\.、]\s*(.+?)\s*\*\*\s*$/,
  nextBoundary: (l) => /^\*\*\s*\d+\s*[\.、]/.test(l) || /^---\s*$/.test(l) || /^##\s/.test(l),
}

const abs = path.resolve(ROOT, spec.path)
const lines = fs.readFileSync(abs, 'utf-8').split('\n')

let inScope = false
const blocks = []
for (let i = 0; i < lines.length; i++) {
  if (spec.sectionStart.test(lines[i])) {
    inScope = true
    continue
  }
  if (spec.sectionEnd.test(lines[i])) {
    inScope = false
    continue
  }
  if (!inScope) continue
  const m = lines[i].match(spec.qHdr)
  if (!m) continue
  let end = i + 1
  while (end < lines.length && !spec.nextBoundary(lines[end])) end++
  blocks.push({ hdrLineIdx: i, bodyStartIdx: i + 1, bodyEndIdx: end })
}

const b = blocks[0]
console.log('Body:')
const body = lines.slice(b.bodyStartIdx, b.bodyEndIdx)
for (let i = 0; i < body.length; i++) {
  const t = body[i].trim()
  const m1 = t.match(/^\*\*\s*答案\s*\*\*\s*[：:]\s*(.+?)\s*$/)
  const m2 = t.match(/^\*\*\s*答案\s*[：:]\s*(.+?)\s*\*\*\s*$/)
  const m3 = t.match(/^\*\*\s*答案\s*\*\*\s*[：:]\s*(.+?)\s*\*\*\s*$/)
  console.log(`  body[${i}] = ${JSON.stringify(t)} m1=${!!m1} m2=${!!m2} m3=${!!m3}`)
}
