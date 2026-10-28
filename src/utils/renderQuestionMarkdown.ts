import { Marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import { sanitizeHtml } from './renderMarkdown'
import 'katex/dist/katex.min.css'

const renderer = new Marked({ gfm: true, breaks: false })
renderer.use(markedKatex({ throwOnError: false, nonStandard: true }))
// MIPS register names use a literal dollar sign; two registers are not a math span.
renderer.use({
  extensions: [
    {
      name: 'mipsRegister',
      level: 'inline',
      start: (source) => source.indexOf('$'),
      tokenizer(source) {
        const match = /^\$(?:zero|at|v[01]|a[0-3]|t[0-9]|s[0-8]|k[01]|gp|sp|fp|ra)\b(?!\$)/.exec(
          source,
        )
        if (match) return { type: 'mipsRegister', raw: match[0] }
      },
      renderer: (token) => token.raw,
    },
  ],
})

/**
 * 哪些试卷类别的题干/选项/答案需要 KaTeX + marked 富渲染：计算机组成（`computer-*`，
 * 要代码块和公式）与高数（`math-*`，要 LaTeX 公式）；日语等纯文本卷走轻量 renderMarkdown。
 *
 * 以前只放行 `computer-*`，高数题库的 `\[ \frac{1}{1 \cdot 4} + \cdots \]`
 * 于是在站上原样显示成 LaTeX 源码。
 */
export function needsRichMarkdown(category: string): boolean {
  return (
    category.startsWith('computer-') ||
    category.startsWith('math-') ||
    category.startsWith('calculus1-') ||
    category === '2019-a-7'
  )
}

/** Preserve code blocks/tables and render OCR formulas without trusting source HTML. */
export function renderQuestionMarkdown(markdown: string): string {
  return sanitizeHtml(renderer.parse(markdown, { async: false }) as string)
}

/** Render answer text inside an inline result without adding paragraph wrappers. */
export function renderQuestionMarkdownInline(markdown: string): string {
  return sanitizeHtml(renderer.parseInline(markdown, { async: false }) as string)
}
