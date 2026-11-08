// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Question } from '../types/question'
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
    describe(category, () => {
      const questions: Question[] = JSON.parse(
        readFileSync(`public/${category}-question-bank.json`, 'utf8'),
      )

      it('uses rich Markdown for a nonempty question bank', () => {
        expect(needsRichMarkdown(category)).toBe(true)
        expect(questions.length).toBeGreaterThan(0)
      })

      // Test each question separately so large banks don't share one CI timeout.
      it.each(questions)('renders every visible formula in $id', (question) => {
        const fields = [
          question.stem,
          question.answerText,
          question.explanation,
          ...question.options.map((option) => option.text),
        ]
        for (const text of fields) {
          for (const render of [renderQuestionMarkdown, renderQuestionMarkdownInline]) {
            const node = document.createElement('div')
            node.innerHTML = render(text)
            node.querySelectorAll('math,annotation').forEach((n) => n.remove())
            if (text.trim()) expect(node.textContent?.trim(), text).toBeTruthy()
            expect(node.querySelector('.katex-error'), text).toBeNull()
            expect(node.textContent, text).not.toMatch(/\\[a-zA-Z]|\$/)
          }
        }
      })
    })
  }
})
