import { readFileSync } from 'fs'

const file = process.argv[2]
const content = readFileSync(file, 'utf-8')
const lines = content.split(/\r?\n/)
let mode: string | null = null
const k2kSet = new Set<string>()
const k2k2Set = new Set<string>()

for (const line of lines) {
  const t = line.trim()
  if (t.includes('给假名选汉字')) {
    mode = 'k2k'
    continue
  }
  if (t.includes('给汉字选假名')) {
    mode = 'k2k2'
    continue
  }
  const m = t.match(/^-\s+[A-D][.\s]+(.+?)(?:\s*✅)?\s*$/)
  if (m && mode && !t.includes('【')) {
    if (mode === 'k2k') k2kSet.add(m[1].trim())
    else k2k2Set.add(m[1].trim())
  }
}
console.log('=== kana-to-kanji missing ===')
;[...k2kSet].sort().forEach((x) => console.log(x))
console.log('\n=== kanji-to-kana missing ===')
;[...k2k2Set].sort().forEach((x) => console.log(x))
console.log(`\nk2k: ${k2kSet.size}, k2k2: ${k2k2Set.size}`)
