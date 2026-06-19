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
  translation: string
  explanation: string
}

const CHINESE_NUM_MAP: Record<string, string> = {
  一: '01',
  二: '02',
  三: '03',
  四: '04',
  五: '05',
  六: '06',
  七: '07',
  八: '08',
  九: '09',
  十: '10',
}

function tagQuestion(q: RawQuestion): { grammarPoints: string[]; tags: string[] } {
  const grammarPoints: string[] = []
  const tags: string[] = []
  const full = (q.stem + ' ' + q.explanation + ' ' + q.groupTitle).toLowerCase()

  const grammarMap: [string, RegExp][] = [
    ['ように', /ように/],
    ['ようにしている', /ようにしている/],
    ['ようにしてください', /ようにしてください/],
    ['ようになる', /ようになる/],
    ['ないで', /ないで/],
    ['とおりに/どおりに', /[とど]おりに/],
    ['た後で', /後で|あとで/],
    ['気が付く', /気が付[くき]/],
    ['命令形', /命令形/],
    ['禁止形', /禁止形|辞书形.*な/],
    ['てあります', /てあります/],
    ['なさい', /なさい/],
    ['ほうがいい', /ほうがいい/],
    ['かもしれません', /かもしれません/],
    ['こそあど', /[こそあど]んなに|[こそあど]の/],
    ['通う', /通[うい]/],
    ['実は', /実は/],
    ['〜し', /列举理由|〜し/],
    ['ながら', /ながら/],
    ['それで', /それで/],
    ['聞こえる', /聞こえ/],
    ['見られる', /見られる/],
    ['しか', /しか/],
    ['可能形', /可能形|可能动[词詞]/],
    ['自他动词', /自动词|他动词|自他/],
    ['てしまう', /てしまう|てしま[いっ]/],
    ['たしか', /たしか/],
    ['んです', /んです/],
    ['何も/何か', /何[もか]/],
    ['いただけませんか', /いただけませんか/],
    ['なかなか〜ない', /なかなか.*ない/],
    ['存在句', /存在句|に.*ある|に.*いる/],
    ['は对比', /对比|は.*は/],
    ['副词', /副词|たいてい|ちょうど|はっきり/],
    ['寒暄表达', /寒暄|それは大変|おかげさまで|お気をつけて/],
  ]
  for (const [gp, re] of grammarMap) {
    if (re.test(full)) grammarPoints.push(gp)
  }

  const tagMap: [string, RegExp][] = [
    ['ように', /ように/],
    ['ない形', /ない形|否定形/],
    ['目的表达', /为了|为了不/],
    ['可能形', /可能形|可能动[词辭]/],
    ['ようになる', /ようになる/],
    ['一段动词', /一段|二类/],
    ['五段动词', /五段|一类/],
    ['どおりに', /[とど]おりに/],
    ['名词接续', /名词.*接|N\s*\+/],
    ['に', /助词.*に|に.*固定|に.*搭配/],
    ['を', /助词.*を|を.*表示/],
    ['が', /助词.*が|が.*主语/],
    ['で', /助词.*で|で.*表示/],
    ['と', /助词.*と|と.*引用/],
    ['命令形', /命令形/],
    ['禁止形', /禁止形/],
    ['てあります', /てあります/],
    ['他动词', /他动词/],
    ['状态', /状态/],
    ['自动词', /自动词/],
    ['ている', /ている|状態/],
    ['ほうがいい', /ほうがいい/],
    ['かもしれません', /かもしれません/],
    ['こそあど', /こそあど|[こそあど]んなに/],
    ['后缀', /后缀|〜[家員士客]/],
    ['固定搭配', /固定搭配|固定常用|固定/],
    ['场景表达', /场景|寒暄/],
    ['副词', /副词/],
    ['数量+しか', /しか/],
    ['对比', /对比/],
    ['んです', /んです/],
    ['なかなか', /なかなか/],
    ['てしまう', /てしまう/],
    ['存在句', /存在/],
    ['尊敬语', /敬語|礼貌|いただけ/],
    ['easy', /基本|简单/],
    ['medium', /注意|需要|中等/],
    ['hard', /难|易错|重要|关键/],
  ]
  for (const [t, re] of tagMap) {
    if (re.test(full)) tags.push(t)
  }

  return { grammarPoints: [...new Set(grammarPoints)], tags: [...new Set(tags)] }
}

function parseMarkdown(filePath: string): RawQuestion[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const questions: RawQuestion[] = []

  let currentGroupId = 'g00'
  let currentGroupTitle = ''

  // Split into blocks by ### 第N题
  const blocks = content.split(/(?=### 第\d+题)/)

  for (const block of blocks) {
    // Check if block starts with ### 第N题
    const qNumMatch = block.match(/^### 第(\d+)题/)
    if (!qNumMatch) {
      // Non-question block: still check for group headers
      const gMatch = block.match(/## 题组([一二三四五六七八九十])/)
      if (gMatch) {
        currentGroupId = `g${CHINESE_NUM_MAP[gMatch[1]]}`
        currentGroupTitle = gMatch[0].replace(/^##\s*/, '').trim()
      }
      continue
    }

    const num = parseInt(qNumMatch[1])
    const body = block.replace(/^### 第\d+题\s*\n*/, '')

    // Extract stem - between #### 题目 and option lines
    const stemSection = body.split(/####\s+(?:题目|答案与解析)/)
    let stem = ''
    let expSection = ''

    if (body.includes('#### 题目')) {
      const parts = body.split(/####\s+/)
      let inStem = false
      let inExp = false
      for (const part of parts) {
        if (part.startsWith('题目')) {
          inStem = true
          inExp = false
          stem = part.replace(/^题目\s*\n*/, '').trim()
          continue
        }
        if (part.startsWith('答案与解析')) {
          inStem = false
          inExp = true
          expSection = part.replace(/^答案与解析\s*\n*/, '').trim()
          continue
        }
        if (inStem) stem += '\n' + part
        if (inExp) expSection += '\n' + part
      }
    }

    // Truncate expSection at trailing meta-content (group summary, next group
    // header, appendix). The last question of a file or group otherwise
    // absorbs everything up to the next `### 第N题`, pulling in summaries and
    // the answer appendix.
    const metaBoundary = expSection.match(/(?:^|\n)(?:##\s|### 本组核心知识点总结)/m)
    if (metaBoundary) {
      expSection = expSection.slice(0, metaBoundary.index).replace(/[\s\n]+$/, '')
    }

    // Clean stem - extract just the Japanese sentence (before options)
    // 题目翻译： marker may sit on its own line, with the translation body
    // on subsequent lines — collect everything after the marker until options.
    const stemLines = stem.split('\n')
    let cleanStem = ''
    const optionLines: string[] = []
    let foundOptions = false
    let inTranslation = false
    const transLines: string[] = []

    for (const line of stemLines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // Option lines end the translation block
      if (/^[A-D][\.\s、]/.test(trimmed)) {
        foundOptions = true
        inTranslation = false
        optionLines.push(trimmed)
        continue
      }
      // Translation marker: start collecting translation text
      if (/^题目翻译[：:]?/.test(trimmed)) {
        const after = trimmed.replace(/^题目翻译[：:]?\s*/, '')
        if (after) transLines.push(after)
        inTranslation = true
        continue
      }
      // Skip markdown headers / quotes inside the stem section
      if (trimmed.startsWith('#')) continue
      if (trimmed.startsWith('>')) continue
      // Once the translation marker has appeared, every subsequent non-option
      // line belongs to the translation, not the stem.
      if (inTranslation) {
        transLines.push(trimmed)
        continue
      }
      if (!foundOptions) {
        cleanStem += (cleanStem ? ' ' : '') + trimmed
      }
    }

    const transLine = transLines.join(' ').trim()

    // Parse options
    const options: { key: string; text: string }[] = []
    for (const line of optionLines) {
      const m = line.match(/^([A-D])[\.\s、]+(.+)/)
      if (m) {
        let text = m[2].trim()
        // Clean up common artifacts
        text = text.replace(/。$/, '').replace(/^[>]\s*/, '')
        options.push({ key: m[1], text })
      }
    }

    // If options not found inside stem section, try expSection
    if (options.length === 0 && expSection) {
      const expLines = expSection.split('\n')
      for (const line of expLines) {
        const m = line.trim().match(/^([A-D])[\.\s、]+(.+)/)
        if (m) {
          let text = m[2].trim().replace(/。$/, '')
          options.push({ key: m[1], text })
        }
      }
    }

    // Extract answer
    const answerMatch = expSection.match(/\*\*正确答案[：:]\s*([A-D])\s*(.+?)\*\*/)
    let answerKey = ''
    let answerText = ''
    if (answerMatch) {
      answerKey = answerMatch[1]
      answerText = answerMatch[2].trim()
    } else {
      // Try to find from answer table
      const tableMatch = expSection.match(/正确答案[：:]\s*([A-D])\s*(\S+)/)
      if (tableMatch) {
        answerKey = tableMatch[1]
        answerText = tableMatch[2]
      }
    }

    // Grab translation if not found yet
    let translation = transLine
    if (!translation && expSection) {
      const tMatch = expSection.match(/题目翻译[：:]\s*(.+?)(?:\n|$)/)
      if (tMatch) translation = tMatch[1].trim()
      if (!translation) {
        const sMatch = expSection.match(/(?:句子翻译|句意|句子意思)[：:]\s*\n?\s*(.+?)(?:\n|$)/)
        if (sMatch) translation = sMatch[1].trim()
      }
    }

    // Clean up the stem - remove extraneous text
    cleanStem = cleanStem.replace(/^[\s\n]+/, '').trim()

    if (cleanStem && options.length >= 2 && answerKey) {
      questions.push({
        groupId: currentGroupId,
        groupTitle: currentGroupTitle,
        numberInGroup: num,
        stem: cleanStem,
        options,
        answerKey,
        answerText: answerText || options.find((o) => o.key === answerKey)?.text || '',
        translation,
        explanation: expSection,
      })
    }

    // After processing this question, check for group header for NEXT question
    const nextGMatch = block.match(/## 题组([一二三四五六七八九十])/)
    if (nextGMatch) {
      currentGroupId = `g${CHINESE_NUM_MAP[nextGMatch[1]]}`
      currentGroupTitle = nextGMatch[0].replace(/^##\s*/, '').trim()
    }
  }

  return questions
}

function main() {
  const rawPath = path.resolve(__dirname, '../data/raw/日语期末复习题目答案解析_题目选项在上版.md')
  const outPath = path.resolve(__dirname, '../public/question-bank.json')

  const rawQuestions = parseMarkdown(rawPath)

  const enriched = rawQuestions.map((q, i) => {
    const { grammarPoints, tags } = tagQuestion(q)
    return {
      id: `${q.groupId}-q${String(q.numberInGroup).padStart(2, '0')}`,
      groupId: q.groupId,
      groupTitle: q.groupTitle,
      numberInGroup: q.numberInGroup,
      stem: q.stem,
      options: q.options,
      answerKey: q.answerKey,
      answerText: q.answerText,
      translation: q.translation,
      explanation: q.explanation,
      grammarPoints,
      tags,
      source: {
        file: '日语期末复习题目答案解析_题目选项在上版.md',
        group: q.groupTitle,
        position: i + 1,
      },
      status: 'ready' as const,
    }
  })

  const report: string[] = []
  report.push(`总题数: ${enriched.length}`)

  const missingStem = enriched.filter((q) => !q.stem)
  const missingOptions = enriched.filter((q) => q.options.length < 2)
  const missingAnswer = enriched.filter((q) => !q.answerKey)
  const answerNotInOptions = enriched.filter(
    (q) => q.answerKey && !q.options.find((o) => o.key === q.answerKey),
  )
  const ids = enriched.map((q) => q.id)
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i)

  if (missingStem.length) report.push(`⚠ 缺题干: ${missingStem.map((q) => q.id).join(', ')}`)
  if (missingOptions.length)
    report.push(`⚠ 缺选项(${missingOptions.length}): ${missingOptions.map((q) => q.id).join(', ')}`)
  if (missingAnswer.length) report.push(`⚠ 缺答案: ${missingAnswer.map((q) => q.id).join(', ')}`)
  if (answerNotInOptions.length)
    report.push(`⚠ 答案不在选项中: ${answerNotInOptions.map((q) => q.id).join(', ')}`)
  if (dupIds.length) report.push(`⚠ 重复ID: ${dupIds.join(', ')}`)

  // Check groups
  const groups: Record<string, number[]> = {}
  for (const q of enriched) {
    if (!groups[q.groupId]) groups[q.groupId] = []
    groups[q.groupId].push(q.numberInGroup)
  }
  for (const [gid, nums] of Object.entries(groups)) {
    const sorted = [...nums].sort((a, b) => a - b)
    const max = sorted[sorted.length - 1]
    report.push(`  ${gid}: ${sorted.length}题, 编号 ${sorted.join(', ')}`)
  }

  report.push('✅ 校验完成')

  fs.writeFileSync(outPath, JSON.stringify(enriched, null, 2), 'utf-8')
  fs.writeFileSync(
    path.resolve(__dirname, '../data/processed/validation-report.json'),
    JSON.stringify(
      { report, generatedAt: new Date().toISOString(), count: enriched.length },
      null,
      2,
    ),
    'utf-8',
  )

  console.log(report.join('\n'))
  console.log(`\n输出: ${outPath} (${enriched.length} 题)`)
}

main()
