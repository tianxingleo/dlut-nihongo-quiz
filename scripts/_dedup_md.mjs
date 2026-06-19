// 对一个 md 题库文件做"同 section 内"去重
// 支持两种 md 格式：
//   - 党史/军理：题头是 `**N. stem**`
//   - 近代史：题头是 `#### N. stem` 或 `> #### N. stem`，stem 可能跨行，可能带 [来源：...] 前缀
// 策略：
//   - 题干归一化相同的视为重复（[来源：...] 前缀会被剥离）
//   - 同 cluster 保留"答案文本+解析"最完整的一条
//   - 默认只在同一个 ## section 内去重；--cross-section 跨 section 也合并
//   - 删除其余副本，section 内重新顺序编号
// 用法:
//   node scripts/_dedup_md.mjs <md-path> [--apply] [--cross-section]
import fs from 'fs'

const mdPath = process.argv[2]
const apply = process.argv.includes('--apply')
const crossSection = process.argv.includes('--cross-section')
if (!mdPath) {
  console.error('用法: node scripts/_dedup_md.mjs <md-path> [--apply] [--cross-section]')
  process.exit(1)
}

const norm = (s) =>
  (s || '')
    .replace(/\s+/g, '')
    .replace(/\[来源[：:].*?\]/g, '') // 剥离 T1 的 [来源：...] 前缀
    .replace(/[（(]\s*[A-E]\s*[)）]/g, '') // 剥离 T5 内联答案提示 "（C）"
    .replace(/\s+([A-E])$/, '') // 末尾裸字母提示
    .replace(/[\\，。、；：！？""''（）()【】《》、,.;:!?'"[\]<>—\-‐－]/g, '')
    .toLowerCase()

const raw = fs.readFileSync(mdPath, 'utf-8')
const lines = raw.replace(/\r\n?/g, '\n').split('\n')

// 检测题头格式
const HDR_BOLD = /^\*\*\s*\d+\s*[\.、]/
// hash 题头：`#### 1. stem` — 题号后必须是非数字（避免把 `### 1.1 章节标题` 误判为题目）
const HDR_HASH = /^(?:>\s*)?#{3,4}\s+\d+\s*[\.、](?!\d)/

// 一段"题头 + 后续行"切成块时用
function isQHdr(line) {
  const t = line.trim()
  return HDR_BOLD.test(t) || HDR_HASH.test(t)
}

// 从题头行抽出"题号 + 起始 stem"
function parseHdr(line) {
  const t = line.replace(/^>\s?/, '').trim()
  let m = t.match(/^\*\*\s*(\d+)\s*[\.、]\s*(.*?)\s*\*\*$/)
  if (m) return { num: +m[1], stemStart: m[2] || '', style: 'bold' }
  m = t.match(/^#{3,4}\s+(\d+)\s*[\.、]\s*(.*)$/)
  if (m) return { num: +m[1], stemStart: m[2] || '', style: 'hash' }
  return null
}

// 把题块剩余行里的"题干续行 / 答案 / 解析"抽出来
function parseBlockBody(qLines, style) {
  const text = qLines.join('\n')
  // 答案
  const ansMatch = text.match(/\*\*答案\*?\*?\s*[:：]\s*(.+?)\s*(\n|$)/)
  const answer = ansMatch ? ansMatch[1].trim() : ''
  // 解析
  const expMatch = text.match(/\*\*解析\*?\*?\s*[:：]\s*([\s\S]+?)\s*(?:\n---|\n\*\*答案|\n$|$)/)
  const explanation = expMatch ? expMatch[1].trim() : ''
  return { answer, explanation }
}

// 1) 切分 preamble + sections
const sections = []
let cur = { kind: 'preamble', header: [], body: [] }
let inSection = false
for (const line of lines) {
  if (/^##\s+/.test(line)) {
    if (cur.body.length || cur.header.length) sections.push(cur)
    cur = { kind: 'section', header: [line], body: [] }
    inSection = true
  } else if (inSection) {
    cur.body.push(line)
  } else {
    cur.header.push(line)
  }
}
sections.push(cur)

// 2) 每个 section 切题块
function splitBlocks(bodyLines) {
  const out = []
  let buf = []
  const flush = () => {
    if (buf.length) {
      out.push({ type: 'gap', lines: buf })
      buf = []
    }
  }
  let i = 0
  while (i < bodyLines.length) {
    const line = bodyLines[i]
    if (isQHdr(line)) {
      const hdrInfo = parseHdr(line)
      if (!hdrInfo) {
        // isQHdr 通过但 parseHdr 失败 — 把这行当 gap，避免崩溃
        buf.push(line)
        i++
        continue
      }
      flush()
      const qLines = [line]
      i++
      while (i < bodyLines.length) {
        const l = bodyLines[i]
        if (isQHdr(l)) break
        if (/^##\s+/.test(l)) break
        qLines.push(l)
        i++
      }
      // 解析 stem：hdrInfo.stemStart + 后续非选项/非空行，直到出现选项行或答案行
      const stemParts = []
      if (hdrInfo.stemStart) stemParts.push(hdrInfo.stemStart)
      for (let k = 1; k < qLines.length; k++) {
        const t = qLines[k].trim()
        if (!t) continue
        if (/^[A-E][\.、）)]/.test(t)) break // 选项开始
        if (/^\*\*答案/.test(t)) break
        if (/^\*\*解析/.test(t)) break
        if (/^---/.test(t)) break
        stemParts.push(t)
      }
      const stem = stemParts.join(' ').replace(/\s+/g, ' ').trim()
      const { answer, explanation } = parseBlockBody(qLines, hdrInfo.style)
      out.push({
        type: 'q',
        lines: qLines,
        hdrStyle: hdrInfo.style,
        stem,
        answer,
        explanation,
        stemKey: norm(stem),
        answerLen: (answer || '').length + (explanation || '').length,
      })
    } else {
      buf.push(line)
      i++
    }
  }
  flush()
  return out
}

for (const sec of sections) {
  if (sec.kind === 'section') sec.blocks = splitBlocks(sec.body)
}

// 3) 聚合
const clusterKeyFn = crossSection
  ? (stemKey) => stemKey
  : (stemKey, secIdx) => `${secIdx}::${stemKey}`

const globalCluster = new Map()
sections.forEach((sec, si) => {
  if (sec.kind !== 'section') return
  sec.blocks.forEach((b, bi) => {
    if (b.type !== 'q' || !b.stemKey) return
    const key = clusterKeyFn(b.stemKey, si)
    if (!globalCluster.has(key)) globalCluster.set(key, [])
    globalCluster.get(key).push({ secIdx: si, blockIdx: bi })
  })
})

// 4) 决定胜者与 loser
//    答案一致的 cluster：直接合并，保留最长者
//    答案冲突的 cluster：SKIP（不删），全部列入 conflicts 让用户裁决
let totalDel = 0
const conflicts = []
const deletions = []

for (const [key, refs] of globalCluster) {
  if (refs.length < 2) continue
  // 先检查整个 cluster 答案是否一致
  const firstAns = norm(sections[refs[0].secIdx].blocks[refs[0].blockIdx].answer)
  const allSame = refs.every((r) => norm(sections[r.secIdx].blocks[r.blockIdx].answer) === firstAns)
  if (!allSame) {
    // 冲突，跳过；列出供用户裁决
    const stem = sections[refs[0].secIdx].blocks[refs[0].blockIdx].stem
    const answers = new Map()
    for (const r of refs) {
      const b = sections[r.secIdx].blocks[r.blockIdx]
      const a = b.answer
      if (!answers.has(a)) answers.set(a, [])
      answers.get(a).append ? answers.get(a).push(r.secIdx + 1) : answers.set(a, [r.secIdx + 1])
    }
    conflicts.push({
      stem,
      refs: refs.map((r) => ({
        secIdx: r.secIdx + 1,
        answer: sections[r.secIdx].blocks[r.blockIdx].answer,
      })),
    })
    continue
  }
  // 答案一致：选最长者
  let winner = refs[0]
  let winnerBlock = sections[winner.secIdx].blocks[winner.blockIdx]
  for (let k = 1; k < refs.length; k++) {
    const r = refs[k]
    const b = sections[r.secIdx].blocks[r.blockIdx]
    if (b.answerLen > winnerBlock.answerLen) {
      winner = r
      winnerBlock = b
    }
  }
  for (const r of refs) {
    if (r === winner) continue
    deletions.push({ secIdx: r.secIdx, blockIdx: r.blockIdx })
    totalDel++
  }
}

const qTotal = [...globalCluster.values()].reduce((s, g) => s + g.length, 0)
console.log(`\n📄 ${mdPath}`)
console.log(`   题目总数: ${qTotal}, 唯一 cluster: ${globalCluster.size}, 计划删除: ${totalDel}`)
console.log(`   跳过冲突 cluster (答案不同, 留待裁决): ${conflicts.length}`)

if (conflicts.length) {
  console.log(`\n   ⚠ 答案冲突的 cluster (前 20):`)
  for (const c of conflicts.slice(0, 20)) {
    console.log(`\n     • ${c.stem.slice(0, 80)}${c.stem.length > 80 ? '…' : ''}`)
    const ansCount = new Map()
    for (const r of c.refs) {
      const a = r.answer.replace(/\*+/g, '').trim()
      if (!ansCount.has(a)) ansCount.set(a, [])
      ansCount.get(a).push(r.secIdx)
    }
    for (const [a, secs] of ansCount) {
      console.log(`       答案 ${a} (section ${secs.join(', ')})`)
    }
  }
  if (conflicts.length > 20) console.log(`\n     ... 还有 ${conflicts.length - 20} 个`)
}

if (!apply) {
  console.log(`\n   [DRY-RUN] 加 --apply 实际写入`)
  process.exit(0)
}

// 5) 实际写入
const deleteSet = new Set(deletions.map((d) => `${d.secIdx}|${d.blockIdx}`))
for (let si = 0; si < sections.length; si++) {
  const sec = sections[si]
  if (sec.kind !== 'section') continue
  const kept = []
  for (let bi = 0; bi < sec.blocks.length; bi++) {
    const b = sec.blocks[bi]
    if (b.type === 'q' && deleteSet.has(`${si}|${bi}`)) continue
    kept.push(b)
  }
  // 重新编号 q 块（仅替换首行的题号）
  let qn = 0
  for (const b of kept) {
    if (b.type !== 'q') continue
    qn++
    const oldFirst = b.lines[0]
    if (b.hdrStyle === 'bold') {
      b.lines[0] = oldFirst.replace(/^(\*\*\s*)\d+(\s*[\.、])/, `$1${qn}$2`)
    } else {
      // hash 风格：保留 ">" 前缀和 "###" 或 "####" 前缀
      b.lines[0] = oldFirst.replace(/^((?:>\s*)?#{3,4}\s+)\d+(\s*[\.、])/, `$1${qn}$2`)
    }
  }
  sec.blocks = kept
}

const out = []
for (const sec of sections) {
  if (sec.kind === 'preamble') {
    out.push(...sec.header)
  } else {
    out.push(...sec.header)
    for (const b of sec.blocks) out.push(...b.lines)
  }
}
fs.writeFileSync(mdPath, out.join('\n'), 'utf-8')
console.log(`   ✅ 已写入 (剩余 ${qTotal - totalDel} 题)`)
