import { describe, it, expect } from 'vitest'
import { findEntry } from './entries'
import { COURSE_TREE } from './courseTree'
import { getCategoryMeta } from './categories'

describe('Japanese 1 integration', () => {
  it('offers two vocabulary ranges through a separate words folder', () => {
    const entry = findEntry('japanese1')!
    expect(entry.groups).toEqual([
      { key: 'words', name: '单词', papers: ['japanese1-midterm', 'japanese1-final'] },
    ])
    expect(
      COURSE_TREE.find((n) => n.key === 'japanese1')?.children?.[0]?.children?.map(
        (n) => n.category,
      ),
    ).toEqual(entry.papers)
    for (const category of entry.papers)
      expect(getCategoryMeta(category).bankFile).toBe(`${category}-question-bank.json`)
  })
  it('preserves the Japanese 2 subtitle', () => {
    expect(findEntry('japanese2-exams')?.desc).toBe('单词 · 语法（学习通99题 + 2021/2024 真题）')
  })
})
