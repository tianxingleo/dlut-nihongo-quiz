// 检测【同一源文件内部】的重复题目
// 用法: node scripts/_analyze_within_file.mjs <json-path>
import fs from 'fs'

const jsonPath = process.argv[2]
if (!jsonPath) {
  console.error('用法: node scripts/_analyze_within_file.mjs <json-path>')
  process.exit(1)
}

const questions = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

const norm = (s) =>
  (s || '')
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？""''（）()【】《》、,.;:!?'"[\]<>]/g, '')
    .toLowerCase()

// 按源文件分组
const byFile = new Map()
for (const q of questions) {
  const f = q.source?.file || '(unknown)'
  if (!byFile.has(f)) byFile.set(f, [])
  byFile.get(f).push(q)
}

let totalDupClusters = 0
let totalExtraCopies = 0

for (const [file, qs] of byFile) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`📄 ${file}  (总 ${qs.length} 题)`)
  console.log('='.repeat(70))

  // 1. 题干完全相同
  const byStem = new Map()
  for (const q of qs) {
    const k = norm(q.stem)
    if (!k) continue
    if (!byStem.has(k)) byStem.set(k, [])
    byStem.get(k).push(q)
  }
  const stemDups = [...byStem.values()].filter((g) => g.length > 1)
  const stemExtra = stemDups.reduce((s, g) => s + g.length - 1, 0)

  // 2. 题干 + 答案 都相同（更严格的"真重复"）
  const byStemAns = new Map()
  for (const q of qs) {
    const k = norm(q.stem) + '||' + norm(q.answerText || q.answerKey)
    if (!k) continue
    if (!byStemAns.has(k)) byStemAns.set(k, [])
    byStemAns.get(k).push(q)
  }
  const stemAnsDups = [...byStemAns.values()].filter((g) => g.length > 1)
  const stemAnsExtra = stemAnsDups.reduce((s, g) => s + g.length - 1, 0)

  console.log(`  题干相同 cluster: ${stemDups.length} (净重复 ${stemExtra})`)
  console.log(`  题干+答案相同 cluster: ${stemAnsDups.length} (净重复 ${stemAnsExtra})`)

  totalDupClusters += stemDups.length
  totalExtraCopies += stemExtra

  // 列出前 N 个题干相同示例
  if (stemDups.length > 0) {
    console.log(`\n  --- 题干相同示例 (前 15) ---`)
    for (const g of stemDups.slice(0, 15)) {
      const first = g[0]
      const stem = first.stem
      const sameAns = g.every(
        (q) => norm(q.answerText || q.answerKey) === norm(first.answerText || first.answerKey),
      )
      const ansMark = sameAns ? '✓答案同' : '⚠答案不同'
      console.log(`\n  [${ansMark}] 题干: ${stem.slice(0, 90)}${stem.length > 90 ? '…' : ''}`)
      console.log(`       答案: ${g[0].answerText || g[0].answerKey}`)
      for (const q of g) {
        const a = q.answerText || q.answerKey
        console.log(`       - ${q.id} [${q.groupId}] 答案:${a}`)
      }
    }
  }
}

console.log(`\n${'='.repeat(70)}`)
console.log(`📊 汇总: 总 cluster ${totalDupClusters}, 净额外副本 ${totalExtraCopies}`)
console.log('='.repeat(70))
