import { describe, it, expect } from 'vitest'
import { stripMarkdown } from './renderMarkdown'

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
