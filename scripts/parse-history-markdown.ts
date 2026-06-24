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
  questionType: 'single' | 'multi' | 'judgement' | 'fill'
}

interface FileSpec {
  file: string
  baseGroupId: string
  baseGroupTitle: string
  // For T5: detects "## 第一套" / "## 第二套" etc. to switch sub-group.
  subGroupMatcher?: RegExp
}

const FILES: FileSpec[] = [
  {
    file: '刷题单1-核心必刷（T0）.md',
    baseGroupId: 't0',
    baseGroupTitle: '刷题单1：核心必刷（T0）',
  },
  {
    file: '刷题单2-重点掌握（T1）.md',
    baseGroupId: 't1',
    baseGroupTitle: '刷题单2：重点掌握（T1）',
  },
  {
    file: '刷题单3-常规巩固（T2）.md',
    baseGroupId: 't2',
    baseGroupTitle: '刷题单3：常规巩固（T2）',
  },
  {
    file: '刷题单4-查漏补缺（T3）.md',
    baseGroupId: 't3',
    baseGroupTitle: '刷题单4：查漏补缺（T3）',
  },
  {
    file: '刷题单5-机考模拟（4套卷）.md',
    baseGroupId: 't5',
    baseGroupTitle: '机考模拟',
    subGroupMatcher: /^##\s+第([一二三四])套(?:\s|$)/,
  },
  {
    file: '刷题单A-大工题库完整版.md',
    baseGroupId: 'hist-a',
    baseGroupTitle: '大工题库（完整版）',
  },
  {
    file: '刷题单B-近代史习题集完整版.md',
    baseGroupId: 'hist-b',
    baseGroupTitle: '近代史习题集（完整版）',
  },
  {
    file: '刷题单C-纲要分章题库完整版.md',
    baseGroupId: 'hist-c',
    baseGroupTitle: '纲要分章题库（完整版）',
  },
  {
    file: '5-历史练习题（章节版）.md',
    baseGroupId: 'hist-d',
    baseGroupTitle: '历史练习题（章节版）',
  },
]

const SUB_NUM_MAP: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4' }

// Header that marks a question start. Allows leading "> " (blockquote) and
// either ### or ####. Number is followed by . or 、.
const QUESTION_HDR = /^(?:>\s*)?(#{3,4})\s+(\d+)[\.、]\s*(.*)$/

function stripQuotePrefix(line: string): string {
  return line.replace(/^>\s?/, '')
}

function splitMultiOptionLine(line: string): string[] | null {
  // Detect "A、xxx B、yyy C、zzz" style (file C). Require at least 2 letter-prefixed segments.
  const trimmed = line.trim()
  if (!/^[A-J][\.、）)]/.test(trimmed)) return null
  const parts = trimmed
    .split(/(?=[A-J][\.、）)])/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  if (!parts.every((p) => /^[A-J][\.、)]/.test(p))) return null
  return parts
}

function parseOptionsFromLine(line: string): { key: string; text: string } | null {
  const m = line.match(/^([A-J])[\.、）)]\s*(.+)$/)
  if (!m) return null
  return { key: m[1], text: m[2].trim().replace(/\s+$/, '') }
}

function cleanStem(stem: string): string {
  let s = stem.replace(/\s+/g, ' ').trim()
  // T1 headers carry a "[来源：xxx.md]" tag as the only header text; drop it.
  s = s.replace(/\[来源[：:].*?\]\s*/g, '').trim()
  // T5 inline answer hints come in two flavours: "（C）" and a bare trailing " C".
  s = s.replace(/[（(]\s*([A-E])\s*[)）]/g, '').trim()
  s = s.replace(/\s+([A-E])$/, '').trim()
  s = s.replace(/[（(]\s*[)）]\s*$/, '').trim()
  return s
}

function detectAnswerType(raw: string, isFillBlank: boolean = false): {
  kind: 'single' | 'multi' | 'judgement' | 'fill' | 'skip'
  normalized: string
  reason?: string
} {
  // 如果明确是填空题，直接返回 fill 类型
  if (isFillBlank) {
    return { kind: 'fill', normalized: raw.trim() }
  }

  const cleaned = raw.replace(/[\.。、\s]/g, '').toUpperCase()
  // Judgement: 正确 / 错误 (or 对 / 错)
  if (/^(正确|错误|对|错)$/.test(cleaned)) {
    return {
      kind: 'judgement',
      normalized: cleaned === '对' ? '正确' : cleaned === '错' ? '错误' : cleaned,
    }
  }
  if (/^[A-J]+$/.test(cleaned)) {
    const sorted = cleaned.split('').sort().join('')
    return cleaned.length > 1
      ? { kind: 'multi', normalized: sorted }
      : { kind: 'single', normalized: cleaned }
  }
  // Fall back: take leading letter run.
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

  let currentGroupId = spec.baseGroupId
  let currentGroupTitle = spec.baseGroupTitle
  let counter = 0
  let isFillBlankSection = false

  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const stripped = stripQuotePrefix(raw)
    const trimmed = stripped.trim()

    // T5 sub-group switch
    if (spec.subGroupMatcher) {
      const sub = stripped.match(spec.subGroupMatcher)
      if (sub) {
        const n = SUB_NUM_MAP[sub[1]]
        currentGroupId = `${spec.baseGroupId}-${n}`
        currentGroupTitle = `${spec.baseGroupTitle} 第${sub[1]}套`
        counter = 0
        isFillBlankSection = false
        i++
        continue
      }
    }

    // 检测填空题部分
    if (trimmed === '### 填空题' || trimmed.match(/^###\s+填空题\s*$/)) {
      isFillBlankSection = true
      i++
      continue
    }

    // 检测其他题型部分（结束填空题）
    if (isFillBlankSection && (trimmed === '### 单选题' || trimmed === '### 多选题' || trimmed === '### 判断题' ||
        trimmed.match(/^###\s+(单选题|多选题|判断题)/) || trimmed.match(/^##\s+第[一二三四五六七八九十]+章/))) {
      isFillBlankSection = false
    }

    const hdr = trimmed.match(QUESTION_HDR)
    if (!hdr) {
      i++
      continue
    }

    const num = parseInt(hdr[2])
    let stemFirstLine = hdr[3].trim()

    // Collect body until next question header / sub-group header / EOF.
    const body: string[] = []
    i++
    while (i < lines.length) {
      const r = lines[i]
      const s = stripQuotePrefix(r)
      const t = s.trim()
      if (t === '---') break
      if (spec.subGroupMatcher && spec.subGroupMatcher.test(s)) break
      if (QUESTION_HDR.test(t)) break
      // 检测下一个题型部分（结束填空题）
      if (t === '### 填空题' || t === '### 单选题' || t === '### 多选题' || t === '### 判断题' ||
          t.match(/^###\s+(填空题|单选题|多选题|判断题)/) || t.match(/^##\s+第[一二三四五六七八九十]+章/)) break
      body.push(s)
      i++
    }

    // 填空题特殊处理：不需要选项，直接从题干中提取答案
    if (isFillBlankSection) {
      // 填空题的答案在 body 中的 **答案：xxx** 格式
      let answerRaw = ''
      let explanation = ''
      const stemParts: string[] = [stemFirstLine]

      let j = 0
      while (j < body.length) {
        const line = body[j].trim()
        if (!line) {
          j++
          continue
        }

        const ansMatch = line.match(/^\*\*\s*答案\s*[:：]\s*(.+?)\s*\*\*/)
        if (ansMatch) {
          answerRaw = ansMatch[1].trim()
          j++
          // Look ahead for the explanation block
          while (j < body.length) {
            const l2 = body[j].trim()
            if (!l2) {
              j++
              continue
            }
            if (/^\*\*\s*答案/.test(l2)) break
            if (QUESTION_HDR.test(l2)) break
            const expStart = l2.match(/^\*\*\s*解析\s*[:：]\s*\*{0,2}\s*(.*)$/)
            if (expStart) {
              explanation = expStart[1].trim().replace(/^\*{1,2}\s*/, '')
              j++
              while (j < body.length) {
                const l3 = body[j].trim()
                if (/^\*\*\s*答案/.test(l3)) break
                if (QUESTION_HDR.test(l3)) break
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

        // 非答案行加入题干
        stemParts.push(line)
        j++
      }

      if (!answerRaw) continue

      const stem = cleanStem(stemParts.join(' '))
      counter++
      out.push({
        groupId: currentGroupId,
        groupTitle: currentGroupTitle,
        numberInGroup: counter,
        stem,
        options: [], // 填空题没有选项
        answerKey: 'FILL', // 填空题使用特殊标记
        answerText: answerRaw,
        explanation: explanation.trim(),
        multiAnswer: false,
        questionType: 'fill',
      })
      continue
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

      const ansMatch = line.match(/^\*\*\s*答案\s*[:：]\s*(.+?)\s*\*\*/)
      if (ansMatch) {
        answerRaw = ansMatch[1].trim()
        j++
        // Look ahead for the explanation block. Strip stray bold markers around the capture.
        while (j < body.length) {
          const l2 = body[j].trim()
          if (!l2) {
            j++
            continue
          }
          if (/^\*\*\s*答案/.test(l2)) break
          if (QUESTION_HDR.test(l2)) break
          const expStart = l2.match(/^\*\*\s*解析\s*[:：]\s*\*{0,2}\s*(.*)$/)
          if (expStart) {
            explanation = expStart[1].trim().replace(/^\*{1,2}\s*/, '')
            j++
            while (j < body.length) {
              const l3 = body[j].trim()
              if (/^\*\*\s*答案/.test(l3)) break
              if (QUESTION_HDR.test(l3)) break
              explanation += '\n' + l3
              j++
            }
            explanation = explanation.replace(/\n{3,}/g, '\n\n').replace(/[\s\n]+$/, '')
            break
          }
          // No explicit 解析 prefix: take the trailing non-empty line as explanation.
          explanation += (explanation ? '\n' : '') + l2.replace(/^\*\*(.+?)\*\*$/, '$1')
          j++
        }
        break
      }

      // Option detection. A line starting with an option-letter prefix may contain
      // multiple options separated by spaces (file B/C style). Split uniformly.
      if (/^[A-J][\.、）)]/.test(line)) {
        sawOption = true
        const parts = line
          .split(/(?=[A-J][\.、）)])/)
          .map((s) => s.trim())
          .filter((p) => /^[A-J][\.、)]/.test(p))
        for (const p of parts) {
          const o = parseOptionsFromLine(p)
          if (o && !options.find((x) => x.key === o.key)) options.push(o)
        }
        j++
        continue
      }

      if (!sawOption) {
        stemParts.push(line)
      }
      j++
    }

    // Skip broken entries
    if (!answerRaw) continue

    const stem = cleanStem(stemParts.join(' '))

    // 检查是否是判断题（选项为"正确"和"错误"）
    const isJudgementOptions = options.length === 2 &&
      options.some(o => o.text === '正确') &&
      options.some(o => o.text === '错误')

    // Detect type early so we can synthesize options for judgement questions.
    let { kind, normalized } = detectAnswerType(answerRaw)

    // 如果选项是"正确"和"错误"，且答案是 A 或 B，则识别为判断题
    if (isJudgementOptions && /^[AB]$/.test(answerRaw.trim().toUpperCase())) {
      kind = 'judgement'
      const correctOption = options.find(o => o.key === answerRaw.trim().toUpperCase())
      normalized = correctOption?.text || '正确'
    }

    // 跳过无法识别答案格式的题目（如填空/简答）
    if (kind === 'skip') continue

    // Drop entries where source md lost the options AND the answer is a bare letter
    // (can't reconstruct). Judgement-type entries get synthesised options below.
    if (kind !== 'judgement' && kind !== 'fill' && options.length === 0) continue
    if (!stem && options.length === 0) continue
    // Multi-choice with answer letters missing from options: source data is broken.
    if (kind === 'multi' && ![...normalized].every((k) => options.find((o) => o.key === k)))
      continue

    let finalOptions = options
    let answerKey = normalized
    let answerText = ''
    let multiAnswer = false

    if (kind === 'judgement') {
      // Synthesise 正确/错误 options.
      const correctKey = normalized === '正确' ? 'A' : 'B'
      finalOptions = [
        { key: 'A', text: '正确' },
        { key: 'B', text: '错误' },
      ]
      answerKey = correctKey
      answerText = normalized
    } else if (kind === 'multi') {
      multiAnswer = true
      answerKey = normalized // e.g. "ABC"
      const matched = options.filter((o) => normalized.includes(o.key))
      answerText = matched.map((o) => o.text).join(' / ')
    } else if (kind === 'fill') {
      // 填空题
      answerKey = 'FILL'
      answerText = normalized
    } else {
      // single
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

    // Don't advance i here — outer loop continues from where body scan stopped.
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
  // History questions don't use grammar-point tagging; derive chapter tag from groupTitle instead.
  const tags: string[] = []
  const chapterMatch = q.groupTitle.match(
    /第([一二三四五六七八九十]+)套|第([一二三四五六七八九十]+)章/,
  )
  if (chapterMatch) tags.push(`第${chapterMatch[1] || chapterMatch[2]}章`)
  if (q.multiAnswer) tags.push('多选题')
  if (q.questionType === 'judgement') tags.push('判断题')
  if (q.questionType === 'single') tags.push('单选题')
  if (q.questionType === 'fill') tags.push('填空题')

  for (const t of extractExplicitTags(q.explanation)) tags.push(t)

  // Content-based light tagging (反帝/反封建/党史/条约 etc.)
  const full = q.stem + ' ' + q.explanation
  const contentTags: [string, RegExp][] = [
    ['鸦片战争', /鸦片战争/],
    ['南京条约', /《南京条约》/],
    ['马关条约', /《马关条约》/],
    ['辛丑条约', /《辛丑条约》/],
    ['北京条约', /《北京条约》/],
    ['太平天国', /太平天国|洪秀全/],
    ['洋务运动', /洋务/],
    ['戊戌维新', /戊戌|维新/],
    ['辛亥革命', /辛亥革命|孙中山/],
    ['中共党史', /中共[一大二三四大五六七大]/],
    ['国共合作', /国共合作|统一战线/],
    ['南昌起义', /南昌起义/],
    ['秋收起义', /秋收起义/],
    ['长征', /长征|遵义会议/],
    ['抗日战争', /抗日战争|抗日|九一八|七七/],
    ['解放战争', /解放战争|三大战役/],
    ['新文化运动', /新文化运动/],
    ['五四运动', /五四运动/],
    ['半殖民地半封建', /半殖民地半封建/],
  ]
  for (const [t, re] of contentTags) {
    if (re.test(full)) tags.push(t)
  }

  return { tags: [...new Set(tags)], grammarPoints: [] }
}

function main() {
  const rawDir = path.resolve(__dirname, '../data/raw/history')
  const outPath = path.resolve(__dirname, '../public/history-question-bank.json')
  const reportPath = path.resolve(__dirname, '../data/processed/history-validation-report.json')

  const all: RawQuestion[] = []
  for (const spec of FILES) {
    const parsed = parseFile(spec, rawDir)
    all.push(...parsed)
  }

  // Domain-internal dedup. User rule: duplicates are only compared WITHIN a single domain
  // (priority domain: t0/t1/t2/t3/t5-*, or each unit domain: hist-a / hist-b / hist-c).
  // Cross-domain overlap (e.g. t0 vs hist-a) is intentional — do NOT dedupe across.
  const PRIORITY_DOMAIN = new Set(['t0', 't1', 't2', 't3', 't5-1', 't5-2', 't5-3', 't5-4'])
  const UNIT_DOMAINS = [['hist-a'], ['hist-b'], ['hist-c'], ['hist-d']]
  // Priority within a domain — lower wins.
  const PRIO_ORDER = ['t0', 't1', 't2', 't3', 't5-1', 't5-2', 't5-3', 't5-4']
  const prio = (gid: string): number => {
    const i = PRIO_ORDER.indexOf(gid)
    return i < 0 ? 100 : i
  }
  // AI-curated: questions to drop because they are answer-conflict duplicates
  // (same stem+type as another question in the same domain, but this version's answer is wrong)
  const DROP_WRONG_ANSWER = new Set<string>([
    't2-q00090', // "百日维新书改"答"高等学校"，正解"高等学堂"(t0-q00183)
    't1-q00233', // "三种建国方案"第三项"官僚资本主义方案"错，正解"工人阶级方案"(t3-q00087)
  ])

  const domains: string[][] = [PRIO_ORDER, ...UNIT_DOMAINS]
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
      if (qs.length === 1) {
        const q = qs[0]
        keepIds.add(`${q.groupId}-q${String(q.numberInGroup).padStart(5, '0')}`)
        continue
      }
      // Sort: prefer more options, then higher-priority group, then longer explanation.
      // Also drop explicitly-wrong-answer versions.
      qs.sort((a, b) => {
        const aid = `${a.groupId}-q${String(a.numberInGroup).padStart(5, '0')}`
        const bid = `${b.groupId}-q${String(b.numberInGroup).padStart(5, '0')}`
        const aDrop = DROP_WRONG_ANSWER.has(aid) ? 1 : 0
        const bDrop = DROP_WRONG_ANSWER.has(bid) ? 1 : 0
        if (aDrop !== bDrop) return aDrop - bDrop // dropped version goes last
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

  // Enrich + assign IDs
  const enriched = filtered.map((q, i) => {
    const { tags, grammarPoints } = tagQuestion(q)
    return {
      id: `${q.groupId}-q${String(q.numberInGroup).padStart(5, '0')}`,
      category: 'history' as const,
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
        file:
          FILES.find(
            (f) => q.groupId === f.baseGroupId || q.groupId.startsWith(f.baseGroupId + '-'),
          )?.file || '',
        group: q.groupTitle,
        position: i + 1,
      },
      status: 'ready' as const,
      multiAnswer: q.multiAnswer,
      questionType: q.questionType,
    }
  })

  // Validation report
  const report: string[] = []
  report.push(`总题数: ${enriched.length}`)

  const byGroup: Record<string, number> = {}
  for (const q of enriched) byGroup[q.groupId] = (byGroup[q.groupId] || 0) + 1
  for (const [gid, count] of Object.entries(byGroup).sort()) {
    report.push(`  ${gid}: ${count}题`)
  }

  const missingStem = enriched.filter((q) => !q.stem)
  // 填空题不需要选项，排除在外
  const missingOptions = enriched.filter((q) => q.questionType !== 'fill' && q.options.length < 2)
  const missingAnswer = enriched.filter((q) => !q.answerKey)
  // 填空题不需要解析，排除在外
  const missingExplanation = enriched.filter((q) => q.questionType !== 'fill' && !q.explanation)
  const answerNotInOptions = enriched.filter((q) => {
    // 填空题不需要选项匹配
    if (q.questionType === 'fill') return false
    if (q.multiAnswer) {
      // Each letter of answerKey must be in options
      return ![...q.answerKey].every((k) => q.options.find((o) => o.key === k))
    }
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

  // Type breakdown
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
