// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  renderQuestionMarkdown,
  renderQuestionMarkdownInline,
  needsRichMarkdown,
} from './renderQuestionMarkdown'

describe('published calculus rendering', () => {
  for (const category of [
    'calculus1-1',
    'math-2018-midterm',
    '2019-a-7',
    'calculus1-8',
    'calculus1-9',
  ]) {
    it(`renders every visible formula in ${category}`, () => {
      expect(needsRichMarkdown(category)).toBe(true)
      const questions = JSON.parse(readFileSync(`public/${category}-question-bank.json`, 'utf8'))
      for (const q of questions)
        for (const text of [
          q.stem,
          q.answerText,
          q.explanation,
          ...q.options.map((o: { text: string }) => o.text),
        ]) {
          for (const render of [renderQuestionMarkdown, renderQuestionMarkdownInline]) {
            const node = document.createElement('div')
            node.innerHTML = render(text)
            node.querySelectorAll('math,annotation').forEach((n) => n.remove())
            expect(node.querySelector('.katex-error'), `${q.id}: ${text}`).toBeNull()
            expect(node.textContent, `${q.id}: ${text}`).not.toMatch(/\\[a-zA-Z]|\$/)
          }
        }
    })
  }
})
