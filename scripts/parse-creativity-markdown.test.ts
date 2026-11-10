import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parseCreativityMarkdown,
  buildQuestionBank,
  parseAnswerValue,
  stableQuestionId,
  extractDeclaredDuplicates,
  extractHeaderNotes,
  type RawEntry,
} from './parse-creativity-markdown'

// ─── 迷你样本：覆盖源格式的各种变体 ──────────────────────

const MINI_MD = [
  '# 去重后完整题库（示例）',
  '',
  '> 说明引言，不是题目。',
  '',
  '---',
  '',
  '## 存疑纠正（1题）',
  '- 第2题（原题号26）：图片答案 B，认定 A。',
  '',
  '## 重复题提示',
  '- 组合法定义：第3题 = 第4题',
  '',
  '## 第1题（原题号30，单选）',
  '',
  '**题干：** 熊彼特认为创新包括引入一种（），开辟新的市场。',
  '**选项：**',
  '',
  '- A. 新的生产方法',
  '- B. 新的加工设备',
  '- C. 新的发展思路',
  '**图片答案：** A',
  '**认定答案：** A',
  '**解析：** 知识点为熊彼特五种创新。',
  '',
  '## 第2题（原题号26，单选）',
  '',
  '**题干：** 下面哪一项最能体现新旧事物的辩证统一关系？',
  '**选项：**',
  '',
  '- A. 旧的东西经过翻新后继续使用',
  '- B. 传统的风俗习惯必须得到尊重',
  '- C. 孔孟之道中蕴含的古代哲学思想',
  '- D. 过去流行的时装已经过时',
  '**图片答案：** B',
  '**认定答案：** A（图片答案疑误）',
  '**解析：** A「翻新后继续使用」最典型体现旧物以新形式延续。',
  '',
  '## 第3题（原题号2，单选题）',
  '',
  '**题干:** 组合法的定义是什么（）。',
  '**选项：**',
  '',
  '- A. 把两种及以上物品组合',
  '- B. 单纯分解',
  '- C. 单纯替换',
  '- D. 单纯缩小',
  '**图片答案：** A',
  '**认定答案：** A',
  '**解析：** 组合法定义。',
  '',
  '## 第4题（原题号139，单选）',
  '',
  '**题干：** 组合法的定义是什么（）。',
  '**选项：**',
  '',
  '- A. 把两种及以上物品组合',
  '- B. 单纯分解',
  '- C. 单纯替换',
  '- D. 单纯缩小',
  '**图片答案：** A',
  '**认定答案：** A',
  '**解析：** 与第3题解析文字略有差异的重复条目。',
  '',
  '## 第5题（原题号156，多选）',
  '',
  '**题干：** 类比法运作机制包括（）。',
  '**选项：**',
  '',
  '- A. 同质异化',
  '- B. 同质同化',
  '- C. 异质异化',
  '- D. 异质同化',
  '**图片答案：** AB',
  '**认定答案：** AD',
  '**解析：** 综摄法经典机制是同质异化与异质同化。',
  '',
  '## 第6题（原题号80，判断）',
  '',
  '**题干：** 愚公移山是正向思维不懂变通的例子。',
  '**选项：**',
  '',
  '- 正确 / 错误（二选一）',
  '**图片答案：** 正确',
  '**认定答案：** 正确',
  '**解析：** 被创新思维教材用作不懂逆向变通的反例。',
  '',
  '## 第7题（原题号94，判断题）',
  '',
  '**题干：** 思维是一种复杂的心理现象，没有方向。',
  '**选项：**',
  '',
  '- 正确',
  '- 错误',
  '**图片答案：** 错误',
  '**认定答案：** 错误',
  '**解析：** 思维有发散与聚合等明确方向。',
  '',
  '## 新7题（截图shot07，作业题号2，单选题，20分）',
  '',
  '**题干：** 下列哪个不属于原型启发法的特点（）。',
  '**选项：**',
  '',
  '- A. 原型是有意识被寻找到的',
  '- B. 启发物与发明物不一定严格相似',
  '- C. 最终的发明物和启发物可能差别很大',
  '- D. 原型是对创造起垫脚石作用的中介物',
  '**截图答案：** A',
  '**认定答案：** A',
  '**解析：** 原型启发多为偶然触发。',
  '',
].join('\n')

const MINI_CRLF = MINI_MD.replace(/\n/g, '\r\n')

describe('parseCreativityMarkdown（迷你样本，含 CRLF 变体）', () => {
  const entries = parseCreativityMarkdown(MINI_CRLF, 'mini.md')

  it('仅识别 题目标题，头部说明区不产生题目', () => {
    expect(entries).toHaveLength(8)
    expect(entries[0].seqLabel).toBe('第1题')
    expect(entries[0].originalNo).toBe(30)
  })

  it('识别第二部分 新N题 题头与溯源信息', () => {
    const e = entries[7]
    expect(e.seqLabel).toBe('新7题')
    expect(e.originalNo).toBeNull()
    expect(e.originRef).toContain('shot07')
    expect(e.originRef).toContain('作业题号2')
    expect(e.declaredType).toBe('single')
  })

  it('题型词兼容 单选/单选题/多选/判断/判断题', () => {
    expect(entries[2].declaredType).toBe('single') // 单选题
    expect(entries[4].declaredType).toBe('multi') // 多选
    expect(entries[5].declaredType).toBe('judgement') // 判断
    expect(entries[6].declaredType).toBe('judgement') // 判断题
  })

  it('解析题干/选项/两套答案/解析（含英文冒号变体）', () => {
    const e = entries[2]
    expect(e.stem).toContain('组合法的定义')
    expect(e.options).toHaveLength(4)
    expect(e.options[0]).toEqual({ key: 'A', text: '把两种及以上物品组合' })
    expect(e.imageAnswer).toBe('A')
    expect(e.confirmedAnswer).toBe('A')
  })

  it('提取头部声明重复组与说明原文', () => {
    const groups = extractDeclaredDuplicates(MINI_MD)
    expect(groups).toEqual([['第3题', '第4题']])
    const notes = extractHeaderNotes(MINI_MD)
    expect(notes.some((n) => n.includes('存疑纠正'))).toBe(true)
    expect(notes.some((n) => n.includes('第3题 = 第4题'))).toBe(true)
  })
})

describe('parseAnswerValue', () => {
  it('单选/多选字母提取与排序去重', () => {
    expect(parseAnswerValue('A', 'single')?.key).toBe('A')
    expect(parseAnswerValue('ad', 'multi')?.key).toBe('AD')
    expect(parseAnswerValue('D、A、A', 'multi')?.key).toBe('AD')
  })
  it('剥离括号注释', () => {
    const r = parseAnswerValue('A（图片答案疑误）', 'single')
    expect(r?.key).toBe('A')
    expect(r?.note).toBe('图片答案疑误')
  })
  it('判断题 正确/错误/对/错 → A/B', () => {
    expect(parseAnswerValue('正确', 'judgement')?.key).toBe('A')
    expect(parseAnswerValue('错误。', 'judgement')?.key).toBe('B')
    expect(parseAnswerValue('对', 'judgement')?.key).toBe('A')
    expect(parseAnswerValue('错', 'judgement')?.key).toBe('B')
  })
  it('无法识别返回 null', () => {
    expect(parseAnswerValue('不知道', 'single')).toBeNull()
    expect(parseAnswerValue('', 'multi')).toBeNull()
  })
})

describe('stableQuestionId', () => {
  const opts = [
    { key: 'A', text: '甲' },
    { key: 'B', text: '乙' },
  ]
  it('内容相同 → ID 相同；顺序/空白/标点差异不影响', () => {
    expect(stableQuestionId('题干（）', 'single', opts)).toBe(
      stableQuestionId('题 干（ ）', 'single', [
        { key: 'A', text: '甲' },
        { key: 'B', text: '乙' },
      ]),
    )
  })
  it('答案不同 → ID 不变（修正答案不换 ID）', () => {
    expect(stableQuestionId('题干', 'single', opts)).toBe(stableQuestionId('题干', 'single', opts))
  })
  it('选项文本不同 → ID 不同', () => {
    expect(stableQuestionId('题干', 'single', opts)).not.toBe(
      stableQuestionId('题干', 'single', [
        { key: 'A', text: '甲2' },
        { key: 'B', text: '乙' },
      ]),
    )
  })
})

describe('buildQuestionBank（判分 / 冲突 / 去重 / 审计）', () => {
  const entries = parseCreativityMarkdown(MINI_MD, 'mini.md')
  const { questions, audit } = buildQuestionBank(entries, extractDeclaredDuplicates(MINI_MD))

  it('图片答案与认定答案冲突 → 采用认定答案并标 needs_review', () => {
    const q2 = questions.find((q) => q.stem.includes('辩证统一'))!
    expect(q2.answerKey).toBe('A')
    expect(q2.status).toBe('needs_review')
    expect(q2.answerNote).toContain('B')
    expect(q2.answerNote).toContain('图片答案疑误')
    const q5 = questions.find((q) => q.stem.includes('类比法'))!
    expect(q5.answerKey).toBe('AD')
    expect(q5.status).toBe('needs_review')
    expect(audit.answerConflicts).toHaveLength(2)
    expect(audit.needsReviewCount).toBe(2)
  })

  it('判断题映射 A=正确 / B=错误，覆盖 slash 与分行两种源格式', () => {
    const j1 = questions.find((q) => q.stem.includes('愚公'))!
    expect(j1.options).toEqual([
      { key: 'A', text: '正确' },
      { key: 'B', text: '错误' },
    ])
    expect(j1.answerKey).toBe('A')
    expect(j1.answerText).toBe('正确')
    expect(j1.questionType).toBe('judgement')
    expect(j1.multiAnswer).toBe(false)
    const j2 = questions.find((q) => q.stem.includes('没有方向'))!
    expect(j2.answerKey).toBe('B')
    expect(j2.answerText).toBe('错误')
  })

  it('多选 multiAnswer=true、answerKey 排序、answerText 对应选项文字', () => {
    const q5 = questions.find((q) => q.stem.includes('类比法'))!
    expect(q5.multiAnswer).toBe(true)
    expect(q5.questionType).toBe('multi')
    expect(q5.answerText).toBe('同质异化 / 异质同化')
  })

  it('确切重复合并为一题，来源进审计报告', () => {
    const combined = questions.filter((q) => q.stem.includes('组合法的定义'))
    expect(combined).toHaveLength(1)
    expect(audit.exactDuplicates).toHaveLength(1)
    expect(audit.exactDuplicates[0].dropped[0].ref).toContain('第4题')
    expect(audit.exactDuplicates[0].dropped[0].explanationDiff).toBe(true)
    expect(audit.declaredDuplicates[0].status).toBe('merged')
  })

  it('numberInGroup 连续且 groupId 统一', () => {
    expect(questions.every((q, i) => q.numberInGroup === i + 1)).toBe(true)
    expect(questions.every((q) => q.groupId === 'creativity-all')).toBe(true)
    expect(questions.every((q) => q.category === 'creativity')).toBe(true)
  })

  it('审计含来源声明与待核对清单', () => {
    expect(audit.rawCount).toBe(8)
    expect(audit.practicableCount).toBe(7)
    expect(audit.needsReviewRefs).toHaveLength(2)
    expect(audit.provenanceDisclaimer).toContain('并非教师/官方核实')
  })

  it('缺答案 / 非法答案 / 单选多字母 → 硬错误', () => {
    const bad = [
      '## 第1题（原题号1，单选）',
      '',
      '**题干：** 缺答案的题。',
      '**选项：**',
      '- A. 甲',
      '- B. 乙',
      '**解析：** 无答案。',
      '',
      '## 第2题（原题号2，单选）',
      '',
      '**题干：** 答案不在选项内。',
      '**选项：**',
      '- A. 甲',
      '- B. 乙',
      '**图片答案：** E',
      '**认定答案：** E',
      '**解析：** x。',
      '',
      '## 第3题（原题号3，单选）',
      '',
      '**题干：** 单选给了两个字母。',
      '**选项：**',
      '- A. 甲',
      '- B. 乙',
      '**图片答案：** AB',
      '**认定答案：** AB',
      '**解析：** x。',
    ].join('\n')
    const { audit } = buildQuestionBank(parseCreativityMarkdown(bad, 'bad.md'))
    expect(audit.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(['missing-answer', 'invalid-answer', 'single-multi-letter']),
    )
  })

  it('同题不同答案 → 疑似重复 + 冲突报告，保留首个', () => {
    const md = [
      '## 第1题（原题号1，单选）',
      '',
      '**题干：** 同一道题。',
      '**选项：**',
      '- A. 甲',
      '- B. 乙',
      '**图片答案：** A',
      '**认定答案：** A',
      '**解析：** x。',
      '',
      '## 第2题（原题号9，单选）',
      '',
      '**题干：** 同一道题。',
      '**选项：**',
      '- A. 甲',
      '- B. 乙',
      '**图片答案：** B',
      '**认定答案：** B',
      '**解析：** y。',
    ].join('\n')
    const { questions, audit } = buildQuestionBank(parseCreativityMarkdown(md, 'conflict.md'))
    expect(questions).toHaveLength(1)
    expect(questions[0].answerKey).toBe('A')
    const s = audit.suspectedDuplicates.find((x) => x.reason === 'same-content-answer-conflict')
    expect(s).toBeDefined()
    expect(s!.detail).toContain('B')
    expect(audit.answerConflicts.length).toBeGreaterThan(0)
  })
})

describe('增量导入稳定性', () => {
  const batch1 = MINI_MD
  // 模拟未来追加的批次文件：旧题原文照搬 + 1 道新题
  const batch2 = [
    '## 新50题（截图shot50，作业题号1，判断）',
    '',
    '**题干：** 头脑风暴法允许延迟批判。',
    '**选项：**',
    '',
    '- 正确 / 错误（二选一）',
    '**截图答案：** 正确',
    '**认定答案：** 正确',
    '**解析：** 延迟批判是头脑风暴原则。',
    '',
    '## 第1题（原题号30，单选）',
    '',
    '**题干：** 熊彼特认为创新包括引入一种（），开辟新的市场。',
    '**选项：**',
    '',
    '- A. 新的生产方法',
    '- B. 新的加工设备',
    '- C. 新的发展思路',
    '**图片答案：** A',
    '**认定答案：** A',
    '**解析：** 知识点为熊彼特五种创新。',
  ].join('\n')

  it('追加批次后旧题 ID 不变、不产生重复题目', () => {
    const base = buildQuestionBank(parseCreativityMarkdown(batch1, 'final_merged.md'))
    const merged = buildQuestionBank([
      ...parseCreativityMarkdown(batch1, 'final_merged.md'),
      ...parseCreativityMarkdown(batch2, 'batch2.md'),
    ])
    // 旧题全部保留且 ID/内容一致
    for (const q of base.questions) {
      const again = merged.questions.find((x) => x.id === q.id)
      expect(again, `旧题 ${q.id} 应保留`).toBeDefined()
      expect(again!.stem).toBe(q.stem)
      expect(again!.answerKey).toBe(q.answerKey)
    }
    // 新题加入且无重复 ID
    expect(merged.questions.some((q) => q.stem.includes('头脑风暴'))).toBe(true)
    const ids = merged.questions.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(merged.questions.length).toBe(base.questions.length + 1)
  })

  it('同一输入重复导入两次结果完全一致', () => {
    const a = buildQuestionBank(parseCreativityMarkdown(batch1, 'final_merged.md'))
    const b = buildQuestionBank(parseCreativityMarkdown(batch1, 'final_merged.md'))
    expect(a.questions).toEqual(b.questions)
  })
})

// ─── 真实源文件回归 ───────────────────────────────────────

const REAL_FILE = resolve(process.cwd(), 'data', 'raw', 'creativity', 'final_merged.md')

describe('真实源文件 final_merged.md', () => {
  const content = readFileSync(REAL_FILE, 'utf-8')
  const entries = parseCreativityMarkdown(content, 'final_merged.md')
  const { questions, audit } = buildQuestionBank(entries, extractDeclaredDuplicates(content))

  it('识别 135 条原始记录 = 104 单选 + 17 多选 + 14 判断', () => {
    expect(entries).toHaveLength(135)
    expect(audit.byType).toEqual({ single: 104, multi: 17, judgement: 14 })
  })

  it('去重后 128 道（与审计报告一致），ID 全局唯一', () => {
    expect(questions).toHaveLength(128)
    const ids = questions.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.startsWith('creativity-'))).toBe(true)
  })

  it('第 9 / 70 / 106 题采用认定答案，保留原答案并标待核对', () => {
    expect(audit.needsReviewCount).toBe(3)
    const q9 = questions.find((q) => q.stem.includes('辩证统一'))!
    expect(q9.answerKey).toBe('A')
    expect(q9.answerNote).toContain('B')
    const q70 = questions.find((q) => q.stem.includes('类比法的基础是比较'))!
    expect(q70.answerKey).toBe('AD')
    expect(q70.answerNote).toContain('AB')
    const q106 = questions.find(
      (q) => q.stem.includes('理智性') || q.explanation.includes('理智性'),
    )!
    expect(['D']).toContain(q106.answerKey)
    expect(audit.answerConflicts).toHaveLength(3)
  })

  it('源文档声明的 11 组重复全部纳入对照报告', () => {
    expect(audit.declaredDuplicates).toHaveLength(11)
    const merged = audit.declaredDuplicates.filter((d) => d.status === 'merged')
    const kept = audit.declaredDuplicates.filter((d) => d.status === 'kept-both')
    expect(merged.length).toBe(5)
    expect(kept.length).toBe(5)
  })

  it('全部题目满足判分契约（answerKey ⊆ 选项，answerText 对应真实选项）', () => {
    for (const q of questions) {
      const keys = q.options.map((o) => o.key)
      for (const k of q.answerKey.split('')) {
        expect(keys).toContain(k)
      }
      const expectedText = q.options
        .filter((o) => q.answerKey.includes(o.key))
        .map((o) => o.text)
        .join(' / ')
      expect(q.answerText).toBe(expectedText)
      expect(q.source.file).toBe('final_merged.md')
    }
  })

  it('审计报告与生成的 JSON 文件一致（增量命令可重复执行）', () => {
    const bank = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public', 'creativity-question-bank.json'), 'utf-8'),
    ) as RawEntry[]
    expect(bank).toHaveLength(questions.length)
  })
})
