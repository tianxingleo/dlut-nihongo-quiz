import { describe, it, expect } from 'vitest'
import {
  CATEGORIES,
  getCategoryMeta,
  NO_SHUFFLE_CATEGORIES,
  GROUPED_CATEGORIES,
} from './categories'

describe('CATEGORIES config', () => {
  it('covers existing subjects and four independent computer papers', () => {
    expect(CATEGORIES.map((c) => c.key).sort()).toEqual([
      'computer-2021-final',
      'computer-2024-final',
      'computer-2026-midterm',
      'computer-c-exam',
      'computer-midterms',
      'history',
      'japanese2',
      'marxism-1',
      'marxism-2',
      'marxism-3',
      'marxism-5',
      'marxism-6',
      'marxism-7',
      'military',
      'party',
      'principles-of-marxism-1',
    ])
  })

  it('every entry has a unique short label and bankFile', () => {
    const shorts = new Set(CATEGORIES.map((c) => c.short))
    const files = new Set(CATEGORIES.map((c) => c.bankFile))
    expect(shorts.size).toBe(CATEGORIES.length)
    expect(files.size).toBe(CATEGORIES.length)
  })

  it('getCategoryMeta returns the entry for the key', () => {
    expect(getCategoryMeta('japanese2').long).toBe('综合日语2')
    expect(getCategoryMeta('japanese2').bankFile).toBe('japanese2-question-bank.json')
  })

  it('japanese2 has 4 subBanks covering word + 3 grammar banks', () => {
    const jp2 = getCategoryMeta('japanese2')
    expect(jp2.subBanks?.map((s) => s.key)).toEqual([
      'word',
      'grammar-textbook',
      'grammar-2021',
      'grammar-2024',
    ])
  })

  it('NO_SHUFFLE_CATEGORIES contains history/party/military (multi-answer banks)', () => {
    expect(NO_SHUFFLE_CATEGORIES.has('history')).toBe(true)
    expect(NO_SHUFFLE_CATEGORIES.has('party')).toBe(true)
    expect(NO_SHUFFLE_CATEGORIES.has('military')).toBe(true)
    expect(NO_SHUFFLE_CATEGORIES.has('japanese2')).toBe(false)
    for (const category of CATEGORIES.filter((c) => c.key.startsWith('computer-'))) {
      expect(NO_SHUFFLE_CATEGORIES.has(category.key)).toBe(true)
      expect(GROUPED_CATEGORIES.has(category.key)).toBe(true)
    }
  })

  it('GROUPED_CATEGORIES aligns with entries that have a group view', () => {
    for (const c of CATEGORIES) {
      const inGrouped = GROUPED_CATEGORIES.has(c.key)
      expect(inGrouped).toBe(Boolean(c.groupViewTitle))
    }
  })
})
