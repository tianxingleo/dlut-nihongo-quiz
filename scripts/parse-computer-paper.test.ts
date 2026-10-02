/**
 * 解析端「答案来源」标记的离线验收：`> 🤖 答案由 AI 推得…` 必须落成
 * `answerProvenance: 'generated'` + `needs_review`，绝不能让 AI 推的答案冒充卷面答案。
 *
 * 跑法：`npx vitest run scripts/parse-computer-paper.test.ts`（`npm test` 也会跑）
 */

import { describe, expect, it } from 'vitest'

import { aiAnswerNumbers, resolveQuestionMarkers } from './parse-computer-paper'

const markdown = `# jp-9

## 题组一：单选题

### 第1题

#### 题目

卷面印了答案的题（ ）

A. 甲
B. 乙

#### 答案与解析

**正确答案：A 甲**

卷面解析。

### 第2题

#### 题目

卷面没有答案、由 AI 推出来的题（ ）

A. 甲
B. 乙

#### 答案与解析

**正确答案：B 乙**

AI 写的解析。

> 🤖 答案由 AI 推得（卷面无答案，未经人工核对）

> ⚙ 解析由 AI 生成（未经人工核对）

### 第3题

#### 题目

第三题（ ）

A. 甲
B. 乙

#### 答案与解析

**正确答案：A 甲**

> ⚙ 解析由 AI 生成（未经人工核对）
`

describe('答案来源标记', () => {
  it('只认出带 🤖 标记的那一题', () => {
    const found = aiAnswerNumbers(markdown)
    expect([...found]).toEqual([2])
  })

  it('AI 推的答案 → generated + needs_review + 明确写进 reviewNotes', () => {
    const markers = resolveQuestionMarkers(undefined, true, true)
    expect(markers.answerProvenance).toBe('generated')
    expect(markers.status).toBe('needs_review')
    expect(markers.reviewNotes?.join()).toContain('答案由 AI 推得')
  })

  it('只有解析是 AI 写的 → 答案来源仍是 printed', () => {
    const markers = resolveQuestionMarkers(undefined, true, false)
    expect(markers.answerProvenance).toBe('printed')
    expect(markers.status).toBe('ready')
    expect(markers.reviewNotes).toBeUndefined()
  })

  it('卷面待核对 + AI 答案 → 两种 note 都要留', () => {
    const markers = resolveQuestionMarkers(['OCR 冲突：options.A'], true, true)
    expect(markers.status).toBe('needs_review')
    expect(markers.reviewNotes).toEqual([
      'OCR 冲突：options.A',
      '答案由 AI 推得（卷面无答案，未经人工核对）',
    ])
  })

  it('什么都不沾 → printed + ready', () => {
    const markers = resolveQuestionMarkers(undefined, false, false)
    expect(markers).toEqual({ answerProvenance: 'printed', status: 'ready' })
  })
})
