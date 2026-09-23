/**
 * S6：把**通过 S5 校验的**试卷 markdown → `public/<key>-question-bank.json`
 *
 * 这一环是"网页题目卡片"的数据来源，也是**发布门禁**：没有 S5 结论、结论未通过、
 * 或 md 在校验之后又改过，都拒绝生成（见 docs §28.4）。
 *
 * **不需要在这里登记试卷**：试卷清单来自 `data/processed/*-check.json`（S5 写的，
 * 随仓库入库），所以 `pdf-ocr/6_publish.py` 或 `npm run parse:computerPaper` 会自动处理
 * 所有已通过校验的试卷。要只处理一份就传 `--key`。
 *
 * 复用 `scripts/lib/parse-exam-markdown.ts`（与「日语 2024 真题」同一套正则与收录条件），
 * 这里只做新试卷特有的四件事：
 *   1. **题干保留换行**（`keepStemNewlines: true`）—— 公共题干里有 MIPS 代码块（§8.4）；
 *   2. **题单名取 `：` 后面的真名**（`groupName`）—— 参考实现拿到的只是 `题组一：`（§26.2）；
 *   3. `> ⚠ 待核对：…` → `status: 'needs_review'` + `reviewNotes`（§27.2）；
 *   4. `> ⚙ 解析由 AI 生成…` → `explanationSource: 'generated'`，并把答案行/CRLF 清掉（§8.5）。
 *
 * 用法：
 *   tsx scripts/parse-computer-paper.ts              # 所有已通过 S5 的试卷
 *   tsx scripts/parse-computer-paper.ts --key <key>  # 只处理一份
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

import { parseExamMarkdown } from './lib/parse-exam-markdown'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')
const PROCESSED = path.join(root, 'data', 'processed')

/** S4 给 AI 生成的解析留的可见标记（见 docs §8.5） */
const GENERATED_NOTE = '> ⚙ 解析由 AI 生成'
/**
 * 解析区开头的答案行。
 *
 * 解析端（沿用日语那条的实现）把 `#### 答案与解析` 之后的**全部内容**都塞进 `explanation`，
 * 所以它开头会带一行 `**正确答案：B 105**`。但仓库里既有题库的 `explanation` **不含**答案行
 * （`computer-midterms` / `japanese2` 都是），留着会在站上把答案显示两遍 → 这里剥掉。
 */
const ANSWER_LINE = /^\s*\*\*正确答案[：:][^\n]*\*\*[ \t]*\n?/

interface ParsedQuestion {
  id: string
  category: string
  groupId: string
  groupTitle: string
  numberInGroup: number
  stem: string
  options: { key: string; text: string }[]
  answerKey: string
  answerText: string
  translation: string
  explanation: string
  grammarPoints: string[]
  tags: string[]
  source: { file: string; group: string; position: number }
  status: 'ready' | 'needs_review'
  answerProvenance: 'printed'
  explanationSource: 'printed' | 'generated' | 'none'
  reviewNotes?: string[]
  multiAnswer?: boolean
  questionType: 'single' | 'multi' | 'judgement' | 'fill'
}

/** 判断题的选项文本（`A. 正确 / B. 错误` 这类）。 */
const TRUE_FALSE_TEXTS = new Set(['正确', '错误', '对', '错', '是', '否', 'true', 'false', '√', '×'])

/**
 * 按"答案 + 选项"判题型 —— **md 里不写题型**，只能这么判。
 *
 * 以前这里只有 `isMulti = answerKey.length > 1` 一个分支，且联合类型里**没有 judgement**，
 * 于是判断题（A.正确/B.错误）和填空题全被当成 `single`，站上的题型标签与
 * 「判断题/多选/填空」练习入口都跟着错。
 */
export function inferQuestionType(q: {
  answerKey: string
  options: { key: string; text: string }[]
}): ParsedQuestion['questionType'] {
  if (q.answerKey.length > 1) return 'multi'
  if (q.options.length === 0) return 'fill'
  const texts = q.options.map((o) => o.text.trim().toLowerCase())
  if (texts.length === 2 && texts.every((t) => TRUE_FALSE_TEXTS.has(t))) return 'judgement'
  return 'single'
}

interface Paper {
  key: string
  md: string
}

/** 试卷清单 = `data/processed/*-check.json`（S5 的结论），不再需要手写登记。 */
function discoverPapers(): Paper[] {
  if (!fs.existsSync(PROCESSED)) return []
  const papers: Paper[] = []
  for (const name of fs.readdirSync(PROCESSED).sort()) {
    if (!name.endsWith('-check.json')) continue
    const verdict = JSON.parse(fs.readFileSync(path.join(PROCESSED, name), 'utf-8'))
    if (verdict.passed !== true) continue
    papers.push({ key: verdict.category || name.replace(/-check\.json$/, ''), md: verdict.md })
  }
  return papers
}

/** 逐题收集 `> ⚠ 待核对：…`（解析器会跳过 `>` 行，所以这里自己扫一遍）。 */
function reviewNotesByNumber(content: string): Map<number, string[]> {
  const map = new Map<number, string[]>()
  for (const block of content.split(/(?=### 第\d+题)/)) {
    const header = block.match(/^### 第(\d+)题/)
    if (!header) continue
    const notes = [...block.matchAll(/^>\s*⚠\s*待核对：(.*)$/gm)].map((m) => m[1].trim())
    if (notes.length) map.set(parseInt(header[1]), notes)
  }
  return map
}

/** 哪些题的解析是 AI 生成的（S4 会在解析末尾留 `> ⚙ 解析由 AI 生成…`）。 */
function generatedExplanationNumbers(content: string): Set<number> {
  const set = new Set<number>()
  for (const block of content.split(/(?=### 第\d+题)/)) {
    const header = block.match(/^### 第(\d+)题/)
    if (!header) continue
    if (block.includes(GENERATED_NOTE)) set.add(parseInt(header[1]))
  }
  return set
}

const sha256 = (file: string) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/**
 * **发布门禁**：只发布"通过 S5 校验、且校验之后没再改过"的 md。
 *
 * 校验结论在 `data/processed/<key>-check.json`（由 `pdf-ocr/5_check.py` 写出，随仓库入库），
 * 所以新克隆也能直接发布；同时比对 md 的 sha256 —— md 改过就必须重跑 S5。
 */
function requireCheckVerdict(key: string, mdPath: string) {
  const verdictPath = path.join(PROCESSED, `${key}-check.json`)
  if (!fs.existsSync(verdictPath)) {
    throw new Error(
      `没有 S5 校验结论：${path.relative(root, verdictPath)}\n` +
        `请先跑：python pdf-ocr/5_check.py --category ${key}`,
    )
  }
  const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf-8'))
  if (verdict.passed !== true) {
    const errors: string[] = verdict.hard_errors || []
    throw new Error(
      `S5 校验未通过（${errors.length} 条硬错误），拒绝生成题库：\n` +
        errors.map((e) => `  - ${e}`).join('\n'),
    )
  }
  const actual = sha256(mdPath)
  if (verdict.md_sha256 !== actual) {
    throw new Error(
      `md 在 S5 校验之后又变了（sha256 不一致），拒绝用旧结论发布：\n` +
        `  校验时: ${verdict.md_sha256}\n  现在  : ${actual}\n` +
        `请重跑：python pdf-ocr/5_check.py --category ${key}`,
    )
  }
  return verdict
}

function build(paper: Paper) {
  const mdPath = path.join(root, paper.md)
  if (!fs.existsSync(mdPath)) {
    throw new Error(`找不到 ${paper.md}；请先跑 pdf-ocr/4_build_md.py`)
  }
  const verdict = requireCheckVerdict(paper.key, mdPath)
  const content = fs.readFileSync(mdPath, 'utf-8')
  const raw = parseExamMarkdown(content, { keepStemNewlines: true })
  if (raw.length === 0) throw new Error(`${paper.md} 里没解析出任何题（检查 md 契约）`)
  if (raw.length !== verdict.parser_kept) {
    throw new Error(
      `解析端这次收下 ${raw.length} 题，与 S5 记录的 ${verdict.parser_kept} 题不一致 —— ` +
        `md 或解析器变过，请重跑 S5`,
    )
  }

  const notes = reviewNotesByNumber(content)
  const generated = generatedExplanationNumbers(content)
  const usedIds = new Set<string>()
  const questions: ParsedQuestion[] = raw.map((q, index) => {
    // id 必须全局唯一；同题号重复出现时补后缀（S4 允许跳号/拆题，不强求一一对应）
    let id = `${paper.key}-q${String(q.numberInGroup).padStart(3, '0')}`
    if (usedIds.has(id)) {
      let suffix = 2
      while (usedIds.has(`${id}-${suffix}`)) suffix += 1
      id = `${id}-${suffix}`
    }
    usedIds.add(id)

    // 题组名：优先用 md 里 `## 题组X：<名字>` 的名字，没有就退回分类名
    const groupTitle = q.groupName || paper.key
    const questionType = inferQuestionType(q)
    const isMulti = questionType === 'multi'
    const reviewNotes = notes.get(q.numberInGroup)
    // 解析端的 `explanation` 带着答案行 + CRLF，这里统一成"纯解析正文 + LF"
    const explanationRaw = q.explanation.replace(/\r\n?/g, '\n')
    const explanationText = explanationRaw.replace(ANSWER_LINE, '').trim()
    const explanationSource: ParsedQuestion['explanationSource'] = generated.has(q.numberInGroup)
      ? 'generated'
      : explanationText
        ? 'printed'
        : 'none'
    return {
      id,
      category: paper.key,
      groupId: `${paper.key}-${q.groupId}`,
      groupTitle,
      numberInGroup: q.numberInGroup,
      stem: q.stem,
      options: q.options,
      answerKey: q.answerKey,
      answerText: q.answerText,
      translation: q.translation,
      explanation: explanationText,
      grammarPoints: [],
      tags: [],
      source: { file: path.basename(paper.md), group: groupTitle, position: index + 1 },
      answerProvenance: 'printed',
      explanationSource,
      status: reviewNotes ? 'needs_review' : 'ready',
      questionType,
      ...(isMulti ? { multiAnswer: true } : {}),
      ...(reviewNotes ? { reviewNotes } : {}),
    }
  })

  const groups = [...new Set(questions.map((q) => q.groupTitle))]
  const needsReview = questions.filter((q) => q.status === 'needs_review')
  const outPath = path.join(root, 'public', `${paper.key}-question-bank.json`)
  fs.writeFileSync(outPath, JSON.stringify(questions, null, 2) + '\n', 'utf-8')

  const report = {
    category: paper.key,
    source: paper.md,
    questions: questions.length,
    groups,
    /** S5 的发布门禁结论（来源 + 时间 + 警告），出问题时好回溯 */
    s5: {
      checkedAt: verdict.checked_at,
      exitCode: verdict.exit_code,
      warnings: verdict.warnings,
    },
    explanationSource: {
      printed: questions.filter((q) => q.explanationSource === 'printed').length,
      generated: questions.filter((q) => q.explanationSource === 'generated').length,
      none: questions.filter((q) => q.explanationSource === 'none').length,
    },
    needsReview: needsReview.map((q) => ({ id: q.id, notes: q.reviewNotes })),
    numberGaps: (() => {
      const nums = questions.map((q) => q.numberInGroup)
      const gaps: string[] = []
      for (let i = 1; i < nums.length; i += 1) {
        if (nums[i] !== nums[i - 1] + 1) gaps.push(`${nums[i - 1]}→${nums[i]}`)
      }
      return gaps
    })(),
  }
  fs.mkdirSync(PROCESSED, { recursive: true })
  fs.writeFileSync(
    path.join(PROCESSED, `${paper.key}-validation-report.json`),
    JSON.stringify(report, null, 2) + '\n',
    'utf-8',
  )
  return report
}

function main() {
  const args = process.argv.slice(2)
  let key: string | null = null
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--key') key = args[++i]
  }

  const all = discoverPapers()
  const papers = key ? all.filter((p) => p.key === key) : all
  if (papers.length === 0) {
    if (key) {
      const known = all.map((p) => p.key)
      throw new Error(
        `没有叫 ${key} 的"已通过 S5 校验"的试卷。当前可用：${known.length ? known.join(', ') : '（无）'}\n` +
          `请先跑：python pdf-ocr/5_check.py --category ${key}`,
      )
    }
    console.log('[S6] 没有已通过 S5 校验的试卷（data/processed/*-check.json 一个都没有）')
    return
  }

  for (const paper of papers) {
    const report = build(paper)
    console.log(
      `${report.category}: ${report.questions} 题 / ${report.groups.length} 个题组 / ` +
        `待复核 ${report.needsReview.length} / 解析 printed ${report.explanationSource.printed}` +
        ` · generated ${report.explanationSource.generated} · none ${report.explanationSource.none}` +
        (report.numberGaps.length ? ` / ⚠ 题号缺口 ${report.numberGaps.join(', ')}` : ''),
    )
    for (const group of report.groups) console.log(`  题组: ${group}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
