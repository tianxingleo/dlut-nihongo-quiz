/**
 * 试卷 markdown 解析器的回归测试（用户 2026-09-22 报的三个问题里，两个出在这里）。
 *
 *   * 「很多多选题的 questionType 不对」—— 答案正则只捕获**一个**字母，
 *     于是 `answerKey.length > 1` 永远不成立，`multi` 成了死代码；
 *   * 「answerKey 没有显示」—— `**正确答案：AC 甲、丙**` 被解析成 `answerKey='A'`、
 *     `answerText='C 甲、丙'`，第二个正确选项丢了；
 *   * 顺带：选项正则写死 `[A-D]`，第 5 个选项（E）会被当成题干正文吞掉。
 */

import { describe, expect, it } from 'vitest'

import { parseExamMarkdown } from './parse-exam-markdown'
import { inferQuestionType } from '../parse-computer-paper'

const question = (opts: string, answer: string, body = '') =>
  `### 第1题\n#### 题目\n题干文字（够长以便被收录）\n${opts}\n#### 答案与解析\n${answer}\n${body}`

const wrap = (inner: string) => `## 题组一：测试题组\n\n${inner}\n`

describe('parseExamMarkdown：答案与选项字母', () => {
  it('多选题答案 AC 要完整收下，答案文本不能把 C 吞进去', () => {
    const [q] = parseExamMarkdown(
      wrap(question('A. 甲\nB. 乙\nC. 丙\nD. 丁', '**正确答案：AC 甲、丙**')),
    )
    expect(q.answerKey).toBe('AC')
    expect(q.answerText).toBe('甲、丙')
  })

  it('答案字母顺序无关，去重后升序（CA → AC）', () => {
    const [q] = parseExamMarkdown(
      wrap(question('A. 甲\nB. 乙\nC. 丙', '**正确答案：CA 丙、甲**')),
    )
    expect(q.answerKey).toBe('AC')
  })

  it('选项放开到 E（多选题实测 5 个选项）', () => {
    const [q] = parseExamMarkdown(
      wrap(question('A. 甲\nB. 乙\nC. 丙\nD. 丁\nE. 戊', '**正确答案：ACE 甲、丙、戊**')),
    )
    expect(q.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(q.options[4].text).toBe('戊')
    expect(q.answerKey).toBe('ACE')
  })

  it('旧格式（没有题组名 / CRLF）照样能解析', () => {
    const md = '## 题组一：\r\n### 第2题\r\n#### 题目\r\n单选题干文字\r\nA. 甲\r\nB. 乙\r\n#### 答案与解析\r\n**正确答案：B 乙**\r\n'
    const [q] = parseExamMarkdown(md)
    expect(q.numberInGroup).toBe(2)
    expect(q.answerKey).toBe('B')
    expect(q.groupName).toBe('')
    expect(q.groupTitle).toBe('题组一：')
  })

  it('答案文本缺失时，用答案字母对应的选项原文兜底', () => {
    const [q] = parseExamMarkdown(wrap(question('A. 甲\nB. 乙\nC. 丙', '**正确答案：AC **')))
    // `(.+?)` 要求答案后面至少一个字符，这里靠选项文本兜底
    expect(q.answerKey).toBe('AC')
    expect(q.answerText).toBe('甲、丙')
  })
})

describe('inferQuestionType：md 里不写题型，只能按答案与选项判', () => {
  const opts = (...texts: string[]) => texts.map((text, i) => ({ key: 'ABCDE'[i], text }))

  it('多字母答案 → multi', () => {
    expect(inferQuestionType({ answerKey: 'AC', options: opts('甲', '乙', '丙') })).toBe('multi')
  })

  it('两个选项正好是 正确/错误 → judgement（以前这里会落成 single）', () => {
    expect(inferQuestionType({ answerKey: 'A', options: opts('正确', '错误') })).toBe('judgement')
    expect(inferQuestionType({ answerKey: 'B', options: opts('√', '×') })).toBe('judgement')
  })

  it('没有选项 → fill', () => {
    expect(inferQuestionType({ answerKey: '', options: [] })).toBe('fill')
  })

  it('一个字母 + 普通选项 → single', () => {
    expect(inferQuestionType({ answerKey: 'B', options: opts('甲', '乙', '丙') })).toBe('single')
  })
})
