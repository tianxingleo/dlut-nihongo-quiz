// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { marked } from 'marked'
import { stripMarkdown, renderMarkdown, sanitizeHtml } from './renderMarkdown'

describe('stripMarkdown', () => {
  it('removes bold markers', () => {
    expect(stripMarkdown('**hello** world')).toBe('hello world')
  })

  it('removes italic markers', () => {
    expect(stripMarkdown('*italic* text')).toBe('italic text')
  })

  it('removes inline code', () => {
    expect(stripMarkdown('use `console.log` here')).toBe('use console.log here')
  })

  it('removes links but keeps text', () => {
    expect(stripMarkdown('[Google](https://google.com)')).toBe('Google')
  })

  it('replaces newlines with spaces', () => {
    expect(stripMarkdown('line1\nline2\nline3')).toBe('line1 line2 line3')
  })

  it('handles combined inline markdown', () => {
    expect(stripMarkdown('**bold** and *italic* and `code`')).toBe('bold and italic and code')
  })

  it('handles empty string', () => {
    expect(stripMarkdown('')).toBe('')
  })

  it('handles text without markdown', () => {
    expect(stripMarkdown('plain text')).toBe('plain text')
  })

  it('does not strip single asterisk inside words (not italic)', () => {
    // 单独的 * 不应被误删
    expect(stripMarkdown('a * b')).toBe('a * b')
  })
})

describe('renderMarkdown (XSS sanitization)', () => {
  it('strips <script> tags', () => {
    const out = renderMarkdown('<script>alert(document.cookie)</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert(document.cookie)')
  })

  it('strips inline event handlers (onerror)', () => {
    const out = renderMarkdown('题干 <img src=x onerror=alert(1)>')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('alert(1)')
  })

  it('strips javascript: URLs from links', () => {
    const out = renderMarkdown('[x](javascript:alert(1))')
    expect(out).not.toContain('javascript:')
  })

  it('preserves benign markdown formatting', () => {
    const out = renderMarkdown('普通 **加粗** 文本')
    expect(out).toContain('<strong>加粗</strong>')
  })

  it('is not affected by global marked options', () => {
    marked.setOptions({ breaks: true })
    try {
      const out = renderMarkdown('isolated first line\nisolated second line')
      expect(out).not.toContain('<br>')
    } finally {
      marked.setOptions({ breaks: false })
    }
  })
})

describe('sanitizeHtml', () => {
  it('sanitizes HTML produced by custom markdown renderers', () => {
    const out = sanitizeHtml('<h2 id="safe">Title</h2><img src=x onerror=alert(1)>')
    expect(out).toContain('<h2 id="safe">Title</h2>')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('alert(1)')
  })
})
