import { describe, it, expect } from 'vitest'
import { truncate } from './text'

describe('truncate', () => {
  it('returns text unchanged when within limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('cuts and adds ellipsis when exceeding limit', () => {
    expect(truncate('hello world', 5)).toBe('hello…')
  })

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('')
  })
})
