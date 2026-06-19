import { describe, it, expect } from 'vitest'
import { renderExplanation } from './renderExplanation'

describe('renderExplanation', () => {
  it('preserves plain text as-is', () => {
    expect(renderExplanation('这是一段普通文字')).toBe('这是一段普通文字')
  })

  it('converts **bold** to <strong>', () => {
    expect(renderExplanation('**重点**内容')).toBe('<strong>重点</strong>内容')
  })

  it('converts \\n to <br>', () => {
    expect(renderExplanation('第一行\n第二行')).toBe('第一行<br>第二行')
  })

  it('escapes <script> tags to prevent XSS', () => {
    const out = renderExplanation('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('escapes & to &amp; without breaking later markdown', () => {
    expect(renderExplanation('A & B')).toBe('A &amp; B')
    expect(renderExplanation('**x & y**')).toBe('<strong>x &amp; y</strong>')
  })

  it('escapes quotes and angle brackets', () => {
    expect(renderExplanation('Say "hi" <b>')).toBe('Say &quot;hi&quot; &lt;b&gt;')
  })

  it('handles empty string', () => {
    expect(renderExplanation('')).toBe('')
  })

  it('preserves ** inside escaped content safely (no nested bold expansion)', () => {
    const out = renderExplanation('**a** & **b**')
    expect(out).toBe('<strong>a</strong> &amp; <strong>b</strong>')
  })
})
