import { describe, it, expect } from 'vitest'
import { ENTRIES, findEntry, entryOfCategory } from './entries'
import { CATEGORIES } from './categories'

describe('ENTRIES config', () => {
  it('每个入口都有唯一的 key / name / icon', () => {
    expect(new Set(ENTRIES.map((e) => e.key)).size).toBe(ENTRIES.length)
    expect(new Set(ENTRIES.map((e) => e.name)).size).toBe(ENTRIES.length)
    for (const entry of ENTRIES) {
      expect(entry.key, 'entry key 必须是小写字母/数字/连字符').toMatch(/^[a-z0-9-]+$/)
      expect(entry.icon, `${entry.key} 缺图标`).toBeTruthy()
      expect(entry.papers.length, `${entry.key} 没有试卷`).toBeGreaterThan(0)
    }
  })

  it('入口引用的每个分类都真实存在', () => {
    const keys = new Set(CATEGORIES.map((c) => c.key))
    for (const entry of ENTRIES) {
      for (const paper of entry.papers) {
        expect(keys.has(paper), `入口 ${entry.key} 引用了不存在的分类 ${paper}`).toBe(true)
      }
    }
  })

  it('一个分类只能属于一个入口，且入口内不重复', () => {
    const seen = new Map<string, string>()
    for (const entry of ENTRIES) {
      expect(new Set(entry.papers).size, `${entry.key} 内有重复试卷`).toBe(entry.papers.length)
      for (const paper of entry.papers) {
        expect(seen.has(paper), `${paper} 同时属于 ${seen.get(paper)} 和 ${entry.key}`).toBe(false)
        seen.set(paper, entry.key)
      }
    }
  })

  it('computer-* 的试卷都已经归入某个入口（否则会掉到第一层学科区）', () => {
    for (const category of CATEGORIES.filter((c) => c.key.startsWith('computer-'))) {
      expect(entryOfCategory(category.key), `${category.key} 没有入口`).toBeDefined()
    }
  })

  it('findEntry / entryOfCategory 行为正确', () => {
    const first = ENTRIES[0]
    expect(findEntry(first.key)?.name).toBe(first.name)
    expect(findEntry('不存在的入口')).toBeUndefined()
    expect(findEntry(undefined)).toBeUndefined()
    expect(entryOfCategory(first.papers[0])?.key).toBe(first.key)
    expect(entryOfCategory('japanese2')).toBeUndefined()
  })
})
