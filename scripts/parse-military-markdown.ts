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

const CN_NUM: Record<string, string> = {
  一: '1',
  二: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
  十: '10',
  十一: '11',
  十二: '12',
  十三: '13',
  十四: '14',
  十五: '15',
  十六: '16',
  十七: '17',
  十八: '18',
}

function buildChapterSections(): SectionSpec[] {
  // Match chapter headers like `## 一、中国国防` / `## 十八、补充概念性问答（…）`.
  // Build one SectionSpec per chapter so we can extract the suffix at parse time.
  // We use a single regex and look up the chapter number dynamically below.
  return [
    {
      match: /^##\s+([一二三四五六七八九十]+)、/,
      suffix: '__CHAPTER__', // sentinel; replaced at parse time
      title: '',
    },
  ]
}

const FILES: FileSpec[] = [
  {
    file: '军理题库_整理版.md',
    baseGroupId: 'military',
    sections: buildChapterSections(),
  },
  {
    file: '军理题库_按优先级整理.md',
    baseGroupId: 'military',
    sections: [
      { match: /^##\s+第一优先级/, suffix: 'p1', title: '军理 P1 · 必考核心' },
      { match: /^##\s+第二优先级/, suffix: 'p2', title: '军理 P2 · 高频重点' },
      { match: /^##\s+第三优先级/, suffix: 'p3', title: '军理 P3 · 重要知识' },
      { match: /^##\s+第四优先级/, suffix: 'p4', title: '军理 P4 · 补充巩固' },
    ],
  },
  {
    file: '军理题库_PDF提取版.md',
    baseGroupId: 'military',
    sections: [
      { match: /^##\s+第一部分/, suffix: 'pdf-single', title: '军理 PDF · 单选题' },
      { match: /^##\s+第二部分/, suffix: 'pdf-multi', title: '军理 PDF · 多选题' },
      { match: /^##\s+第三部分/, suffix: 'pdf-judge', title: '军理 PDF · 判断题' },
    ],
  },
]

const QUESTION_HDR = /^\*\*\s*(\d+)\s*[\.、]\s*(.+?)\s*\*\*\s*$/
const ANY_SECTION = /^#{2}\s+/
const CHAPTER_HDR = /^##\s+([一二三四五六七八九十]+)、\s*(.+?)\s*$/

function detectAnswerType(
  raw: string,
  options: { key: string; text: string }[],
): { kind: 'single' | 'multi' | 'judgement' | 'skip'; normalized: string; reason?: string } {
  // Strip anything in/after parens (e.g. "错误（实质错误——…）" → "错误")
  const stripped = raw.replace(/[（(].*$/, '').trim()
  const cleaned = stripped.replace(/[\.。、\s]/g, '').toUpperCase()
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
  const matchExact = options.find((o) => norm(o.text) === norm(stripped))
  if (matchExact) return { kind: 'single', normalized: matchExact.key }
  // Multi text answer: try to find each option whose text appears in the answer
  const included = options.filter((o) => stripped.includes(o.text) && o.text.length >= 2)
  if (included.length >= 2) {
    return {
      kind: 'multi',
      normalized: included
        .map((o) => o.key)
        .sort()
        .join(''),
    }
  }
  // Fallback: scan for letter run
  const letters = (cleaned.match(/[A-J]+/) || [''])[0]
  if (letters.length > 1) return { kind: 'multi', normalized: letters.split('').sort().join('') }
  if (letters.length === 1) return { kind: 'single', normalized: letters }
  // Text answer that doesn't match any option — this is a fill-in-blank / short-answer
  // question that doesn't fit the choice/judgement model. Skip it rather than fabricating
  // a bogus judgement with default answer "错误".
  return { kind: 'skip', normalized: '', reason: 'short-answer-text' }
}

// Detect copy-pasted placeholder options ("国家/军队/政府/人民") that appear in dozens
// of questions in 军理题库_按优先级整理.md where only option A has real content.
const BOGUS_TEMPLATE = { B: '国家', C: '军队', D: '政府', E: '人民' }
function hasBogusTemplateOptions(options: { key: string; text: string }[]): boolean {
  if (options.length < 5) return false
  const lookup: Record<string, string> = {}
  for (const o of options) lookup[o.key] = o.text
  return (
    lookup['B'] === BOGUS_TEMPLATE.B &&
    lookup['C'] === BOGUS_TEMPLATE.C &&
    lookup['D'] === BOGUS_TEMPLATE.D &&
    lookup['E'] === BOGUS_TEMPLATE.E
  )
}

function parseFile(spec: FileSpec, rawDir: string): RawQuestion[] {
  const filePath = path.join(rawDir, spec.file)
  const content = fs.readFileSync(filePath, 'utf-8')
  const out: RawQuestion[] = []

  let currentGroupId = ''
  let currentGroupTitle = ''
  let counter = 0
  let skipMode = true

  const isChapterSpec = spec.sections.length === 1 && spec.sections[0].suffix === '__CHAPTER__'

  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (ANY_SECTION.test(trimmed)) {
      let handled = false
      if (isChapterSpec) {
        const cm = trimmed.match(CHAPTER_HDR)
        if (cm) {
          const num = CN_NUM[cm[1]]
          if (num) {
            currentGroupId = `${spec.baseGroupId}-ch${num}`
            currentGroupTitle = `军理 · 第${cm[1]}章 ${cm[2].replace(/[（(].*$/, '').trim()}`
            counter = 0
            skipMode = false
            handled = true
          }
        }
      }
      if (!handled) {
        const sec = spec.sections.find((s) => s.match.test(trimmed))
        if (sec) {
          currentGroupId = `${spec.baseGroupId}-${sec.suffix}`
          currentGroupTitle = sec.title
          counter = 0
          skipMode = false
          handled = true
        }
      }
      if (!handled) {
        // Untargeted ## header — flip into skip mode to avoid mis-attributing questions
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
            explanation = explanation.replace(/\n{3,}/g, '\n\n').replace(/[\s\n]+$/, '')
            break
          }
          explanation += (explanation ? '\n' : '') + l2.replace(/^\*\*(.+?)\*\*$/, '$1')
          j++
        }
        break
      }

      if (/^[A-J][\.、）)]/.test(line)) {
        sawOption = true
        const parts = line
          .split(/(?=[A-J][\.、）)])/)
          .map((s) => s.trim())
          .filter((p) => /^[A-J][\.、)]/.test(p))
        for (const p of parts) {
          const m = p.match(/^([A-J])[\.、）)]\s*(.+)$/)
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

    const stem = stemParts.join(' ').replace(/\s+/g, ' ').trim()

    // Skip questions whose B/C/D/E are the bogus 国家/军队/政府/人民 template —
    // only option A has real content and the question is effectively unusable.
    if (hasBogusTemplateOptions(options)) continue

    const { kind, normalized } = detectAnswerType(answerRaw, options)

    // Skip short-answer / fill-in-blank questions that don't fit choice/judgement.
    if (kind === 'skip') continue

    // Skip pure fill-in-blank questions (no options + non-judgement answer)
    if (options.length < 2 && kind !== 'judgement') continue

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
    ['国防', /国防|国防动员|国防法规|国防类型/],
    ['国家安全', /国家安全|周边安全/],
    ['毛泽东军事思想', /毛泽东军事思想|人民战争/],
    ['武装力量', /武装力量|解放军|预备役|民兵/],
    ['现代战争', /现代战争|信息化战争|精确制导/],
    ['孙子兵法', /孙子兵法|孙武/],
    ['军事技术', /激光|雷达|导弹|航天|电子战|核生化|C4ISR/],
    ['战略战术', /战略|战术|作战理论/],
    ['党史军史', /南昌起义|秋收起义|建军节|中央军委/],
    ['法律法规', /国防法|兵役法|国防教育法/],
  ]
  for (const [t, re] of contentTags) {
    if (re.test(full)) tags.push(t)
  }
  return { tags: [...new Set(tags)], grammarPoints: [] }
}

function main() {
  const rawDir = path.resolve(__dirname, '../data/raw/military')
  const outPath = path.resolve(__dirname, '../public/military-question-bank.json')
  const reportPath = path.resolve(__dirname, '../data/processed/military-validation-report.json')

  const all: RawQuestion[] = []
  for (const spec of FILES) {
    const parsed = parseFile(spec, rawDir)
    all.push(...parsed)
  }

  // Deduplicate across files.
  // Strategy:
  //   1. Exact stem match (normalized) → keep one per group, priority p1-p4 > pdf-* > ch*.
  //   2. Near-duplicate stem pairs (hand-curated, since jaccard < 1 but same knowledge point).
  // Source md files stay intact; dedup happens at JSON generation time.
  const DROP_IDS = new Set<string>([
    // Near-dup pairs identified by AI review (see data/processed/pdf-dedup-candidates.jsonl)
    'military-pdf-single-q00014', // ≈ military-p2-q00015
    'military-pdf-multi-q00029', // ≈ military-p4-q00090
    'military-pdf-single-q00027', // ≈ military-p1-q00014
    'military-pdf-single-q00024', // ≈ military-p1-q00036
    'military-pdf-single-q00019', // ≈ military-p4-q00087
    'military-pdf-judge-q00045', // ≈ military-ch2-q00037
    'military-pdf-single-q00041', // ≈ military-p4-q00017
    'military-pdf-single-q00050', // ≈ military-p3-q00024
    'military-pdf-judge-q00011', // ≈ military-ch5-q00016
    'military-pdf-single-q00062', // ≈ military-p4-q00063
    'military-pdf-judge-q00029', // ≈ military-ch5-q00010
    'military-pdf-judge-q00031', // ≈ military-ch17-q00013
    'military-pdf-single-q00022', // ≈ military-p1-q00029
    'military-pdf-judge-q00021', // ≈ military-ch3-q00009
    'military-pdf-multi-q00009', // ≈ military-p2-q00004
    'military-pdf-judge-q00030', // ≈ military-ch1-q00010
    'military-ch7-q00004', // ≈ military-ch1-q00017
    'military-p3-q00052', // ≈ military-p3-q00051
    'military-pdf-single-q00018', // ≈ military-p3-q00007
    'military-pdf-single-q00007', // ≈ military-p3-q00004
    'military-pdf-single-q00063', // ≈ military-p4-q00034
    'military-ch17-q00001', // ≈ military-ch5-q00023
    'military-pdf-multi-q00021', // ≈ military-p1-q00037
    'military-pdf-single-q00061', // ≈ military-p2-q00020
    'military-pdf-single-q00045', // ≈ military-p2-q00009
    'military-pdf-multi-q00011', // ≈ military-p2-q00003
    'military-pdf-judge-q00014', // ≈ military-ch17-q00005
    'military-pdf-single-q00049', // ≈ military-p3-q00002
    'military-pdf-multi-q00054', // ≈ military-pdf-multi-q00006
    'military-pdf-multi-q00007', // ≈ military-p1-q00002
    'military-ch5-q00035', // ≈ military-p3-q00051 (最早制导武器)
    'military-pdf-single-q00070', // ≈ military-p1-q00039 (与中国接壤国家数)
    'military-pdf-multi-q00041', // ≈ military-p4-q00091 (胡锦涛80年建军传统)
    'military-pdf-judge-q00035', // ≈ military-p3-q00020 (九二共识，单选 vs 判断)
  ])
  const deduped = all.filter((q) => {
    const id = `${q.groupId}-q${String(q.numberInGroup).padStart(5, '0')}`
    return !DROP_IDS.has(id)
  })

  // Exact-stem dedup with priority (p* > pdf-* > ch*).
  const norm = (s: string) =>
    s
      .replace(/\s+/g, '')
      .replace(/[，。、；：！？""''（）()【】《》、,.;:!?"'[\]<>—－·…]/g, '')
      .toLowerCase()
  const groupPriority = (gid: string): number => {
    if (/military-p[1-4]$/.test(gid)) return 0
    if (gid.startsWith('military-pdf')) return 1
    return 2 // ch*
  }
  const byStem = new Map<string, RawQuestion[]>()
  for (const q of deduped) {
    // Key includes questionType so single & multi versions of the same stem are both kept
    const k = norm(q.stem) + '|' + q.questionType
    if (!byStem.has(k)) byStem.set(k, [])
    byStem.get(k)!.push(q)
  }
  const keepSet = new Set<RawQuestion>()
  for (const qs of byStem.values()) {
    qs.sort((a, b) => {
      // Prefer the version with more options (richer question) — this protects
      // PDF versions that have extra distractors from being dropped in favor of
      // shorter priority-list versions.
      if (b.options.length !== a.options.length) return b.options.length - a.options.length
      const pa = groupPriority(a.groupId)
      const pb = groupPriority(b.groupId)
      if (pa !== pb) return pa - pb
      return (b.explanation || '').length - (a.explanation || '').length
    })
    keepSet.add(qs[0])
  }
  const finalQs = deduped.filter((q) => keepSet.has(q))
  const droppedExact = deduped.length - finalQs.length
  const droppedManual = all.length - deduped.length

  const enriched = finalQs.map((q, i) => {
    const { tags, grammarPoints } = tagQuestion(q)
    return {
      id: `${q.groupId}-q${String(q.numberInGroup).padStart(5, '0')}`,
      category: 'military' as const,
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
}

main()
