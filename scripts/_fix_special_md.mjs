// 处理两类特殊情况：
//   1. 子标题被当成题（题干是 "一、单项选择题" / "二、多选题" 等）→ 整条删除
//   2. 同文件内答案冲突 cluster（同题干但答案不同）→ 多数派胜出，加【存疑】标记，其余删除
// 用法: node scripts/_fix_special_md.mjs <md-path> [--apply]
import fs from 'fs'

const mdPath = process.argv[2]
const apply = process.argv.includes('--apply')
if (!mdPath) {
  console.error('用法: node scripts/_fix_special_md.mjs <md-path> [--apply]')
  process.exit(1)
}

const norm = (s) =>
  (s || '')
    .replace(/\s+/g, '')
    .replace(/\[来源[：:].*?\]/g, '')
    .replace(/[（(]\s*[A-E]\s*[)）]/g, '')
    .replace(/\s+([A-E])$/, '')
    .replace(/[\\，。、；：！？""''（）()【】《》、,.;:!?'"[\]<>—\-‐－]/g, '')
    .toLowerCase()

// 子标题模式：一/二/三/四/五 + 、 + 单选/多选/判断/填空 + 题
const SUB_HDR = /^[一二三四五六]、(单项选择|单选|多项选择|多选|判断正误|判断|填空)题/

const raw = fs.readFileSync(mdPath, 'utf-8')
const lines = raw.replace(/\r\n?/g, '\n').split('\n')

const HDR_BOLD = /^\*\*\s*\d+\s*[\.、]/
const HDR_HASH = /^(?:>\s*)?#{3,4}\s+\d+\s*[\.、](?!\d)/

function isQHdr(line) {
  const t = line.trim()
  return HDR_BOLD.test(t) || HDR_HASH.test(t)
}

function parseHdr(line) {
  const t = line.replace(/^>\s?/, '').trim()
  let m = t.match(/^\*\*\s*(\d+)\s*[\.、]\s*(.*?)\s*\*\*$/)
  if (m) return { num: +m[1], stemStart: m[2] || '', style: 'bold' }
  m = t.match(/^#{3,4}\s+(\d+)\s*[\.、]\s*(.*)$/)
  if (m) return { num: +m[1], stemStart: m[2] || '', style: 'hash' }
  return null
}

// 切 sections
const sections = []
let cur = { kind: 'preamble', header: [], body: [] }
let inSection = false
for (const line of lines) {
  if (/^##\s+/.test(line)) {
    if (cur.body.length || cur.header.length) sections.push(cur)
    cur = { kind: 'section', header: [line], body: [] }
    inSection = true
  } else if (inSection) cur.body.push(line)
  else cur.header.push(line)
}
sections.push(cur)

// 切 blocks
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
      const stemParts = []
      if (hdrInfo.stemStart) stemParts.push(hdrInfo.stemStart)
      for (let k = 1; k < qLines.length; k++) {
        const t = qLines[k].trim()
        if (!t) continue
        if (/^[A-E][\.、）)]/.test(t)) break
        if (/^\*\*答案/.test(t)) break
        if (/^\*\*解析/.test(t)) break
        if (/^---/.test(t)) break
        stemParts.push(t)
      }
      const stem = stemParts.join(' ').replace(/\s+/g, ' ').trim()
      const text = qLines.join('\n')
      const ansMatch = text.match(/\*\*答案\*?\*?\s*[:：]\s*(.+?)\s*\*{0,2}\s*(\n|$)/)
      const answer = ansMatch ? ansMatch[1].replace(/\*+/g, '').trim() : ''
      const expMatch = text.match(
        /\*\*解析\*?\*?\s*[:：]\s*\*{0,2}\s*([\s\S]+?)\s*(?:\n---|\n\*\*答案|\n$|$)/,
      )
      const explanation = expMatch ? expMatch[1].trim() : ''
      out.push({
        type: 'q',
        lines: qLines,
        hdrStyle: hdrInfo.style,
        stem,
        answer,
        explanation,
        stemKey: norm(stem),
        ansKey: norm(answer),
      })
    } else {
      buf.push(line)
      i++
    }
  }
  flush()
  return out
}

for (const sec of sections) if (sec.kind === 'section') sec.blocks = splitBlocks(sec.body)

// 1) 标记子标题块 → 直接删除
const subHdrDeletions = [] // {si, bi, stem}
sections.forEach((sec, si) => {
  if (sec.kind !== 'section') return
  sec.blocks.forEach((b, bi) => {
    if (b.type !== 'q') return
    if (SUB_HDR.test(b.stem)) {
      subHdrDeletions.push({ si, bi, stem: b.stem })
    }
  })
})

// 2) 找答案冲突 cluster（跨 section 也算）
const globalCluster = new Map()
sections.forEach((sec, si) => {
  if (sec.kind !== 'section') return
  sec.blocks.forEach((b, bi) => {
    if (b.type !== 'q' || !b.stemKey) return
    if (!globalCluster.has(b.stemKey)) globalCluster.set(b.stemKey, [])
    globalCluster.get(b.stemKey).push({ si, bi })
  })
})

const conflictClusters = [] // {stem, refs: [{si, bi, answer, block}], winnerAns, losers}
for (const [stemKey, refs] of globalCluster) {
  if (refs.length < 2) continue
  // 排除"子标题" cluster（已处理）
  if (subHdrDeletions.some((d) => refs.some((r) => r.si === d.si && r.bi === d.bi))) continue
  // 检查答案是否一致
  const ansCounts = new Map()
  for (const r of refs) {
    const b = sections[r.si].blocks[r.bi]
    const a = b.ansKey
    ansCounts.set(a, (ansCounts.get(a) || 0) + 1)
  }
  if (ansCounts.size <= 1) continue // 一致，不是冲突
  // 多数派胜出；并列时取出现顺序先的
  let winnerAns = ''
  let maxCount = 0
  for (const [a, c] of ansCounts) {
    if (c > maxCount) {
      maxCount = c
      winnerAns = a
    }
  }
  const enriched = refs.map((r) => {
    const b = sections[r.si].blocks[r.bi]
    return { si: r.si, bi: r.bi, answer: b.answer, ansKey: b.ansKey, block: b }
  })
  conflictClusters.push({
    stem: sections[refs[0].si].blocks[refs[0].bi].stem,
    refs: enriched,
    winnerAns,
    ansCounts: [...ansCounts.entries()].sort((a, b) => b[1] - a[1]),
  })
}

console.log(`\n📄 ${mdPath}`)
console.log(`   子标题当题（删除）: ${subHdrDeletions.length} 条`)
console.log(`   答案冲突 cluster: ${conflictClusters.length} 个`)

if (subHdrDeletions.length) {
  console.log(`\n   ── 子标题删除清单 ──`)
  for (const d of subHdrDeletions) console.log(`     • section ${d.si + 1}: ${d.stem}`)
}

if (conflictClusters.length) {
  console.log(`\n   ── 冲突 cluster（多数派胜出，加【存疑】，少数派删除）──`)
  for (const c of conflictClusters) {
    console.log(`\n     • ${c.stem.slice(0, 80)}${c.stem.length > 80 ? '…' : ''}`)
    for (const [a, n] of c.ansCounts) {
      const mark = a === c.winnerAns ? '✓胜' : '✗删'
      console.log(`       ${mark} 答案 ${a} (×${n})`)
    }
  }
}

if (!apply) {
  console.log(`\n   [DRY-RUN] 加 --apply 实际写入`)
  process.exit(0)
}

// 应用：构造要删除的 (si|bi) 集合，构造要标记【存疑】的 (si|bi) 集合
const deleteSet = new Set()
const markSet = new Map() // (si|bi) -> 冲突备注

for (const d of subHdrDeletions) deleteSet.add(`${d.si}|${d.bi}`)

for (const c of conflictClusters) {
  // 多数派里取第一条作为胜者，其余的（包括多数派里的其他副本）都删除
  const winnerRef = c.refs.find((r) => r.ansKey === c.winnerAns)
  const loserAnswers = [...new Set(c.refs.filter((r) => r !== winnerRef).map((r) => r.answer))]
  const note = `【存疑·原题库存在答案分歧：${loserAnswers.join(' / ')}】 `
  markSet.set(`${winnerRef.si}|${winnerRef.bi}`, note)
  for (const r of c.refs) {
    if (r === winnerRef) continue
    deleteSet.add(`${r.si}|${r.bi}`)
  }
}

// 写回
for (let si = 0; si < sections.length; si++) {
  const sec = sections[si]
  if (sec.kind !== 'section') continue
  const kept = []
  for (let bi = 0; bi < sec.blocks.length; bi++) {
    const key = `${si}|${bi}`
    if (deleteSet.has(key)) continue
    const b = sec.blocks[bi]
    if (b.type === 'q' && markSet.has(key)) {
      // 在题首行的题干前插入 【存疑】 标记
      const note = markSet.get(key)
      b.lines[0] = b.lines[0].replace(/^((?:>\s*)?(?:\*\*|#{3,4}\s+\d+\s*[\.、])\s*)/, `$1${note}`)
    }
    kept.push(b)
  }
  // 重新编号
  let qn = 0
  for (const b of kept) {
    if (b.type !== 'q') continue
    qn++
    const oldFirst = b.lines[0]
    if (b.hdrStyle === 'bold') {
      b.lines[0] = oldFirst.replace(/^(\*\*\s*(?:【存疑[^】]*】\s*)?)\d+(\s*[\.、])/, `$1${qn}$2`)
    } else {
      b.lines[0] = oldFirst.replace(
        /^((?:>\s*)?#{3,4}\s+(?:【存疑[^】]*】\s*)?)\d+(\s*[\.、])/,
        `$1${qn}$2`,
      )
    }
  }
  sec.blocks = kept
}

const out = []
for (const sec of sections) {
  if (sec.kind === 'preamble') out.push(...sec.header)
  else {
    out.push(...sec.header)
    for (const b of sec.blocks) out.push(...b.lines)
  }
}
fs.writeFileSync(mdPath, out.join('\n'), 'utf-8')
console.log(
  `\n   ✅ 已写入 (删 ${subHdrDeletions.length + Array.from(deleteSet).length - subHdrDeletions.length} 题, 标记 ${markSet.size} 题)`,
)
