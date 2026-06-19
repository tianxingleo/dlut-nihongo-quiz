import { describe, it, expect } from 'vitest'
import { CATEGORIES, getCategoryMeta, NO_SHUFFLE_CATEGORIES, GROUPED_CATEGORIES } from './categories'

describe('CATEGORIES config', () => {
  it('covers all 5 categories', () => {
    expect(CATEGORIES.map(c => c.key).sort()).toEqual(['grammar', 'history', 'military', 'party', 'word'])
  })

  it('every entry has a unique short label and bankFile', () => {
    const shorts = new Set(CATEGORIES.map(c => c.short))
    const files = new Set(CATEGORIES.map(c => c.bankFile))
    expect(shorts.size).toBe(CATEGORIES.length)
    expect(files.size).toBe(CATEGORIES.length)
  })

  it('getCategoryMeta returns the entry for the key', () => {
    expect(getCategoryMeta('grammar').long).toBe('日语语法')
    expect(getCategoryMeta('word').bankFile).toBe('word-question-bank.json')
  })

  it('NO_SHUFFLE_CATEGORIES contains history/party/military (multi-answer banks)', () => {
    expect(NO_SHUFFLE_CATEGORIES.has('history')).toBe(true)
    expect(NO_SHUFFLE_CATEGORIES.has('party')).toBe(true)
    expect(NO_SHUFFLE_CATEGORIES.has('military')).toBe(true)
    expect(NO_SHUFFLE_CATEGORIES.has('grammar')).toBe(false)
    expect(NO_SHUFFLE_CATEGORIES.has('word')).toBe(false)
  })

  it('GROUPED_CATEGORIES aligns with which entries have groupOrder', () => {
    for (const c of CATEGORIES) {
      const inGrouped = GROUPED_CATEGORIES.has(c.key)
      expect(inGrouped).toBe(Boolean(c.groupOrder && c.groupOrder.length > 0))
    }
  })
})
