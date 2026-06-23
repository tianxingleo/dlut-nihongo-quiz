import type { Category } from '../types/question'

export interface TreeNode {
  type: 'group' | 'leaf'
  key: string
  label: string
  icon?: string
  children?: TreeNode[]
  category?: Category
  subBank?: string | null
  requireUnlock?: boolean
  route?: string
}

export const COURSE_TREE: TreeNode[] = [
  {
    type: 'group',
    key: 'freshman-spring',
    label: '大一下',
    icon: '一',
    children: [
      {
        type: 'group',
        key: 'japanese2-group',
        label: '综合日语2',
        children: [
          {
            type: 'leaf',
            key: 'jp2-word',
            label: '单词',
            category: 'japanese2',
            subBank: 'word',
          },
          {
            type: 'leaf',
            key: 'jp2-grammar',
            label: '语法',
            category: 'japanese2',
            subBank: null,
          },
          {
            type: 'leaf',
            key: 'grammar-notes',
            label: '核心语法整理',
            route: '/grammar-notes',
            requireUnlock: true,
            icon: '文',
          },
        ],
      },
      { type: 'leaf', key: 'history', label: '中国近现代史', category: 'history', subBank: null },
      { type: 'leaf', key: 'military', label: '军事理论', category: 'military', subBank: null },
      {
        type: 'leaf',
        key: 'listening-speaking-notes',
        label: '日语听说进阶',
        route: '/listening-speaking-notes',
        icon: '听',
      },
      {
        type: 'leaf',
        key: 'calculus-notes',
        label: '微积分',
        route: '/calculus-notes',
        icon: '∫',
      },
      {
        type: 'leaf',
        key: 'physics-notes',
        label: '大学物理1',
        route: '/physics-notes',
        icon: '物',
      },
      {
        type: 'leaf',
        key: 'digital-circuit-notes',
        label: '数字电路（软国）',
        route: '/digital-circuit-notes',
        icon: '电',
      },
    ],
  },
  {
    type: 'group',
    key: 'general',
    label: '公共基础通识',
    icon: '通',
    children: [
      {
        type: 'group',
        key: 'four-histories',
        label: '四史',
        children: [{ type: 'leaf', key: 'party', label: '党史', category: 'party', subBank: null }],
      },
    ],
  },
]

export function findLeafByKey(key: string): TreeNode | undefined {
  const stack = [...COURSE_TREE]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === 'leaf' && n.key === key) return n
    if (n.children) stack.push(...n.children)
  }
  return undefined
}

export function findLeafByCategory(category: Category): TreeNode | undefined {
  const stack = [...COURSE_TREE]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === 'leaf' && n.category === category) return n
    if (n.children) stack.push(...n.children)
  }
  return undefined
}
