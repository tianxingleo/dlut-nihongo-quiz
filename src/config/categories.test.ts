import { describe, it, expect } from 'vitest'
import {
  CATEGORIES,
  getCategoryMeta,
  NO_SHUFFLE_CATEGORIES,
  GROUPED_CATEGORIES,
  inferCategoryByIdPrefix,
} from './categories'

describe('CATEGORIES config', () => {
  it('covers existing subjects, computer papers and creativity', () => {
    expect(CATEGORIES.map((c) => c.key).sort()).toEqual([
      '2019-a-7',
      'calculus1-1',
      'calculus1-8',
      'calculus1-9',
      'computer-2021-final',
      'computer-2024-final',
      'computer-2026-midterm',
      'computer-c-exam',
      'computer-midterms',
      'creativity',
      'history',
      'japanese1-final',
      'japanese1-midterm',
      'japanese2',
      'japanese3',
      'jp-3',
      'jp-3-2022',
      'jp-3-2024',
      'jp1-mid24',
      'marxism-1',
      'marxism-2',
      'marxism-3',
      'marxism-5',
      'marxism-6',
      'marxism-7',
      'math-1',
      'math-2',
      'math-2018-midterm',
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

  it('NO_SHUFFLE_CATEGORIES contains history/party/military/creativity (multi-answer banks)', () => {
    expect(NO_SHUFFLE_CATEGORIES.has('history')).toBe(true)
    expect(NO_SHUFFLE_CATEGORIES.has('party')).toBe(true)
    expect(NO_SHUFFLE_CATEGORIES.has('military')).toBe(true)
    expect(NO_SHUFFLE_CATEGORIES.has('creativity')).toBe(true)
    expect(NO_SHUFFLE_CATEGORIES.has('japanese2')).toBe(false)
    expect(NO_SHUFFLE_CATEGORIES.has('jp1-mid24')).toBe(true)
    for (const category of CATEGORIES.filter((c) => c.key.startsWith('computer-'))) {
      expect(NO_SHUFFLE_CATEGORIES.has(category.key)).toBe(true)
      expect(GROUPED_CATEGORIES.has(category.key)).toBe(true)
    }
  })

  it('creativity entry declares partial bank and its bankFile', () => {
    const c = getCategoryMeta('creativity')
    expect(c.long).toBe('创造性思维与创新方法')
    expect(c.bankFile).toBe('creativity-question-bank.json')
    expect(c.desc).toContain('持续更新')
    expect(c.groupOrder).toEqual(['creativity-all'])
  })

  it('inferCategoryByIdPrefix maps id prefixes to categories with japanese2 fallback', () => {
    expect(inferCategoryByIdPrefix('hist-q1')).toBe('history')
    expect(inferCategoryByIdPrefix('history-q1')).toBe('history')
    expect(inferCategoryByIdPrefix('party-judge-q1')).toBe('party')
    expect(inferCategoryByIdPrefix('mil-ch1-q1')).toBe('military')
    expect(inferCategoryByIdPrefix('creativity-461f1ac77f')).toBe('creativity')
    // 日语题库历史上前缀不统一，兜底归 japanese2
    expect(inferCategoryByIdPrefix('g01-q0001')).toBe('japanese2')
    expect(inferCategoryByIdPrefix('w26-001')).toBe('japanese2')
    expect(inferCategoryByIdPrefix('')).toBe('japanese2')
  })

  it('GROUPED_CATEGORIES aligns with entries that have a group view', () => {
    for (const c of CATEGORIES) {
      const inGrouped = GROUPED_CATEGORIES.has(c.key)
      expect(inGrouped).toBe(Boolean(c.groupViewTitle))
    }
  })
})
