/**
 * 首页的**入口卡**（学科/试卷集合）配置。
 *
 * 首页是两层结构：
 *   1. 第一层：入口卡（本文件 `ENTRIES`）+ 不归属任何入口的学科（`CATEGORIES`）
 *   2. 第二层：点进某个入口（路由 `/<入口 key>`）后，列出该入口下的**试卷卡**
 *
 * **顺序由 `papers` 数组决定**：`papers` 里怎么排，「选择试卷」区和侧栏就怎么显示。
 * 一个分类只能属于一个入口；没被任何入口收的 `CATEGORIES` 会作为第一层的学科卡出现。
 *
 * 这份文件由 `pdf-ocr/6_publish.py` 自动维护（`--entry` / `--paper` / `--position` 等），
 * 也可以手改。约束见 `entries.test.ts`。
 */

import type { Category } from '../types/question'

export interface EntryMeta {
  /** 入口 key，同时就是路由路径 `/<key>`；只用小写字母、数字、连字符 */
  key: string
  /** 入口卡标题（如「计算机组成（软国际）」） */
  name: string
  /** 入口卡左侧图标字 */
  icon: string
  /** 入口卡副标题；不填则运行时自动拼「N 份试卷 · M 题」 */
  desc?: string
  /** 该入口下的试卷，**顺序即卡片顺序** */
  papers: Category[]
}

export const ENTRIES: EntryMeta[] = [
  {
    key: 'computer-organization',
    name: '计算机组成（软国际）',
    icon: '组',
    papers: [
      'computer-2021-final',
      'computer-2024-final',
      'computer-c-exam',
      'computer-midterms',
      'computer-2026-midterm',
    ],
  },
  {
    key: 'marxism',
    name: '马克思主义原理',
    icon: '马',
    desc: '机考真题（40页）',
    papers: [
      'marxism-1',
      'marxism-2',
      'marxism-3',
      'principles-of-marxism-1',
      'marxism-5',
      'marxism-6',
      'marxism-7',
    ],
  },
]

/** 按 key（路由参数）找入口。 */
export function findEntry(key: string | undefined | null): EntryMeta | undefined {
  if (!key) return undefined
  return ENTRIES.find((entry) => entry.key === key)
}

/** 这个分类属于哪个入口（不属于任何入口就是第一层的学科卡）。 */
export function entryOfCategory(category: string): EntryMeta | undefined {
  return ENTRIES.find((entry) => (entry.papers as string[]).includes(category))
}
