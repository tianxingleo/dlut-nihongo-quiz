// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { needsRichMarkdown, renderQuestionMarkdown } from './renderQuestionMarkdown'

describe('computer question rendering', () => {
  it('preserves assembly formatting, tables, and mathematical notation', () => {
    const html = renderQuestionMarkdown(
      '```asm\nMOV AX, BX\nADD AX, 1\n```\n\n| 位 | 值 |\n|---|---|\n| 0 | 1 |\n\n$2^{16}$',
    )
    expect(html).toContain('MOV AX, BX\nADD AX, 1')
    expect(html).toContain('<table>')
    expect(html).toContain('class="katex"')
  })
  it('does not interpret MIPS register names as paired dollar math', () => {
    const html = renderQuestionMarkdown(
      'レジスタ$s0, $s1, $s2, $s3を使用。容量は$10^6$バイト。\n\n```asm\nadd $s0, $s1, $s2\n```',
    )
    expect(html).toContain('レジスタ$s0, $s1, $s2, $s3を使用。')
    expect(html).toContain('add $s0, $s1, $s2')
    expect(html.match(/class="katex"/g)).toHaveLength(1)
  })
  it('routes math papers and computer papers through the rich renderer', () => {
    expect(needsRichMarkdown('math-1')).toBe(true)
    expect(needsRichMarkdown('math-2')).toBe(true)
    expect(needsRichMarkdown('computer-2')).toBe(true)
    expect(needsRichMarkdown('jp-3-2022')).toBe(false)
  })

  it('renders the high-math paper formulas instead of leaving LaTeX source', () => {
    const html = renderQuestionMarkdown(
      '对下列级数求和 $$\\frac{1}{1 \\cdot 4} + \\frac{1}{4 \\cdot 7} + \\cdots + \\frac{1}{(3n-2)(3n+1)} + \\cdots$$',
    )
    expect(html).toContain('class="katex"')
    // KaTeX 会在 <math> 的 MathML 兜底里保留 TeX 原文，只校验屏幕可见的那部分
    const visible = html.replace(/<math[\s\S]*?<\/math>/g, '')
    expect(visible).not.toContain('\\frac')
    expect(visible).not.toContain('$$')
  })

  it('sanitizes raw OCR HTML while retaining content', () => {
    const html = renderQuestionMarkdown(
      '<img src="x" onerror="alert(1)"><script>alert(1)</script>题目',
    )
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script')
    expect(html).toContain('题目')
  })
})
