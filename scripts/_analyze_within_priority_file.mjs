// 检测【同一个 md 文件内部】的重复（按 source 文件聚合 group）
// 党史按优先级整理.md = party-p1 + p2 + p3 + p4
// 党史完整版.md = party-single + multi + judge
// 用法: node scripts/_analyze_priority_file.mjs <json-path> <file-key>
//   file-key: "priority" 查按优先级整理；"full" 查完整版；"both" 两个都查
import fs from 'fs'

const jsonPath = process.argv[2]
const fileKey = process.argv[3] || 'both'
if (!jsonPath) {
  console.error('用法: node scripts/_analyze_priority_file.mjs <json-path> [priority|full|both]')
  process.exit(1)
}

const questions = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

const norm = (s) =>
  (s || '')
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？""''（）()【】《》、,.;:!?'"[\]<>]/g, '')
    .toLowerCase()

// 抽取 groupId 前缀（如 party, military, hist, t）和 bank 名
const detectBank = () => {
  if (questions[0]?.id?.startsWith('party')) return { bank: 'party', base: 'party' }
  if (questions[0]?.id?.startsWith('military')) return { bank: 'military', base: 'military' }
  if (questions[0]?.id?.startsWith('hist') || questions[0]?.id?.startsWith('t'))
    return { bank: 'history', base: '' }
  return { bank: 'unknown', base: '' }
}

const { bank } = detectBank()

// 定义"文件 → 包含哪些 groupId 前缀" 的映射
// 这些是按 source md 文件聚合的虚拟分组
const FILES_BY_BANK = {
  party: [
    {
      file: '党史题库_按优先级整理.md',
      label: '按优先级整理',
      groups: ['party-p1', 'party-p2', 'party-p3', 'party-p4'],
    },
    {
      file: '党史题库_完整版.md',
      label: '完整版',
      groups: ['party-single', 'party-multi', 'party-judge'],
    },
  ],
  military: [
    {
      file: '军理题库_按优先级整理.md',
      label: '按优先级整理',
      groups: ['military-p1', 'military-p2', 'military-p3', 'military-p4'],
    },
    {
      file: '军理题库_整理版.md',
      label: '按章节整理',
      groups: [
        'military-ch1',
        'military-ch2',
        'military-ch3',
        'military-ch4',
        'military-ch5',
        'military-ch6',
        'military-ch7',
        'military-ch8',
        'military-ch9',
        'military-ch10',
        'military-ch11',
        'military-ch12',
        'military-ch13',
        'military-ch14',
        'military-ch15',
        'military-ch16',
        'military-ch17',
        'military-ch18',
      ],
    },
  ],
  history: [
    { file: '刷题单1-核心必刷T0.md', label: 'T0核心必刷', groups: ['t0'] },
    { file: '刷题单2-重点掌握T1.md', label: 'T1重点掌握', groups: ['t1'] },
    { file: '刷题单3-常规巩固T2.md', label: 'T2常规巩固', groups: ['t2'] },
    { file: '刷题单4-查漏补缺T3.md', label: 'T3查漏补缺', groups: ['t3'] },
    { file: '刷题单5-机考模拟.md', label: '机考模拟', groups: ['t5-1', 't5-2', 't5-3', 't5-4'] },
    { file: '1-大工题库.md', label: '大工题库', groups: ['hist-a'] },
    { file: '4-近代史习题集.md', label: '近代史习题集', groups: ['hist-b'] },
    { file: '2-纲要分章题库.md', label: '纲要分章题库', groups: ['hist-c'] },
  ],
}

const files = FILES_BY_BANK[bank] || []
if (!files.length) {
  console.error(`未识别的题库: ${bank}`)
  process.exit(1)
}

console.log(`\n🔍 题库: ${jsonPath} (bank=${bank})`)

const filesToCheck =
  fileKey === 'priority'
    ? files.filter((f) => f.label.includes('优先级'))
    : fileKey === 'full'
      ? files.filter((f) => !f.label.includes('优先级'))
      : files

for (const fdef of filesToCheck) {
  const qs = questions.filter((q) => fdef.groups.includes(q.groupId))
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`📄 ${fdef.file}  [${fdef.label}]  (共 ${qs.length} 题)`)
  console.log(`   包含分组: ${fdef.groups.join(', ')}`)
  console.log('═'.repeat(70))

  // 同 stem 聚合
  const byStem = new Map()
  for (const q of qs) {
    const k = norm(q.stem)
    if (!k) continue
    if (!byStem.has(k)) byStem.set(k, [])
    byStem.get(k).push(q)
  }
  const dups = [...byStem.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length)
  const extra = dups.reduce((s, g) => s + g.length - 1, 0)
  console.log(`  唯一题干: ${byStem.size}, 重复 cluster: ${dups.length}, 净额外副本: ${extra}`)

  if (!dups.length) continue

  // 子分组维度：跨子分组的 cluster vs 同子分组内的 cluster
  const crossSub = [] // 跨子分组（如 p1+p3 同时出现 — 这是优先级分类错误）
  const withinSub = [] // 仅在同一子分组内（如 p1 内部有 2 份 — 这是单纯的录入重复）
  for (const g of dups) {
    const subGroups = new Set(g.map((q) => q.groupId))
    if (subGroups.size > 1) crossSub.push(g)
    else withinSub.push(g)
  }

  console.log(`\n  ── 跨子分组重复 cluster: ${crossSub.length} (同一道题被分到多个优先级/章节)`)
  console.log(`     净额外副本: ${crossSub.reduce((s, g) => s + g.length - 1, 0)}`)
  console.log(`  ── 同子分组内重复 cluster: ${withinSub.length} (同一优先级/章节内重复录入)`)
  console.log(`     净额外副本: ${withinSub.reduce((s, g) => s + g.length - 1, 0)}`)

  // 跨子分组示例（这就是"优先级整理错了"的典型）
  console.log(`\n  ── 跨子分组重复 (前 20): `)
  for (const g of crossSub.slice(0, 20)) {
    const first = g[0]
    const subGroups = [...new Set(g.map((q) => q.groupId))].join(' + ')
    const sameAns = g.every(
      (q) => norm(q.answerText || q.answerKey) === norm(first.answerText || first.answerKey),
    )
    const mark = sameAns ? '✓' : '⚠答案不同'
    console.log(
      `\n    [${mark}] [${g.length}x in ${subGroups}] ${first.stem.slice(0, 90)}${first.stem.length > 90 ? '…' : ''}`,
    )
    for (const q of g) {
      console.log(`       - ${q.id}  [${q.groupId}]`)
    }
  }
  if (crossSub.length > 20) console.log(`\n    ... 还有 ${crossSub.length - 20} 个跨子分组 cluster`)

  // 同子分组示例
  console.log(`\n  ── 同子分组内重复 (前 20):`)
  for (const g of withinSub.slice(0, 20)) {
    const first = g[0]
    const sameAns = g.every(
      (q) => norm(q.answerText || q.answerKey) === norm(first.answerText || first.answerKey),
    )
    const mark = sameAns ? '✓' : '⚠答案不同'
    console.log(
      `\n    [${mark}] [${g.length}x in ${first.groupId}] ${first.stem.slice(0, 90)}${first.stem.length > 90 ? '…' : ''}`,
    )
    for (const q of g) {
      console.log(`       - ${q.id}`)
    }
  }
  if (withinSub.length > 20)
    console.log(`\n    ... 还有 ${withinSub.length - 20} 个同子分组 cluster`)
}
