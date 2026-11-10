/**
 * 创造性思维与创新方法 —— Markdown → JSON 解析器
 *
 * 输入: data/raw/creativity/*.md（目录内全部文件，按文件名排序，支持多批次追加）
 * 输出: public/creativity-question-bank.json
 *       data/processed/creativity-audit-report.json
 *
 * 源格式（两种题头变体）:
 *   ## 第1题（原题号30，单选）          ← 第一部分：旧题库
 *   ## 新7题（截图shot07，作业题号2，单选题，20分） ← 第二部分：新增批次
 * 字段: **题干：** / **选项：** / **图片答案：**或**截图答案：** / **认定答案：** / **解析：**
 *
 * 规则:
 *   - 认定答案优先作为练习答案；与图片/截图答案冲突时 status: 'needs_review'
 *     并把两套答案写入 answerNote（题目内轻量提示）与审计报告（完整记录）。
 *   - 练习答案不是教师/官方核实答案，来源仅为用户提供的分析文档。
 *   - 题目 ID = 'creativity-' + sha1(归一化题干 + 题型 + 选项文本) 前 10 位，
 *     与答案无关、与文件顺序无关：修正答案、追加批次都不会改变既有题目 ID。
 *   - 题干+题型+选项一致且答案一致的确切重复合并为一条（保留首个解析），
 *     所有来源位置记入审计报告；仅题干相同但选项/答案不同的输出疑似重复报告，不删除。
 *   - 缺字段、非法答案、无法判分 → 硬错误，非零退出码阻止生成。
 */
import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ─── 类型 ──────────────────────────────────────────────────

export type QType = 'single' | 'multi' | 'judgement'

export interface RawOption {
  key: string
  text: string
}

/** 从 Markdown 解析出的一条原始记录（未判分、未去重） */
export interface RawEntry {
  file: string
  seqLabel: string // 「第1题」/「新7题」，文档内顺序标签
  seq: number // 文档内顺序号（1-based，仅溯源）
  originalNo: number | null // 原题号（会重复，仅溯源，不可当唯一 ID）
  originRef: string // 溯源描述：「原题号30」/「截图shot07·作业题号2」
  declaredType: QType | null // 题头声明的题型
  stem: string
  options: RawOption[] // 判断题可能为空（由 正确/错误 行归一）
  judgeStyle: 'slash' | 'lines' | 'letters' | 'none' // 判断题选项的源格式
  imageAnswer: string // 图片/截图答案原始值
  confirmedAnswer: string // 认定答案原始值
  confirmedNote: string // 认定答案括号注释（如「图片答案疑误」）
  explanation: string
}

export interface BuildWarning {
  ref: string
  code: string
  detail: string
}

export interface AnswerConflict {
  ref: string
  id: string
  originalAnswer: string // 图片/截图答案（规范化后）
  adoptedAnswer: string // 采用的认定答案
  note: string
}

export interface ExactDuplicate {
  keptId: string
  keptRef: string
  dropped: Array<{ ref: string; explanationDiff: boolean }>
}

export interface SuspectedDuplicate {
  aRef: string
  bRef: string
  reason: 'stem-same-options-differ' | 'same-content-answer-conflict'
  detail: string
}

export interface DeclaredDuplicateGroup {
  refs: string[] // 源文档「重复题提示」声明的题目标签
  ids: string[] // 对应题目 ID（去重后）
  status: 'merged' | 'suspected' | 'kept-both'
}

export interface AuditReport {
  generatedAt: string
  files: string[]
  rawCount: number
  byType: Record<QType, number>
  practicableCount: number
  needsReviewCount: number
  answerConflicts: AnswerConflict[]
  exactDuplicates: ExactDuplicate[]
  suspectedDuplicates: SuspectedDuplicate[]
  /** 源文档头部声明的重复组与程序检测结果的对照 */
  declaredDuplicates: DeclaredDuplicateGroup[]
  /** 源文档头部说明区原文（存疑纠正/重复题提示），原样保留 */
  sourceHeaderNotes: string[]
  warnings: BuildWarning[]
  errors: BuildWarning[]
  needsReviewRefs: string[]
  /** 答案来源声明：非官方核实 */
  provenanceDisclaimer: string
}

export interface BuildResult {
  questions: CreativityQuestion[]
  audit: AuditReport
}

/** 生成到 public/ 的题目形状（含可选 answerNote，其余与 Question 契约一致） */
export interface CreativityQuestion {
  id: string
  category: 'creativity'
  groupId: string
  groupTitle: string
  numberInGroup: number
  stem: string
  options: RawOption[]
  answerKey: string
  answerText: string
  translation: string
  explanation: string
  grammarPoints: string[]
  tags: string[]
  source: { file: string; group: string; position: number }
  status: 'ready' | 'needs_review'
  multiAnswer: boolean
  questionType: QType
  /** 答案争议提示（status=needs_review 时展示给用户） */
  answerNote?: string
}

// ─── 归一化与确定性 ID ─────────────────────────────────────

/** 与 scripts/audit-banks.mjs 同思路：去空白与中英标点后小写，用于重复检测 */
export function normalizeText(s: string): string {
  return (s || '')
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？·""''（）()【】《》,.;:!?'"[\]<>-]/g, '')
    .toLowerCase()
}

/** 确定性 ID：内容寻址（题干+题型+选项），不含答案 —— 改答案不换 ID */
export function stableQuestionId(stem: string, type: QType, options: RawOption[]): string {
  const h = createHash('sha1')
  h.update(normalizeText(stem))
  h.update('|')
  h.update(type)
  h.update('|')
  h.update(options.map((o) => normalizeText(o.text)).join('‖'))
  return 'creativity-' + h.digest('hex').slice(0, 10)
}

// ─── 题头与字段解析 ────────────────────────────────────────

// ## 第1题（原题号30，单选） / ## 新7题（截图shot07，作业题号2，单选题，20分）
const Q_HEADER = /^##\s*(第|新)(\d+)题\s*[（(]([^）)]*)[）)]\s*$/
// **题干：** xxx / **答案:** xxx（中文/英文冒号均可）
const FIELD_LINE = /^\*\*\s*(题干|选项|图片答案|截图答案|认定答案|解析)\s*[：:]\s*\*\*\s*(.*)$/
// - A. xxx / - A、xxx（字母可能小写）
const OPTION_LINE = /^[-*]\s*([A-Ja-j])\s*[\.、．]\s*(.+)$/
// - 正确 / 错误（二选一）
const JUDGE_SLASH_LINE = /^[-*]\s*(正确|对)\s*\/\s*(错误|错)\s*(?:[（(].*)?$/
// - 正确 / - 错误（分行）
const JUDGE_SINGLE_LINE = /^[-*]\s*(正确|错误|对|错)\s*$/

const TYPE_WORDS: Array<[RegExp, QType]> = [
  [/多选题?/, 'multi'],
  [/单选题?/, 'single'],
  [/判断题?/, 'judgement'],
]

function detectTypeWord(inner: string): QType | null {
  for (const [re, t] of TYPE_WORDS) if (re.test(inner)) return t
  return null
}

function parseHeader(
  kind: '第' | '新',
  num: number,
  inner: string,
): { originalNo: number | null; originRef: string; declaredType: QType | null } {
  const originalNoMatch = /原题号\s*(\d+)/.exec(inner)
  const originalNo = originalNoMatch ? Number(originalNoMatch[1]) : null
  const parts: string[] = []
  if (originalNo !== null) parts.push(`原题号${originalNo}`)
  const shot = /截图\s*(shot\d+)/i.exec(inner)
  if (shot) parts.push(shot[1])
  const hw = /作业题号\s*(\d+)/.exec(inner)
  if (hw) parts.push(`作业题号${hw[1]}`)
  const declaredType = detectTypeWord(inner)
  const typeWord = inner.match(/单选题|多选题|判断题|单选|多选|判断/)?.[0]
  if (typeWord) parts.push(typeWord)
  return { originalNo, originRef: parts.filter(Boolean).join('·'), declaredType }
}

// ─── 答案值解析 ───────────────────────────────────────────

export interface ParsedAnswer {
  key: string // single: 单字母；multi: 去重排序字母串；judgement: A|B
  note: string // 括号注释（如「图片答案疑误」）
  raw: string
}

/** 解析答案原始值；无法识别返回 null（由调用方决定 error/warning） */
export function parseAnswerValue(raw: string, type: QType): ParsedAnswer | null {
  const trimmed = (raw || '').trim()
  if (!trimmed) return null
  // 剥离尾部括号注释：A（图片答案疑误） → A + 注释
  let main = trimmed
  let note = ''
  const noteMatch = /^(.*?)[（(]([^（()）]*)[）)]\s*$/.exec(trimmed)
  if (noteMatch && noteMatch[1].trim()) {
    main = noteMatch[1].trim()
    note = noteMatch[2].trim()
  }
  if (type === 'judgement') {
    const t = main.replace(/[。.\s]/g, '')
    if (/^(正确|对)$/i.test(t)) return { key: 'A', note, raw: trimmed }
    if (/^(错误|错)$/i.test(t)) return { key: 'B', note, raw: trimmed }
    if (/^A$/i.test(t)) return { key: 'A', note, raw: trimmed }
    if (/^B$/i.test(t)) return { key: 'B', note, raw: trimmed }
    return null
  }
  const letters = main.toUpperCase().match(/[A-J]/g)
  if (!letters || letters.length === 0) return null
  const uniq = [...new Set(letters)].sort()
  return { key: uniq.join(''), note, raw: trimmed }
}

// ─── Markdown → RawEntry[] ─────────────────────────────────

type Field = 'none' | 'stem' | 'options' | 'imageAnswer' | 'confirmedAnswer' | 'explanation'

export function parseCreativityMarkdown(content: string, fileName: string): RawEntry[] {
  // 统一 CRLF / CR → LF
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const entries: RawEntry[] = []
  let cur: RawEntry | null = null
  let field: Field = 'none'
  let pendingBlank = false

  const flush = () => {
    if (cur) {
      cur.stem = cur.stem.trim()
      cur.explanation = cur.explanation.trim()
      cur.imageAnswer = cur.imageAnswer.trim()
      cur.confirmedAnswer = cur.confirmedAnswer.trim()
      entries.push(cur)
    }
    cur = null
  }

  for (const line of lines) {
    const t = line.trim()

    // 题目边界：## 第N题（…）/ ## 新N题（…）
    const hdr = Q_HEADER.exec(t)
    if (hdr) {
      flush()
      const kind = hdr[1] as '第' | '新'
      const num = Number(hdr[2])
      const meta = parseHeader(kind, num, hdr[3])
      cur = {
        file: fileName,
        seqLabel: `${kind}${num}题`,
        seq: entries.length + 1,
        originalNo: meta.originalNo,
        originRef: meta.originRef,
        declaredType: meta.declaredType,
        stem: '',
        options: [],
        judgeStyle: 'none',
        imageAnswer: '',
        confirmedAnswer: '',
        confirmedNote: '',
        explanation: '',
      }
      field = 'none'
      pendingBlank = false
      continue
    }

    if (!cur) continue // 文件头部说明区（存疑纠正/重复题提示等），不是题目

    // 其他标题与分隔线：结束当前字段（题目内容不会包含标题行）
    if (/^#{1,6}\s/.test(t) || /^(-{3,}|\*{3,})$/.test(t)) {
      field = 'none'
      continue
    }

    const m = FIELD_LINE.exec(t)
    if (m) {
      const name = m[1]
      const value = m[2].trim()
      if (name === '题干') field = 'stem'
      else if (name === '选项') field = 'options'
      else if (name === '图片答案' || name === '截图答案') field = 'imageAnswer'
      else if (name === '认定答案') field = 'confirmedAnswer'
      else field = 'explanation'
      if (value) {
        if (field === 'stem') cur.stem += value
        else if (field === 'imageAnswer') cur.imageAnswer += value
        else if (field === 'confirmedAnswer') cur.confirmedAnswer += value
        else if (field === 'explanation') cur.explanation += value
      }
      pendingBlank = false
      continue
    }

    if (t === '') {
      // 空行：题干/解析内部的段落分隔；选项区的空行忽略
      if (field === 'stem' || field === 'explanation') pendingBlank = true
      continue
    }

    if (field === 'options') {
      const om = OPTION_LINE.exec(t)
      if (om) {
        cur.options.push({ key: om[1].toUpperCase(), text: om[2].trim() })
        if (cur.judgeStyle === 'none' || cur.judgeStyle === 'slash') cur.judgeStyle = 'letters'
        continue
      }
      if (JUDGE_SLASH_LINE.test(t)) {
        cur.judgeStyle = 'slash'
        continue
      }
      if (JUDGE_SINGLE_LINE.test(t)) {
        if (cur.judgeStyle === 'none') cur.judgeStyle = 'lines'
        continue
      }
      // 选项区无法识别的行：容错跳过（审计阶段以选项数量校验兜底）
      continue
    }

    if (field === 'stem' || field === 'explanation') {
      const sep = pendingBlank ? '\n' : ''
      if (field === 'stem') cur.stem += (cur.stem ? sep : '') + t
      else cur.explanation += (cur.explanation ? sep : '') + t
      pendingBlank = false
      continue
    }

    if (field === 'imageAnswer') {
      cur.imageAnswer += (cur.imageAnswer ? ' ' : '') + t
      continue
    }
    if (field === 'confirmedAnswer') {
      cur.confirmedAnswer += (cur.confirmedAnswer ? ' ' : '') + t
      continue
    }
    // field === 'none'：题头与首个字段之间的杂行，忽略
  }
  flush()
  return entries
}

// ─── RawEntry → 题库（判分 / 去重 / 审计） ────────────────

const TYPE_LABEL: Record<QType, string> = { single: '单选题', multi: '多选题', judgement: '判断题' }

// ─── 源文档头部声明提取 ───────────────────────────────────

/** 提取「## 存疑纠正」「## 重复题提示」说明区原文行（原样保留，供审计追溯） */
export function extractHeaderNotes(content: string): string[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const notes: string[] = []
  let inNote = false
  for (const line of lines) {
    const t = line.trim()
    if (/^##\s*(存疑纠正|重复题提示)/.test(t)) {
      inNote = true
      notes.push(t)
      continue
    }
    if (Q_HEADER.test(t)) break // 遇到第一道题即结束
    if (inNote) {
      if (/^#{1,6}\s/.test(t)) {
        inNote = false
        continue
      }
      if (t) notes.push(t)
    }
  }
  return notes
}

/** 提取「## 重复题提示」声明的重复组：第29题 = 第38题 / 第96题 = 第100题 = 第115题 */
export function extractDeclaredDuplicates(content: string): string[][] {
  const groups: string[][] = []
  for (const note of extractHeaderNotes(content)) {
    if (!note.includes('=')) continue
    const labels = [...note.matchAll(/第\d+题/g)].map((m) => m[0])
    if (labels.length >= 2) groups.push(labels)
  }
  return groups
}

// ─── RawEntry → 题库（判分 / 去重 / 审计） ────────────────

export function buildQuestionBank(
  allEntries: RawEntry[],
  declaredGroups: string[][] = [],
): BuildResult {
  const warnings: BuildWarning[] = []
  const errors: BuildWarning[] = []
  const conflicts: AnswerConflict[] = []
  const needsReviewRefs: string[] = []

  interface Staged {
    entry: RawEntry
    type: QType
    options: RawOption[]
    answerKey: string
    answerNote: string
    needsReview: boolean
    id: string
  }
  const staged: Staged[] = []

  for (const e of allEntries) {
    const ref = `${e.seqLabel}(${e.originRef || '无溯源'})@${e.file}`
    const type = e.declaredType
    if (!type) {
      errors.push({ ref, code: 'missing-type', detail: `题头未声明题型：${e.seqLabel}` })
      continue
    }
    if (!e.stem) {
      errors.push({ ref, code: 'missing-stem', detail: '缺少题干' })
      continue
    }
    if (!e.explanation) {
      // 解析缺失不阻断（可练习可判分），但必须报告
      warnings.push({ ref, code: 'missing-explanation', detail: '缺少解析' })
    }

    // 判断题选项归一：A=正确 / B=错误（与 history 题库约定一致）
    let options = e.options
    if (type === 'judgement' && (options.length === 0 || e.judgeStyle !== 'letters')) {
      options = [
        { key: 'A', text: '正确' },
        { key: 'B', text: '错误' },
      ]
    }

    if (type !== 'judgement' && options.length < 2) {
      errors.push({
        ref,
        code: 'missing-options',
        detail: `选项不足 2 项（实际 ${options.length}）`,
      })
      continue
    }

    // 答案选择：认定答案优先；缺失时回退图片/截图答案（警告）
    let adopted: ParsedAnswer | null = null
    let original: ParsedAnswer | null = null
    if (e.confirmedAnswer) {
      adopted = parseAnswerValue(e.confirmedAnswer, type)
      if (!adopted) {
        errors.push({
          ref,
          code: 'invalid-answer',
          detail: `认定答案无法识别：「${e.confirmedAnswer}」`,
        })
        continue
      }
      if (adopted.note) e.confirmedNote = adopted.note
    } else if (e.imageAnswer) {
      warnings.push({
        ref,
        code: 'no-confirmed-answer',
        detail: '无认定答案，回退使用图片/截图答案',
      })
    }
    if (e.imageAnswer) {
      original = parseAnswerValue(e.imageAnswer, type)
      if (!original) {
        warnings.push({
          ref,
          code: 'invalid-original-answer',
          detail: `图片/截图答案无法识别：「${e.imageAnswer}」`,
        })
      }
    }
    if (!adopted && !original) {
      errors.push({ ref, code: 'missing-answer', detail: '图片/截图答案与认定答案均缺失' })
      continue
    }
    if (!adopted && original) adopted = original

    // 合法性校验
    const validKeys = new Set(options.map((o) => o.key))
    const letters = adopted.key.split('')
    if (letters.some((k) => !validKeys.has(k))) {
      errors.push({
        ref,
        code: 'invalid-answer',
        detail: `答案 ${adopted.key} 不在选项 [${options.map((o) => o.key).join('')}] 内`,
      })
      continue
    }
    if (type === 'single' && adopted.key.length !== 1) {
      errors.push({
        ref,
        code: 'single-multi-letter',
        detail: `单选题答案为多个字母「${adopted.key}」，无法安全判分`,
      })
      continue
    }
    if (type === 'multi' && adopted.key.length < 2) {
      warnings.push({
        ref,
        code: 'multi-single-letter',
        detail: `多选题答案只有 1 个字母「${adopted.key}」，按多选判分保留`,
      })
    }

    // 图片答案 vs 认定答案冲突 → 待核对
    let needsReview = false
    let answerNote = ''
    if (original && adopted && original.key !== adopted.key) {
      needsReview = true
      const fmt = (a: ParsedAnswer | null) =>
        !a ? '无' : type === 'judgement' ? (a.key === 'A' ? '正确' : '错误') : a.key
      answerNote = `原${e.seqLabel.startsWith('第') ? '图片' : '截图'}答案为 ${fmt(original)}，本题练习采用认定答案 ${fmt(adopted)}，答案存在争议，待核对`
      needsReviewRefs.push(ref)
    }
    if (needsReview && e.confirmedNote && !answerNote.includes(e.confirmedNote)) {
      answerNote += `（认定说明：${e.confirmedNote}）`
    }

    staged.push({
      entry: e,
      type,
      options,
      answerKey: adopted.key,
      answerNote,
      needsReview,
      id: stableQuestionId(e.stem, type, options),
    })
    if (needsReview && original) {
      conflicts.push({
        ref,
        id: staged[staged.length - 1].id,
        originalAnswer: original.key,
        adoptedAnswer: adopted.key,
        note: e.confirmedNote || '认定答案与图片/截图原答案不一致，采用认定答案并标记待核对',
      })
    }
  }

  // ── 去重：同 ID（题干+题型+选项一致）──
  const byId = new Map<string, Staged>()
  const exactDuplicates: ExactDuplicate[] = []
  const suspected: SuspectedDuplicate[] = []
  const normStemSeen = new Map<string, Staged>()

  for (const s of staged) {
    const ref = `${s.entry.seqLabel}(${s.entry.originRef || '无溯源'})@${s.entry.file}`
    const existing = byId.get(s.id)
    if (existing) {
      if (existing.answerKey === s.answerKey) {
        // 确切重复：合并为一条，保留所有来源位置至审计报告
        const keptRef = `${existing.entry.seqLabel}(${existing.entry.originRef || '无溯源'})@${existing.entry.file}`
        let cluster = exactDuplicates.find((d) => d.keptRef === keptRef)
        if (!cluster) {
          cluster = { keptId: existing.id, keptRef, dropped: [] }
          exactDuplicates.push(cluster)
        }
        cluster.dropped.push({
          ref,
          explanationDiff:
            normalizeText(existing.entry.explanation) !== normalizeText(s.entry.explanation),
        })
        // needs_review 取或：任一来源被标记则整题待核对
        if (s.needsReview && !existing.needsReview) {
          existing.needsReview = true
          existing.answerNote = s.answerNote
          needsReviewRefs.push(ref)
        }
        continue
      }
      // 同题不同答案：疑似重复 + 答案冲突，保留首个，报告供人工裁决
      const keptRef = `${existing.entry.seqLabel}(${existing.entry.originRef || '无溯源'})@${existing.entry.file}`
      suspected.push({
        aRef: keptRef,
        bRef: ref,
        reason: 'same-content-answer-conflict',
        detail: `题干与选项一致但答案不同：保留 ${keptRef} 答案 ${existing.answerKey}，暂弃 ${ref} 答案 ${s.answerKey}`,
      })
      conflicts.push({
        ref,
        id: existing.id,
        originalAnswer: s.answerKey,
        adoptedAnswer: existing.answerKey,
        note: '重复条目间答案冲突，保留首个来源的答案，待人工核对',
      })
      continue
    }
    byId.set(s.id, s)

    const ns = normalizeText(s.entry.stem)
    const sameStem = normStemSeen.get(ns)
    if (sameStem) {
      const aRef = `${sameStem.entry.seqLabel}(${sameStem.entry.originRef || '无溯源'})@${sameStem.entry.file}`
      suspected.push({
        aRef,
        bRef: ref,
        reason: 'stem-same-options-differ',
        detail: `题干相同但选项/题型不同（${sameStem.type} vs ${s.type}），两题均保留，请人工确认`,
      })
    } else {
      normStemSeen.set(ns, s)
    }
  }

  // ── 输出题目（保持源文件顺序）──
  const questions: CreativityQuestion[] = []
  let n = 0
  for (const s of staged) {
    if (!byId.get(s.id)) continue // 已被合并/暂弃的条目
    if (byId.get(s.id) !== s) continue
    n += 1
    const answerText = s.options
      .filter((o) => s.answerKey.includes(o.key))
      .map((o) => o.text)
      .join(' / ')
    questions.push({
      id: s.id,
      category: 'creativity',
      groupId: 'creativity-all',
      groupTitle: '综合题库',
      numberInGroup: n,
      stem: s.entry.stem,
      options: s.options,
      answerKey: s.answerKey,
      answerText,
      translation: '',
      explanation: s.entry.explanation,
      grammarPoints: [],
      tags: [TYPE_LABEL[s.type]],
      source: { file: s.entry.file, group: '综合题库', position: s.entry.seq },
      status: s.needsReview ? 'needs_review' : 'ready',
      multiAnswer: s.type === 'multi',
      questionType: s.type,
      ...(s.needsReview ? { answerNote: s.answerNote } : {}),
    })
  }

  // ID 全局唯一性兜底（sha1 前 10 位碰撞）
  const idSeen = new Set<string>()
  for (const q of questions) {
    if (idSeen.has(q.id)) errors.push({ ref: q.id, code: 'id-collision', detail: '哈希 ID 碰撞' })
    idSeen.add(q.id)
  }

  const byType: Record<QType, number> = { single: 0, multi: 0, judgement: 0 }
  for (const s of staged) byType[s.type] += 1

  // ── 源文档声明的重复组与程序检测结果对照 ──
  const refOf = (s: Staged) =>
    `${s.entry.seqLabel}(${s.entry.originRef || '无溯源'})@${s.entry.file}`
  const declared: DeclaredDuplicateGroup[] = declaredGroups.map((labels) => {
    const items = labels
      .map((label) => staged.find((s) => s.entry.seqLabel === label))
      .filter((s): s is Staged => !!s)
    const ids = [...new Set(items.map((s) => s.id))]
    let status: DeclaredDuplicateGroup['status'] = 'kept-both'
    if (items.length >= 2) {
      if (ids.length === 1) status = 'merged'
      else if (
        suspected.some(
          (d) => items.some((s) => d.aRef === refOf(s)) && items.some((s) => d.bRef === refOf(s)),
        )
      )
        status = 'suspected'
    }
    return { refs: labels, ids, status }
  })

  const audit: AuditReport = {
    generatedAt: new Date().toISOString(),
    files: [...new Set(allEntries.map((e) => e.file))],
    rawCount: allEntries.length,
    byType,
    practicableCount: questions.length,
    needsReviewCount: questions.filter((q) => q.status === 'needs_review').length,
    answerConflicts: conflicts,
    exactDuplicates,
    suspectedDuplicates: suspected,
    declaredDuplicates: declared,
    sourceHeaderNotes: [],
    warnings,
    errors,
    needsReviewRefs,
    provenanceDisclaimer:
      '练习答案取自用户提供的分析文档「认定答案」，并非教师/官方核实答案；图片/截图原答案已保留在 answerNote 与本报告中。',
  }
  return { questions, audit }
}

// ─── 入口 ─────────────────────────────────────────────────

function main() {
  const rawDir = path.resolve(__dirname, '..', 'data', 'raw', 'creativity')
  const outBank = path.resolve(__dirname, '..', 'public', 'creativity-question-bank.json')
  const outAudit = path.resolve(
    __dirname,
    '..',
    'data',
    'processed',
    'creativity-audit-report.json',
  )

  const files = fs
    .readdirSync(rawDir)
    .filter((f) => f.endsWith('.md'))
    .sort()

  if (files.length === 0) {
    console.error(`✗ ${rawDir} 下没有 .md 源文件`)
    process.exit(1)
  }

  const allEntries: RawEntry[] = []
  const declaredGroups: string[][] = []
  const headerNotes: string[] = []
  for (const f of files) {
    const content = fs.readFileSync(path.join(rawDir, f), 'utf-8')
    const entries = parseCreativityMarkdown(content, f)
    console.log(`[creativity] ${f}: 解析出 ${entries.length} 条原始记录`)
    allEntries.push(...entries)
    declaredGroups.push(...extractDeclaredDuplicates(content))
    headerNotes.push(...extractHeaderNotes(content).map((n) => `${f}: ${n}`))
  }

  const { questions, audit } = buildQuestionBank(allEntries, declaredGroups)
  audit.sourceHeaderNotes = headerNotes

  console.log(
    `[creativity] 原始记录 ${audit.rawCount} 条（单选 ${audit.byType.single} / 多选 ${audit.byType.multi} / 判断 ${audit.byType.judgement}）`,
  )
  console.log(
    `[creativity] 去重后可练习题 ${audit.practicableCount} 道，待核对 ${audit.needsReviewCount} 道`,
  )
  if (audit.exactDuplicates.length)
    console.log(`[creativity] 确切重复合并 ${audit.exactDuplicates.length} 组`)
  if (audit.suspectedDuplicates.length) {
    console.log(
      `[creativity] 疑似重复 ${audit.suspectedDuplicates.length} 组（保留全部，见审计报告）`,
    )
  }
  if (audit.declaredDuplicates.length) {
    const unmerged = audit.declaredDuplicates.filter((d) => d.status !== 'merged')
    console.log(
      `[creativity] 源文档声明重复组 ${audit.declaredDuplicates.length} 组：合并 ${audit.declaredDuplicates.length - unmerged.length} 组，未合并 ${unmerged.length} 组（措辞/选项差异，两题均保留，见审计报告）`,
    )
  }
  if (audit.answerConflicts.length) {
    console.log(`[creativity] 答案冲突 ${audit.answerConflicts.length} 处（详见审计报告）`)
  }
  if (audit.warnings.length) {
    console.log(`[creativity] 警告 ${audit.warnings.length} 条：`)
    for (const w of audit.warnings) console.log(`  ⚠ ${w.ref}: ${w.code} — ${w.detail}`)
  }

  if (audit.errors.length > 0) {
    console.error(`✗ 硬错误 ${audit.errors.length} 条，阻止生成：`)
    for (const e of audit.errors) console.error(`  ✗ ${e.ref}: ${e.code} — ${e.detail}`)
    process.exit(1)
  }

  fs.writeFileSync(outBank, JSON.stringify(questions, null, 2) + '\n')
  console.log(`[creativity] 写入 ${outBank}（${questions.length} 题）`)
  fs.mkdirSync(path.dirname(outAudit), { recursive: true })
  fs.writeFileSync(outAudit, JSON.stringify(audit, null, 2) + '\n')
  console.log(`[creativity] 审计报告 → ${outAudit}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
}
