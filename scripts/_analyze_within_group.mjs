// 检测【同一 groupId 内】的重复题目（同文件、同分组内的真重复）
// 用法: node scripts/_analyze_within_group.mjs <json-path>
import fs from 'fs'

const jsonPath = process.argv[2]
if (!jsonPath) {
  console.error('用法: node scripts/_analyze_within_group.mjs <json-path>')
  process.exit(1)
}

const questions = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

const norm = (s) =>
  (s || '')
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？""''（）()【】《》、,.;:!?'"[\]<>]/g, '')
    .toLowerCase()

// 按 groupId 分组
const byGroup = new Map()
for (const q of questions) {
  if (!byGroup.has(q.groupId)) byGroup.set(q.groupId, [])
  byGroup.get(q.groupId).push(q)
}

let grandCluster = 0
let grandExtra = 0

for (const [gid, qs] of [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const byStem = new Map()
  for (const q of qs) {
    const k = norm(q.stem)
    if (!k) continue
    if (!byStem.has(k)) byStem.set(k, [])
    byStem.get(k).push(q)
  }
  const dups = [...byStem.values()].filter((g) => g.length > 1)
  const extra = dups.reduce((s, g) => s + g.length - 1, 0)
  const unique = qs.length - extra

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`📁 ${gid}: ${qs.length} 题, 唯一 ${unique}, 净重复 ${extra}, cluster ${dups.length}`)
  console.log('─'.repeat(60))

  if (dups.length === 0) continue

  grandCluster += dups.length
  grandExtra += extra

  // 列出所有重复（最多 30 个 cluster）
  for (const g of dups.slice(0, 30)) {
    const first = g[0]
    const sameAns = g.every(
      (q) => norm(q.answerText || q.answerKey) === norm(first.answerText || first.answerKey),
    )
    const ansMark = sameAns ? '✓' : '⚠答案不同'
    const stem = first.stem
    console.log(
      `\n  [${ansMark}] (${g.length}x) ${stem.slice(0, 100)}${stem.length > 100 ? '…' : ''}`,
    )
    for (const q of g) {
      const a = (q.answerText || q.answerKey || '').slice(0, 50)
      console.log(`     - ${q.id}  答案: ${a}`)
    }
  }
  if (dups.length > 30) {
    console.log(`\n  ... 还有 ${dups.length - 30} 个 cluster 未列出`)
  }
}

console.log(`\n${'='.repeat(60)}`)
console.log(`📊 汇总: 总 cluster ${grandCluster}, 净额外副本 ${grandExtra}`)
console.log('='.repeat(60))
