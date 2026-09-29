import type { Category, SubBankMeta } from '../types/question'

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
  subBanks?: SubBankMeta[]
}

export const CATEGORIES: CategoryMeta[] = [
  {
    key: 'japanese2',
    short: '日语',
    long: '综合日语2',
    desc: '单词 · 语法（学习通99题 + 2021/2024 真题）',
    icon: '日',
    bankFile: 'japanese2-question-bank.json',
    subBanks: [
      {
        key: 'word',
        name: '单词',
        desc: '汉字 ↔ 假名互选 · 课次标签分组',
        groupOrder: ['w26', 'w27', 'w28', 'w32', 'w33', 'w35', 'w36'],
        groupViewTitle: '课次',
      },
      {
        key: 'grammar-textbook',
        name: '学习通99题',
        desc: '大家的日语第26–36课 · 语法点辨析与填空',
        groupOrder: ['g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'g07', 'g08', 'g09', 'g10'],
        groupViewTitle: '学习通 · 题组',
      },
      {
        key: 'grammar-2021',
        name: '2021年真题',
        desc: '79题 · 汉字读音/词汇/语法综合',
        groupOrder: ['g11'],
        requireUnlock: true,
        groupViewTitle: '2021真题',
      },
      {
        key: 'grammar-2024',
        name: '2024年真题',
        desc: '8大题组 · 读音/汉字/词汇/语法/阅读',
        groupOrder: ['g21', 'g22', 'g23', 'g24', 'g25', 'g26', 'g27', 'g28'],
        requireUnlock: true,
        groupViewTitle: '2024真题 · 题型',
      },
    ],
  },
  {
    key: 'history',
    short: '近代史',
    long: '中国近现代史',
    desc: '12个刷题单 · 单选/多选/判断 · 机考模拟',
    icon: '史',
    bankFile: 'history-question-bank.json',
    groupOrder: [
      'hist-d',
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
  {
    key: 'computer-2021-final',
    short: '2021期末',
    long: '计算机组成 · 2021期末',
    desc: '按原卷拆分题单 · 答案与解析',
    icon: '组',
    bankFile: 'computer-2021-final-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '按原卷大题分组，支持顺序、随机与错题复习。',
  },
  {
    key: 'computer-2024-final',
    short: '2024期末（部分试卷）',
    long: '计算机组成 · 2024期末（部分试卷）',
    desc: '按原卷拆分题单 · 答案与解析',
    icon: '组',
    bankFile: 'computer-2024-final-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '按原卷大题分组，支持顺序、随机与错题复习。',
  },
  {
    key: 'computer-c-exam',
    short: 'C卷（日期待核对）',
    long: '计算机组成 · C卷（日期待核对）',
    desc: '按原卷拆分题单 · 答案与解析',
    icon: '组',
    bankFile: 'computer-c-exam-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '按原卷大题分组，支持顺序、随机与错题复习。',
  },
  {
    key: 'computer-midterms',
    short: '期中三年合集',
    long: '计算机组成 · 期中三年合集',
    desc: '按原卷拆分题单 · 答案与解析',
    icon: '组',
    bankFile: 'computer-midterms-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '按原卷大题分组，支持顺序、随机与错题复习。',
  },
  {
    key: 'computer-2026-midterm',
    short: '计算机组织与结构（软国）2026年',
    long: '计算机组织与结构（软国）2026年',
    desc: '41题 · 双路 OCR 校对 · AI 解析 39 题',
    icon: '组',
    bankFile: 'computer-2026-midterm-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '全卷 1 张题单；匹配题的公共题干已复制到每道小题的题干上方。',
  },
  {
    key: 'principles-of-marxism-1',
    short: '机考真题',
    long: '机考真题',
    desc: '345题 · 双路 OCR 校对 · AI 解析 104 题',
    icon: '组',
    bankFile: 'principles-of-marxism-1-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '全卷 1 张题单；匹配题的公共题干已复制到每道小题的题干上方。',
  },
  {
    key: 'marxism-1',
    short: '马原试卷1',
    long: '马原试卷1',
    desc: '22题 · 双路 OCR 校对 · AI 解析 22 题',
    icon: '组',
    bankFile: 'marxism-1-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '全卷 1 张题单；匹配题的公共题干已复制到每道小题的题干上方。',
  },
  {
    key: 'marxism-2',
    short: '马原试卷2',
    long: '马原试卷2',
    desc: '26题 · 双路 OCR 校对 · AI 解析 20 题',
    icon: '组',
    bankFile: 'marxism-2-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '全卷 1 张题单；匹配题的公共题干已复制到每道小题的题干上方。',
  },
  {
    key: 'marxism-3',
    short: '马原试卷3',
    long: '马原试卷3',
    desc: '26题 · 双路 OCR 校对 · AI 解析 20 题',
    icon: '组',
    bankFile: 'marxism-3-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '全卷 1 张题单；匹配题的公共题干已复制到每道小题的题干上方。',
  },
  {
    key: 'marxism-6',
    short: '马原试卷6',
    long: '马原试卷6',
    desc: '34题 · 双路 OCR 校对 · AI 解析 31 题',
    icon: '组',
    bankFile: 'marxism-6-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '全卷 1 张题单；匹配题的公共题干已复制到每道小题的题干上方。',
  },
  {
    key: 'marxism-5',
    short: '马原试卷5',
    long: '马原试卷5',
    desc: '25题 · 双路 OCR 校对 · AI 解析 20 题',
    icon: '组',
    bankFile: 'marxism-5-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '全卷 1 张题单；匹配题的公共题干已复制到每道小题的题干上方。',
  },
  {
    key: 'marxism-7',
    short: '马原试卷7',
    long: '马原试卷7',
    desc: '32题 · 双路 OCR 校对 · AI 解析 22 题',
    icon: '组',
    bankFile: 'marxism-7-question-bank.json',
    groupViewTitle: '刷题单',
    groupViewHint: '全卷 1 张题单；匹配题的公共题干已复制到每道小题的题干上方。',
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
  ...CATEGORIES.filter((c) => c.key.startsWith('computer-')).map((c) => c.key),
])

export const GROUPED_CATEGORIES: ReadonlySet<Category> = new Set(
  CATEGORIES.filter((c) => c.groupViewTitle).map((c) => c.key),
)
