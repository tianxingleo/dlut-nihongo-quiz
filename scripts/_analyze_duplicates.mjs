// 检测题库中的重复题目（完全重复 + 高度相似）
// 用法: node scripts/_analyze_duplicates.mjs <json-path> [stem-only|full]
import fs from 'fs'

const jsonPath = process.argv[2]
const mode = process.argv[3] || 'stem-only' // stem-only: 只比对题干；full: 题干+选项+答案

if (!jsonPath) {
  console.error('用法: node scripts/_analyze_duplicates.mjs <json-path> [stem-only|full]')
  process.exit(1)
}

const questions = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

// 归一化：去除空格、标点差异、统一大小写
const norm = (s) =>
  (s || '')
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？""''（）()【】《》、,.;:!?'"[\]<>]/g, '')
    .toLowerCase()

const normStem = (q) => norm(q.stem)

const normFull = (q) => {
  // 题干 + 选项 + 答案文本
  const parts = [
    q.stem,
    ...(q.options || []).map((o) => o.text).filter(Boolean),
    q.answerText || '',
  ]
  return norm(parts.join('|'))
}

const getKey = mode === 'full' ? normFull : normStem

// 分组检测
const byKey = new Map()
for (const q of questions) {
  const k = getKey(q)
  if (!k) continue
  if (!byKey.has(k)) byKey.set(k, [])
  byKey.get(k).push(q)
}

const dupGroups = [...byKey.values()].filter((g) => g.length > 1)

console.log(`\n=== ${jsonPath} ===`)
console.log(`总题数: ${questions.length}`)
console.log(`唯一 ${mode === 'full' ? '题干+选项+答案' : '题干'} 数: ${byKey.size}`)
console.log(`重复 cluster 数: ${dupGroups.length}`)
console.log(`重复题目总数 (含所有副本): ${dupGroups.reduce((s, g) => s + g.length, 0)}`)
console.log(`净重复题目数 (额外副本): ${dupGroups.reduce((s, g) => s + g.length - 1, 0)}`)

// 按 "涉及哪些组" 分类
const crossGroupDup = [] // 跨组重复（如 single 和 p1 都有）
const withinGroupDup = [] // 同组内重复

for (const g of dupGroups) {
  const groupSet = new Set(g.map((q) => q.groupId))
  if (groupSet.size > 1) crossGroupDup.push(g)
  else withinGroupDup.push(g)
}

console.log(`\n--- 跨组重复 cluster: ${crossGroupDup.length} ---`)
console.log(`  (这是 完整版 vs 按优先级整理 的结构性重叠)`)
console.log(`  跨组重复题目数: ${crossGroupDup.reduce((s, g) => s + g.length, 0)}`)
console.log(`  净跨组重复: ${crossGroupDup.reduce((s, g) => s + g.length - 1, 0)}`)

console.log(`\n--- 同组内重复 cluster: ${withinGroupDup.length} ---`)
console.log(`  同组重复题目数: ${withinGroupDup.reduce((s, g) => s + g.length, 0)}`)
console.log(`  净同组重复: ${withinGroupDup.reduce((s, g) => s + g.length - 1, 0)}`)

// 按 cluster 涉及的组对统计 top combinations
const pairCount = new Map()
for (const g of crossGroupDup) {
  const groups = [...new Set(g.map((q) => q.groupId))].sort()
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const key = `${groups[i]} ↔ ${groups[j]}`
      pairCount.set(key, (pairCount.get(key) || 0) + 1)
    }
  }
}

console.log(`\n--- 跨组重复 top 对 (前 15) ---`)
const sortedPairs = [...pairCount.entries()].sort((a, b) => b[1] - a[1])
for (const [pair, count] of sortedPairs.slice(0, 15)) {
  console.log(`  ${pair}: ${count} cluster`)
}

// 列出前 5 个跨组重复示例
console.log(`\n--- 跨组重复示例 (前 5) ---`)
for (const g of crossGroupDup.slice(0, 5)) {
  const first = g[0]
  console.log(`\n  题干: ${first.stem.slice(0, 80)}${first.stem.length > 80 ? '…' : ''}`)
  console.log(`  答案: ${first.answerText || first.answerKey}`)
  console.log(`  出现在 ${g.length} 处:`)
  for (const q of g) {
    console.log(`    - ${q.id} [${q.groupId}]`)
  }
}

// 列出前 5 个同组内重复
console.log(`\n--- 同组内重复示例 (前 10) ---`)
for (const g of withinGroupDup.slice(0, 10)) {
  const first = g[0]
  console.log(`\n  题干: ${first.stem.slice(0, 80)}${first.stem.length > 80 ? '…' : ''}`)
  console.log(`  组: ${first.groupId}, 重复 ${g.length} 次:`)
  for (const q of g) {
    console.log(`    - ${q.id}`)
  }
}

// 各组总数 vs 去重后
console.log(`\n--- 各组题目数 vs 去重后唯一数 ---`)
const byGroup = new Map()
for (const q of questions) {
  if (!byGroup.has(q.groupId)) byGroup.set(q.groupId, { total: 0, keys: new Set() })
  const e = byGroup.get(q.groupId)
  e.total++
  e.keys.add(getKey(q))
}
const sortedGroups = [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))
for (const [gid, e] of sortedGroups) {
  const unique = e.keys.size
  const dup = e.total - unique
  const flag = dup > 0 ? ` ⚠ ${dup} 重复` : ''
  console.log(`  ${gid}: ${e.total} 题, 唯一 ${unique}${flag}`)
}
