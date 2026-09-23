/**
 * 试卷 markdown → 结构化题目的**共享解析器**。
 *
 * 从 `scripts/parse-japanese-2024-markdown.ts` 原样抽出（正则与判定条件一字不改），
 * 供"日语 2024 真题"和"PDF-OCR 生成的新试卷"共用 —— 避免两份正则各自漂移。
 *
 * 相对原实现只加两处**可选**能力（默认关闭，保证原调用方行为逐字节不变）：
 *   1. `groupName`：题组标题里 `：` **后面的名字**。
 *      原实现用 `last[0]`（matchAll 的匹配子串）当标题，只能拿到 `题组一：`，
 *      冒号后的名字取不到 —— 站上的题单名因此永远是残名（详见 docs §26.2）。
 *   2. `keepStemNewlines`：题干**保留换行**。
 *      原实现把多行题干用空格拼成一行（`:296`），公共题干里的代码块会变成一整行；
 *      PDF-OCR 生成的新试卷需要保留换行才能把代码块渲染成代码块（docs §8.4）。
 *
 * 契约（不可协商，来自真实试卷）：`### 第N题` / `## 题组{一…十}：` / `#### 题目` /
 * 行首 `A.` 选项 / `#### 答案与解析` + `**正确答案：X text**`。
 */

export interface RawQuestion {
  groupId: string
  /** 与原实现一致：`题组一：`（只到冒号） */
  groupTitle: string
  /** 新增：`：` 后面的名字（原实现取不到）；没有就为空串 */
  groupName: string
  numberInGroup: number
  stem: string
  options: { key: string; text: string }[]
  answerKey: string
  answerText: string
  translation: string
  explanation: string
}

export interface ParseOptions {
  /** 题干保留换行（默认 false ＝ 与原实现一致，用空格拼成一行） */
  keepStemNewlines?: boolean
}

/**
 * 选项/答案允许的字母。**到 E 为止**：多选题实测有 5 个选项（ABCDE）。
 *
 * 以前这里是写死的 `[A-D]`，两个后果（用户 2026-09-22 报的"多选题题型不对 / 答案不显示"）：
 *   1. 第 5 个选项（E）被当成题干正文吞掉；
 *   2. 答案正则只捕获**一个**字母 —— `**正确答案：AC 甲、丙**` 解析成 `answerKey='A'`，
 *      `answerText='C 甲、丙'`；于是 `answerKey.length > 1` 永远不成立，
 *      **多选题在站上永远是单选**，正确答案也少了后半个。
 */
const LETTERS = 'A-E'
const OPTION_TEST = new RegExp(`^[${LETTERS}][\\.\\s、]`)
const OPTION_CAPTURE = new RegExp(`^([${LETTERS}])[\\.\\s、]+(.+)`)
/**
 * 答案行：`**正确答案：AC 甲、丙**`。
 *
 * 字母部分**可省略** —— 主观题/填空题的答案就是一段文本（评分标准）：
 * `**正确答案：对 2分 劳动是创造价值的唯一源泉…**`。省略时 answerKey 为空、
 * 答案进 answerText（站上的填空题就是拿它比对/展示的）。
 */
const ANSWER_BOLD = new RegExp(`\\*\\*正确答案[：:]\\s*([${LETTERS}]{1,5})?\\s*(.+?)\\*\\*`)
const ANSWER_PLAIN = new RegExp(`正确答案[：:]\\s*([${LETTERS}]{1,5})\\s*(\\S+)`)
/** S4 找不到答案时写的占位，不是答案 */
const PENDING_ANSWER = /^[（(]?\s*待补\s*[）)]?$/

/** 答案字母去重 + 升序（站上判分用集合比较，但展示要整齐）。 */
function normalizeAnswerKey(raw: string): string {
  return [...new Set(raw.toUpperCase().split(''))].sort().join('')
}

/** 答案文本兜底：按答案字母把选项原文拼起来（多选就是 `甲、丙`）。 */
function answerTextFromOptions(answerKey: string, options: { key: string; text: string }[]): string {
  const parts = answerKey
    .split('')
    .map((key) => options.find((o) => o.key === key)?.text || '')
    .filter(Boolean)
  return parts.join('、')
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

const GROUP_MATCH = /## 题组([一二三四五六七八九十])[：:]/g
// 行首锚定版：用来把 `：` 后面的名字也抓下来
const GROUP_LINE = /^##\s*题组([一二三四五六七八九十])[：:]\s*(.*)$/gm

interface GroupRef {
  groupId: string
  groupTitle: string
  groupName: string
}

/** 取这一段文本里**最后一个**题组标题（题组标题夹在上一题的块里，所以要看块内最后一次出现）。 */
function lastGroupIn(block: string): GroupRef | null {
  const matches = [...block.matchAll(GROUP_MATCH)]
  if (matches.length === 0) return null
  const last = matches[matches.length - 1]
  const groupId = `g${CHINESE_NUM_MAP[last[1]]}`
  const groupTitle = last[0].replace(/^##\s*/, '').trim()
  let groupName = ''
  const lines = [...block.matchAll(GROUP_LINE)]
  if (lines.length > 0) {
    const line = lines[lines.length - 1]
    if (line[1] === last[1]) groupName = (line[2] || '').trim()
  }
  return { groupId, groupTitle, groupName }
}

// Walk the raw markdown once and figure out which passage (文章) applies to
// each question. Two patterns matter:
//   1. 题组七 完形填空: a single shared article lives under `**文章：**`
//      before any `### 第N题`. It applies to every question in the group.
//   2. 题组八 阅读理解: each `### 文章（X）` block introduces a passage
//      that applies to every subsequent question until the next `### 文章（Y）`.
// Articles are prepended to question stems so the quiz page shows the full
// passage instead of just the one-line prompt.
export function extractArticles(content: string): Map<number, string> {
  const map = new Map<number, string>()
  const lines = content.split('\n')
  let currentArticle = ''
  let inArticle = false

  const flushTo = (qNum: number) => {
    const body = currentArticle.trim()
    if (body) map.set(qNum, body)
  }

  for (const raw of lines) {
    const trimmed = raw.trim()

    // Any ## header (new group, answer summary, etc.) resets the article.
    if (/^##\s/.test(trimmed)) {
      currentArticle = ''
      inArticle = false
      continue
    }

    // Shared article declaration: **文章：**
    if (/^\*\*文章[：:]\*\*$/.test(trimmed)) {
      inArticle = true
      currentArticle = ''
      continue
    }

    // Per-article declaration: ### 文章（X）
    if (/^###\s+文章[（(]/.test(trimmed)) {
      inArticle = true
      currentArticle = ''
      continue
    }

    // Question marker: attach current article (if any), keep it sticky so the
    // next question without a new `### 文章` declaration inherits the same
    // passage.
    const qMatch = trimmed.match(/^###\s+第(\d+)题/)
    if (qMatch) {
      flushTo(parseInt(qMatch[1]))
      inArticle = false
      continue
    }

    // Horizontal rule ends the article body but keeps the accumulated text
    // attached for the next question.
    if (trimmed === '---') {
      inArticle = false
      continue
    }

    if (inArticle) {
      // Preserve the original line (including blank lines) so markdown
      // constructs like tables — which rely on consecutive `|...|` rows —
      // survive into the rendered stem.
      currentArticle += raw + '\n'
    }
  }

  return map
}

export function parseExamMarkdown(content: string, options: ParseOptions = {}): RawQuestion[] {
  const join = options.keepStemNewlines ? '\n' : ' '
  const questions: RawQuestion[] = []
  const articleByQ = extractArticles(content)

  let currentGroupId = 'g00'
  let currentGroupTitle = ''
  let currentGroupName = ''

  const blocks = content.split(/(?=### 第\d+题)/)

  for (const block of blocks) {
    const qNumMatch = block.match(/^### 第(\d+)题/)
    if (!qNumMatch) {
      // Use last match to skip answer-summary headers like 题组一答案汇总
      const group = lastGroupIn(block)
      if (group) {
        currentGroupId = group.groupId
        currentGroupTitle = group.groupTitle
        currentGroupName = group.groupName
      }
      continue
    }

    const num = parseInt(qNumMatch[1])
    const body = block.replace(/^### 第\d+题\s*\n*/, '')

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

    const metaBoundary = expSection.match(/(?:^|\n)(?:##\s|### 本组核心知识点总结)/m)
    if (metaBoundary && metaBoundary.index !== undefined) {
      expSection = expSection.slice(0, metaBoundary.index).replace(/[\s\n]+$/, '')
    }

    const stemLines = stem.split('\n')
    let cleanStem = ''
    const optionLines: string[] = []
    let foundOptions = false
    let inTranslation = false
    const transLines: string[] = []

    for (const line of stemLines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (OPTION_TEST.test(trimmed)) {
        foundOptions = true
        inTranslation = false
        optionLines.push(trimmed)
        continue
      }
      if (/^题目翻译[：:]?/.test(trimmed)) {
        const after = trimmed.replace(/^题目翻译[：:]?\s*/, '')
        if (after) transLines.push(after)
        inTranslation = true
        continue
      }
      if (trimmed.startsWith('#')) continue
      if (trimmed.startsWith('>')) continue
      if (inTranslation) {
        transLines.push(trimmed)
        continue
      }
      if (!foundOptions) {
        cleanStem += (cleanStem ? join : '') + trimmed
      }
    }

    const transLine = transLines.join(' ').trim()

    const options: { key: string; text: string }[] = []
    for (const line of optionLines) {
      const m = line.match(OPTION_CAPTURE)
      if (m) {
        let text = m[2].trim()
        text = text.replace(/。$/, '').replace(/^[>]\s*/, '')
        options.push({ key: m[1], text })
      }
    }

    if (options.length === 0 && expSection) {
      const expLines = expSection.split('\n')
      for (const line of expLines) {
        const m = line.trim().match(OPTION_CAPTURE)
        if (m) {
          const text = m[2].trim().replace(/。$/, '')
          options.push({ key: m[1], text })
        }
      }
    }

    const answerMatch = expSection.match(ANSWER_BOLD)
    let answerKey = ''
    let answerText = ''
    if (answerMatch) {
      const letters = answerMatch[1] ? normalizeAnswerKey(answerMatch[1]) : ''
      const body = answerMatch[2].trim()
      const optionKeys = new Set(options.map((o) => o.key))
      // 字母必须**确实是这道题的选项**：否则 `**正确答案：Add $t0**` 这种纯文本答案
      // 会被误当成 answerKey='A'
      if (letters && [...letters].every((ch) => optionKeys.has(ch))) {
        answerKey = letters
        answerText = body
      } else {
        const text = `${answerMatch[1] ?? ''}${body}`.trim()
        answerText = PENDING_ANSWER.test(text) ? '' : text
      }
    } else {
      const tableMatch = expSection.match(ANSWER_PLAIN)
      if (tableMatch) {
        answerKey = normalizeAnswerKey(tableMatch[1])
        answerText = tableMatch[2]
      }
    }

    let translation = transLine
    if (!translation && expSection) {
      const tMatch = expSection.match(/题目翻译[：:]\s*(.+?)(?:\n|$)/)
      if (tMatch) translation = tMatch[1].trim()
      if (!translation) {
        const sMatch = expSection.match(/(?:句子翻译|句意|句子意思)[：:]\s*\n?\s*(.+?)(?:\n|$)/)
        if (sMatch) translation = sMatch[1].trim()
      }
    }

    cleanStem = cleanStem.replace(/^[\s\n]+/, '').trim()

    // 收录条件：**必须真有答案**（`**正确答案：（待补）**` 不算），且
    // 选项 ≥2，或没有选项但有**答案文本**（主观题/填空题的参考答案就是那段文本）。
    // 与 `5_check.py` 的口径必须一字一致：那边有"缺答案"这条丢弃理由，
    // 否则 S6 会因"解析端收下 N 题 ≠ S5 记录的 M 题"而拒绝发布（实测差 3 道）。
    const answered = Boolean(answerKey || answerText)
    if (cleanStem && answered && (options.length >= 2 || (options.length === 0 && answerText))) {
      const article = articleByQ.get(num)
      const stemWithArticle = article ? `${article}\n\n${cleanStem}` : cleanStem
      questions.push({
        groupId: currentGroupId,
        groupTitle: currentGroupTitle,
        groupName: currentGroupName,
        numberInGroup: num,
        stem: stemWithArticle,
        options,
        answerKey,
        answerText: answerText || answerTextFromOptions(answerKey, options) || '',
        translation,
        explanation: expSection,
      })
    }

    const nextGroup = lastGroupIn(block)
    if (nextGroup) {
      currentGroupId = nextGroup.groupId
      currentGroupTitle = nextGroup.groupTitle
      currentGroupName = nextGroup.groupName
    }
  }

  return questions
}
