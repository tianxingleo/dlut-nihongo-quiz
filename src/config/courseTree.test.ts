import { describe, it, expect } from 'vitest'
import { COURSE_TREE, type TreeNode } from './courseTree'
import { CATEGORIES } from './categories'

function walk(nodes: TreeNode[], visit: (n: TreeNode) => void): void {
  for (const n of nodes) {
    visit(n)
    if (n.children) walk(n.children, visit)
  }
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = []
  walk(nodes, (n) => out.push(n))
  return out
}

describe('COURSE_TREE config', () => {
  it('has at least one root group', () => {
    expect(COURSE_TREE.length).toBeGreaterThan(0)
    for (const n of COURSE_TREE) expect(n.type).toBe('group')
  })

  it('every node has a unique key', () => {
    const keys = flatten(COURSE_TREE).map((n) => n.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every leaf points to a category that exists in CATEGORIES', () => {
    const validCats = new Set(CATEGORIES.map((c) => c.key))
    walk(COURSE_TREE, (n) => {
      if (n.type === 'leaf' && n.category) {
        expect(validCats.has(n.category)).toBe(true)
      }
    })
  })

  it('every leaf subBank reference exists in the referenced category', () => {
    const catMap = new Map(CATEGORIES.map((c) => [c.key, c]))
    walk(COURSE_TREE, (n) => {
      if (n.type === 'leaf' && n.category && n.subBank != null) {
        const cat = catMap.get(n.category)
        expect(cat, `category ${n.category} must exist`).toBeDefined()
        const subKeys = (cat!.subBanks ?? []).map((sb) => sb.key)
        expect(
          subKeys.includes(n.subBank!),
          `subBank "${n.subBank}" not found in category "${n.category}"`,
        ).toBe(true)
      }
    })
  })

  it('contains the expected top-level groups', () => {
    const topKeys = COURSE_TREE.map((n) => n.key)
    expect(topKeys).toContain('freshman-spring')
    expect(topKeys).toContain('general')
  })

  it('contains japanese2 group with word and grammar leaves', () => {
    const jp2 = flatten(COURSE_TREE).find((n) => n.type === 'group' && n.key === 'japanese2-group')
    expect(jp2, 'japanese2-group must exist').toBeDefined()
    expect(jp2!.children?.length).toBeGreaterThan(0)
    const leafKeys = jp2!.children!.map((c) => c.key)
    expect(leafKeys).toContain('jp2-word')
    expect(leafKeys).toContain('jp2-grammar')
  })

  it('leaf nodes with requireUnlock do not break the contract when locked', () => {
    walk(COURSE_TREE, (n) => {
      if (n.type === 'leaf' && n.requireUnlock) {
        // requireUnlock 节点允许不挂 category（如纯路由入口）
        expect(n.route || n.category, 'requireUnlock leaf needs route or category').toBeTruthy()
      }
    })
  })
})
