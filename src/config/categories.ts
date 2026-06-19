import type { Category } from '../types/question'

export interface CategoryMeta {
  key: Category
  short: string
  long: string
  desc: string
  icon: string
  bankFile: string
  groupOrder?: string[]
  groupViewTitle?: string
  groupViewHint?: string
}

export const CATEGORIES: CategoryMeta[] = [
  {
    key: 'grammar',
    short: '语法',
    long: '日语语法',
    desc: '大家的日语 第26–36课 · 语法点辨析与填空',
    icon: '文',
    bankFile: 'question-bank.json',
  },
  {
    key: 'word',
    short: '单词',
    long: '日语单词',
    desc: '汉字 ↔ 假名互选 · 课次标签分组',
    icon: '語',
    bankFile: 'word-question-bank.json',
  },
  {
    key: 'history',
    short: '近代史',
    long: '中国近现代史',
    desc: '11个刷题单 · 单选/多选/判断 · 机考模拟',
    icon: '史',
    bankFile: 'history-question-bank.json',
    groupOrder: [
      't0',
      't1',
      't2',
      't3',
      't5-1',
      't5-2',
      't5-3',
      't5-4',
      'hist-a',
      'hist-b',
      'hist-c',
    ],
    groupViewTitle: '刷题单',
    groupViewHint: '每单独立计分，互不影响。机考模拟按试卷拆成 4 个独立组。',
  },
  {
    key: 'party',
    short: '党史',
    long: '中国共产党党史',
    desc: '7个刷题单 · 单选/多选/判断 · 优先级分层',
    icon: '党',
    bankFile: 'party-question-bank.json',
    groupOrder: [
      'party-single',
      'party-multi',
      'party-judge',
      'party-p1',
      'party-p2',
      'party-p3',
      'party-p4',
    ],
    groupViewTitle: '刷题单（按题型 / 按优先级）',
    groupViewHint: '每单独立计分。「按题型」组与「按优先级」组共享同一批题目，可任选节奏。',
  },
  {
    key: 'military',
    short: '军事理论',
    long: '军事理论',
    desc: '22个刷题单 · 按章节/按优先级 · 必考核心标注',
    icon: '军',
    bankFile: 'military-question-bank.json',
    groupOrder: [
      'military-ch1',
      'military-ch2',
      'military-ch3',
      'military-ch4',
      'military-ch5',
      'military-ch6',
      'military-ch7',
      'military-ch8',
      'military-ch9',
      'military-ch10',
      'military-ch11',
      'military-ch12',
      'military-ch13',
      'military-ch14',
      'military-ch15',
      'military-ch16',
      'military-ch17',
      'military-ch18',
      'military-p1',
      'military-p2',
      'military-p3',
      'military-p4',
    ],
    groupViewTitle: '刷题单（按章节 / 按优先级）',
    groupViewHint:
      '每单独立计分。「按章节」组与「按优先级」组共享同一批题目；P1 必考核心建议先刷。',
  },
]

const CATEGORY_MAP: Record<Category, CategoryMeta> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.key] = c
    return acc
  },
  {} as Record<Category, CategoryMeta>,
)

export function getCategoryMeta(cat: Category): CategoryMeta {
  return CATEGORY_MAP[cat]
}

export const NO_SHUFFLE_CATEGORIES: ReadonlySet<Category> = new Set([
  'history',
  'party',
  'military',
])

export const GROUPED_CATEGORIES: ReadonlySet<Category> = new Set(['history', 'party', 'military'])
