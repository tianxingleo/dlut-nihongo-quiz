import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface RawQuestion {
  groupId: string
  groupTitle: string
  numberInGroup: number
  stem: string
  options: { key: string; text: string }[]
  answerKey: string
  answerText: string
  explanation: string
  multiAnswer: boolean
  questionType: 'single' | 'multi' | 'judgement'
}

interface SectionSpec {
  match: RegExp
  suffix: string
  title: string
}

interface FileSpec {
  file: string
  baseGroupId: string
  sections: SectionSpec[]
}

// 完整版 sections by 题型; 填空题 deliberately omitted so parser enters skip mode.
// 按优先级整理 sections by P1-P4 priority.
const FILES: FileSpec[] = [
  {
    file: '党史题库_完整版.md',
    baseGroupId: 'party',
    sections: [
      { match: /^##\s+单选题[（(]党史[）)]/, suffix: 'single', title: '党史 · 单选题（完整版）' },
      { match: /^##\s+多选题[（(]党史[）)]/, suffix: 'multi', title: '党史 · 多选题（完整版）' },
      { match: /^##\s+判断题[（(]党史[）)]/, suffix: 'judge', title: '党史 · 判断题（完整版）' },
    ],
  },
  {
    file: '党史题库_按优先级整理.md',
    baseGroupId: 'party',
    sections: [
      { match: /^##\s+第一优先级/, suffix: 'p1', title: '党史 P1 · 必考核心' },
      { match: /^##\s+第二优先级/, suffix: 'p2', title: '党史 P2 · 高频重点' },
      { match: /^##\s+第三优先级/, suffix: 'p3', title: '党史 P3 · 重要知识' },
      { match: /^##\s+第四优先级/, suffix: 'p4', title: '党史 P4 · 补充巩固' },
    ],
  },
]

// Bold-wrapped question header: **N. stem** or **N、stem**
const QUESTION_HDR = /^\*\*\s*(\d+)\s*[\.、]\s*(.+?)\s*\*\*\s*$/

// Any markdown ## header — used to detect section boundaries (including ones we skip).
const ANY_SECTION = /^#{2}\s+/

function detectAnswerType(
  raw: string,
  options: { key: string; text: string }[],
): { kind: 'single' | 'multi' | 'judgement' | 'skip'; normalized: string; reason?: string } {
  const cleaned = raw.replace(/[\.。、\s]/g, '').toUpperCase()
  if (/^(正确|错误|对|错)$/.test(cleaned)) {
    return {
      kind: 'judgement',
      normalized: cleaned === '对' ? '正确' : cleaned === '错' ? '错误' : cleaned,
    }
  }
  if (/^[A-J]+$/.test(cleaned)) {
    if (cleaned.length > 1) return { kind: 'multi', normalized: cleaned.split('').sort().join('') }
    return { kind: 'single', normalized: cleaned }
  }
  // Text answer — try matching against option text
  const norm = (s: string) => s.replace(/[\.。、\s]/g, '').toLowerCase()
  const match = options.find((o) => norm(o.text) === norm(raw))
  if (match) return { kind: 'single', normalized: match.key }
  // Fallback: scan for letter run
  const letters = (cleaned.match(/[A-J]+/) || [''])[0]
  if (letters.length > 1) return { kind: 'multi', normalized: letters.split('').sort().join('') }
  if (letters.length === 1) return { kind: 'single', normalized: letters }
  // 无法识别的答案格式——跳过，避免产生错误的判断题数据
  return { kind: 'skip', normalized: '', reason: 'unrecognized-answer' }
}

function parseFile(spec: FileSpec, rawDir: string): RawQuestion[] {
  const filePath = path.join(rawDir, spec.file)
  const content = fs.readFileSync(filePath, 'utf-8')
  const out: RawQuestion[] = []

  let currentGroupId = ''
  let currentGroupTitle = ''
  let counter = 0
  let skipMode = true // skip until we enter a tracked section

  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Section header detection
    if (spec.sections.length && ANY_SECTION.test(trimmed)) {
      const sec = spec.sections.find((s) => s.match.test(trimmed))
      if (sec) {
        currentGroupId = `${spec.baseGroupId}-${sec.suffix}`
        currentGroupTitle = sec.title
        counter = 0
        skipMode = false
      } else {
        // Section we don't track — enter skip mode (e.g. 填空题)
        skipMode = true
        currentGroupId = ''
      }
      i++
      continue
    }

    if (skipMode) {
      i++
      continue
    }
    if (!currentGroupId) {
      i++
      continue
    }

    const hdr = trimmed.match(QUESTION_HDR)
    if (!hdr) {
      i++
      continue
    }

    const stemFirstLine = hdr[2]

    // Collect body until next question / section / EOF / ---
    const body: string[] = []
    i++
    while (i < lines.length) {
      const t = lines[i].trim()
      if (t === '---') break
      if (ANY_SECTION.test(t)) break
      if (QUESTION_HDR.test(t)) break
      body.push(lines[i])
      i++
    }

    // Walk body: stem / options / answer / explanation
    const stemParts: string[] = [stemFirstLine]
    const options: { key: string; text: string }[] = []
    let answerRaw = ''
    let explanation = ''
    let sawOption = false

    let j = 0
    while (j < body.length) {
      const line = body[j].trim()
      if (!line) {
        j++
        continue
      }

      const ansMatch = line.match(/^\*\*答案\*\*\s*[:：]\s*(.+?)\s*$/)
      if (ansMatch) {
        answerRaw = ansMatch[1].trim()
        j++
        while (j < body.length) {
          const l2 = body[j].trim()
          if (!l2) {
            j++
            continue
          }
          if (/^\*\*答案/.test(l2)) break
          if (QUESTION_HDR.test(l2)) break
          if (ANY_SECTION.test(l2)) break
          const expMatch = l2.match(/^\*\*解析\*\*\s*[:：]\s*(.*)$/)
          if (expMatch) {
            explanation = expMatch[1].trim()
            j++
            while (j < body.length) {
              const l3 = body[j].trim()
              if (/^\*\*答案/.test(l3)) break
              if (QUESTION_HDR.test(l3)) break
              if (ANY_SECTION.test(l3)) break
              explanation += '\n' + l3
              j++
            }
            // Collapse 3+ newlines to 2 and trim trailing whitespace
            explanation = explanation.replace(/\n{3,}/g, '\n\n').replace(/[\s\n]+$/, '')
            break
          }
          explanation += (explanation ? '\n' : '') + l2.replace(/^\*\*(.+?)\*\*$/, '$1')
          j++
        }
        break
      }

      // Option line — supports both per-line and inline `A.x B.y C.z` styles
      if (/^[A-J][.、）)]/.test(line)) {
        sawOption = true
        const parts = line
          .split(/(?=[A-J][.、）)])/)
          .map((s) => s.trim())
          .filter((p) => /^[A-J][.、）)]/.test(p))
        for (const p of parts) {
          const m = p.match(/^([A-J])[.、）)]\s*(.+)$/)
          if (m && !options.find((x) => x.key === m[1])) {
            options.push({ key: m[1], text: m[2].trim() })
          }
        }
        j++
        continue
      }

      if (!sawOption) stemParts.push(line)
      j++
    }

    if (!answerRaw) continue
    if (options.length < 2) continue // skip fill-in-blank & malformed

    const stem = stemParts.join(' ').replace(/\s+/g, ' ').trim()

    const { kind, normalized } = detectAnswerType(answerRaw, options)

    // 跳过无法识别答案格式的题目（如填空/简答）
    if (kind === 'skip') continue

    // Validate answer letters exist in options
    if (kind === 'multi') {
      if (![...normalized].every((k) => options.find((o) => o.key === k))) continue
    } else if (kind === 'single') {
      if (!options.find((o) => o.key === normalized)) continue
    }

    let finalOptions = options
    let answerKey = normalized
    let answerText = ''
    let multiAnswer = false

    if (kind === 'judgement') {
      // Find 正确/错误 in existing options; if not present, synthesize.
      const correctOpt = options.find((o) => /^(正确|对)$/.test(o.text))
      const wrongOpt = options.find((o) => /^(错误|错)$/.test(o.text))
      if (correctOpt && wrongOpt) {
        answerKey = normalized === '正确' ? correctOpt.key : wrongOpt.key
        answerText = normalized
        finalOptions = options
      } else {
        finalOptions = [
          { key: 'A', text: '正确' },
          { key: 'B', text: '错误' },
        ]
        answerKey = normalized === '正确' ? 'A' : 'B'
        answerText = normalized
      }
    } else if (kind === 'multi') {
      multiAnswer = true
      answerKey = normalized
      answerText = options
        .filter((o) => normalized.includes(o.key))
        .map((o) => o.text)
        .join(' / ')
    } else {
      const matched = options.find((o) => o.key === normalized)
      answerText = matched?.text || ''
    }

    counter++
    out.push({
      groupId: currentGroupId,
      groupTitle: currentGroupTitle,
      numberInGroup: counter,
      stem,
      options: finalOptions,
      answerKey,
      answerText,
      explanation: explanation.trim(),
      multiAnswer,
      questionType: kind,
    })
  }

  return out
}

function extractExplicitTags(explanation: string): string[] {
  const m = explanation.match(/^\*\*标签\*\*\s*[：:]\s*(.+?)\s*$/m)
  if (!m) return []
  return m[1]
    .split(/[·,，、]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function tagQuestion(q: RawQuestion): { tags: string[]; grammarPoints: string[] } {
  const tags: string[] = []
  if (q.multiAnswer) tags.push('多选题')
  if (q.questionType === 'judgement') tags.push('判断题')
  if (q.questionType === 'single') tags.push('单选题')

  for (const t of extractExplicitTags(q.explanation)) tags.push(t)

  const full = q.stem + ' ' + q.explanation
  const contentTags: [string, RegExp][] = [
    [
      '党的指导思想',
      /党的指导思想|马克思列宁主义|毛泽东思想|邓小平理论|三个代表|科学发展观|习近平新时代中国特色社会主义思想/,
    ],
    ['党章知识', /党章|党员的[权利义务]|党的[中央基层纪律]组织|民主集中制/],
    ['党的性质宗旨', /党的性质|党的宗旨|先锋队|全心全意为人民服务/],
    ['党史重大事件', /南昌起义|秋收起义|长征|遵义会议|中共[一大二大三四十大]/],
    ['抗日战争', /抗日战争|九一八|七七事变|抗日民族统一战线/],
    ['解放战争', /解放战争|三大战役/],
    ['改革开放', /改革开放|经济特区|社会主义市场经济/],
    ['新时代', /新时代|中国梦|中华民族伟大复兴|两个一百年/],
    ['一国两制', /一国两制|港人治港|澳人治澳/],
    ['社会主义初级阶段', /社会主义初级阶段|基本路线|基本纲领/],
  ]
  for (const [t, re] of contentTags) {
    if (re.test(full)) tags.push(t)
  }
  return { tags: [...new Set(tags)], grammarPoints: [] }
}

function main() {
  const rawDir = path.resolve(__dirname, '../data/raw/party')
  const outPath = path.resolve(__dirname, '../public/party-question-bank.json')
  const reportPath = path.resolve(__dirname, '../data/processed/party-validation-report.json')

  const all: RawQuestion[] = []
  for (const spec of FILES) {
    const parsed = parseFile(spec, rawDir)
    all.push(...parsed)
  }

  // Domain-internal dedup. User rule: dedupe only within priority domain (p1-p4)
  // or each unit domain (single/multi/judge). Cross-domain overlap is intentional.
  const PRIORITY_DOMAIN = ['party-p1', 'party-p2', 'party-p3', 'party-p4']
  const UNIT_DOMAINS = [['party-single'], ['party-multi'], ['party-judge']]
  const prio = (gid: string): number => {
    const i = PRIORITY_DOMAIN.indexOf(gid)
    return i < 0 ? 100 : i
  }
  const domains: string[][] = [PRIORITY_DOMAIN, ...UNIT_DOMAINS]
  const keepIds = new Set<string>()
  for (const domain of domains) {
    const domainSet = new Set(domain)
    const inDomain = all.filter((q) => domainSet.has(q.groupId))
    const byKey = new Map<string, RawQuestion[]>()
    for (const q of inDomain) {
      const normStem = q.stem
        .replace(/\s+/g, '')
        .replace(/[，。、；：！？""''（）()【】《》、,.;:!?"'[\]<>—－·…]/g, '')
        .toLowerCase()
      const k = normStem + '|' + q.questionType
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k)!.push(q)
    }
    for (const qs of byKey.values()) {
      qs.sort((a, b) => {
        if (b.options.length !== a.options.length) return b.options.length - a.options.length
        const pa = prio(a.groupId)
        const pb = prio(b.groupId)
        if (pa !== pb) return pa - pb
        return (b.explanation || '').length - (a.explanation || '').length
      })
      const kept = qs[0]
      keepIds.add(`${kept.groupId}-q${String(kept.numberInGroup).padStart(5, '0')}`)
    }
  }
  const filtered = all.filter((q) => {
    if (!keepIds.has(`${q.groupId}-q${String(q.numberInGroup).padStart(5, '0')}`)) return false
    // Quality filter: multi-choice with <3 options is useless (answer = all options)
    if (q.questionType === 'multi' && q.options.length < 3) return false
    return true
  })

  const enriched = filtered.map((q, i) => {
    const { tags, grammarPoints } = tagQuestion(q)
    return {
      id: `${q.groupId}-q${String(q.numberInGroup).padStart(5, '0')}`,
      category: 'party' as const,
      groupId: q.groupId,
      groupTitle: q.groupTitle,
      numberInGroup: q.numberInGroup,
      stem: q.stem,
      options: q.options,
      answerKey: q.answerKey,
      answerText: q.answerText,
      translation: '',
      explanation: q.explanation,
      grammarPoints,
      tags,
      source: {
        file: FILES.find((f) => q.groupId.startsWith(f.baseGroupId + '-'))?.file || '',
        group: q.groupTitle,
        position: i + 1,
      },
      status: 'ready' as const,
      multiAnswer: q.multiAnswer,
      questionType: q.questionType,
    }
  })

  const report: string[] = []
  report.push(`总题数: ${enriched.length}`)

  const byGroup: Record<string, number> = {}
  for (const q of enriched) byGroup[q.groupId] = (byGroup[q.groupId] || 0) + 1
  for (const [gid, count] of Object.entries(byGroup).sort()) {
    report.push(`  ${gid}: ${count}题`)
  }

  const missingStem = enriched.filter((q) => !q.stem)
  const missingOptions = enriched.filter((q) => q.options.length < 2)
  const missingAnswer = enriched.filter((q) => !q.answerKey)
  const missingExplanation = enriched.filter((q) => !q.explanation)
  const answerNotInOptions = enriched.filter((q) => {
    if (q.multiAnswer) return ![...q.answerKey].every((k) => q.options.find((o) => o.key === k))
    return !q.options.find((o) => o.key === q.answerKey)
  })
  const ids = enriched.map((q) => q.id)
  const dupIds = ids.filter((id, k) => ids.indexOf(id) !== k)

  if (missingStem.length)
    report.push(
      `⚠ 缺题干(${missingStem.length}): ${missingStem
        .slice(0, 5)
        .map((q) => q.id)
        .join(', ')}${missingStem.length > 5 ? ' …' : ''}`,
    )
  if (missingOptions.length)
    report.push(
      `⚠ 缺选项(${missingOptions.length}): ${missingOptions
        .slice(0, 5)
        .map((q) => q.id)
        .join(', ')}${missingOptions.length > 5 ? ' …' : ''}`,
    )
  if (missingAnswer.length) report.push(`⚠ 缺答案: ${missingAnswer.map((q) => q.id).join(', ')}`)
  if (missingExplanation.length)
    report.push(
      `⚠ 缺解析(${missingExplanation.length}): ${missingExplanation
        .slice(0, 5)
        .map((q) => q.id)
        .join(', ')}${missingExplanation.length > 5 ? ' …' : ''}`,
    )
  if (answerNotInOptions.length)
    report.push(
      `⚠ 答案不在选项中(${answerNotInOptions.length}): ${answerNotInOptions
        .slice(0, 5)
        .map((q) => q.id)
        .join(', ')}${answerNotInOptions.length > 5 ? ' …' : ''}`,
    )
  if (dupIds.length) report.push(`⚠ 重复ID: ${[...new Set(dupIds)].join(', ')}`)

  const byType: Record<string, number> = {}
  for (const q of enriched) byType[q.questionType] = (byType[q.questionType] || 0) + 1
  report.push(
    `题型分布: ${Object.entries(byType)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
  )

  report.push('✅ 校验完成')

  fs.writeFileSync(outPath, JSON.stringify(enriched, null, 2), 'utf-8')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        report,
        generatedAt: new Date().toISOString(),
        count: enriched.length,
        byGroup,
        byType,
      },
      null,
      2,
    ),
    'utf-8',
  )

  console.log(report.join('\n'))
  console.log(`\n输出: ${outPath} (${enriched.length} 题)`)

  // 校验报告有 warning 时返回非零退出码，让 CI 能捕获问题
  const hasWarnings = report.some((line) => line.startsWith('⚠'))
  if (hasWarnings) {
    console.error('\n❌ 校验报告中存在 warning，退出码 1')
    process.exit(1)
  }
}

main()
