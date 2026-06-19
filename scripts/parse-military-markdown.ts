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
]

const QUESTION_HDR = /^\*\*\s*(\d+)\s*[\.、]\s*(.+?)\s*\*\*\s*$/
const ANY_SECTION = /^#{2}\s+/
const CHAPTER_HDR = /^##\s+([一二三四五六七八九十]+)、\s*(.+?)\s*$/

function detectAnswerType(
  raw: string,
  options: { key: string; text: string }[],
): { kind: 'single' | 'multi' | 'judgement'; normalized: string } {
  // Strip anything in/after parens (e.g. "错误（实质错误——…）" → "错误")
  const stripped = raw.replace(/[（(].*$/, '').trim()
  const cleaned = stripped.replace(/[\.。、\s]/g, '').toUpperCase()
  if (/^(正确|错误|对|错)$/.test(cleaned)) {
    return {
      kind: 'judgement',
      normalized: cleaned === '对' ? '正确' : cleaned === '错' ? '错误' : cleaned,
    }
  }
  if (/^[A-E]+$/.test(cleaned)) {
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
  const letters = (cleaned.match(/[A-E]+/) || [''])[0]
  if (letters.length > 1) return { kind: 'multi', normalized: letters.split('').sort().join('') }
  if (letters.length === 1) return { kind: 'single', normalized: letters }
  return { kind: 'judgement', normalized: '错误' }
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

      if (/^[A-E][\.、）)]/.test(line)) {
        sawOption = true
        const parts = line
          .split(/(?=[A-E][\.、）)])/)
          .map((s) => s.trim())
          .filter((p) => /^[A-E][\.、）)]/.test(p))
        for (const p of parts) {
          const m = p.match(/^([A-E])[\.、）)]\s*(.+)$/)
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

    const { kind, normalized } = detectAnswerType(answerRaw, options)

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

  const enriched = all.map((q, i) => {
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
