import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const papers = JSON.parse(
  fs.readFileSync(path.join(root, 'data/raw/calculus-midterms/reviewed-papers.json'), 'utf8'),
)
const banks = new Map()
const ids = new Set()
const report = {
  humanVerified: false,
  reviewMethod: 'AI 对照试题、参考答案和页图逐题复核；不等同于教师审核',
  total: 0,
  published: 0,
  withheld: [],
  papers: [],
}
let markdown =
  '# 微积分1期中试卷校对归档\n\n依据试题与参考答案配对整理。以下为 AI 复核稿；更正和暂缓题均保留记录。\n'
for (const paper of papers) {
  const title = `${paper.year}年期中${paper.year === 2016 ? '（含原文件中的替换题）' : ''}`
  const published = []
  markdown += `\n## ${title}\n`
  for (const q of paper.questions) {
    if (ids.has(q.id)) throw new Error(`Duplicate id: ${q.id}`)
    ids.add(q.id)
    report.total++
    markdown += `\n### ${q.number}\n\n${q.stem}\n\n${q.options.map((o) => `${o.key}. ${o.text}`).join('\n\n')}\n\n参考解答：${q.answerKey} ${q.answerText}\n\n${q.explanation}\n`
    if (q.reviewNotes?.length) markdown += `\n校对记录：${q.reviewNotes.join('；')}\n`
    if (q.excludeFromPractice) {
      report.withheld.push({
        id: q.id,
        year: paper.year,
        number: q.number,
        reason: q.excludeFromPractice,
      })
      markdown += `\n**暂缓收录：${q.excludeFromPractice}**\n`
      continue
    }
    if (!q.stem || !q.answerText || q.reviewStatus !== 'ai-reviewed')
      throw new Error(`Incomplete review: ${q.id}`)
    if (
      q.options.length &&
      (q.options.length !== 4 || !q.options.some((o) => o.key === q.answerKey))
    )
      throw new Error(`Invalid choices: ${q.id}`)
    published.push({
      id: q.id,
      category: paper.category,
      groupId: `${paper.category}-${paper.year}`,
      groupTitle: title,
      numberInGroup: q.number,
      stem: q.stem,
      options: q.options,
      answerKey: q.answerKey,
      answerText: q.answerText,
      translation: '',
      explanation: q.explanation || '参考答案已与原卷对应项核对。',
      grammarPoints: [],
      tags: [],
      source: {
        file: 'calculus-midterms/reviewed-papers.json',
        group: title,
        position: q.number,
        pages: [q.questionSource.page],
        originalNumbers: [q.sourceNumber == null ? `整理序号${q.number}` : String(q.sourceNumber)],
      },
      status: 'needs_review',
      answerProvenance: 'generated',
      explanationSource: 'generated',
      reviewNotes: ['AI 对照原卷复核，未经教师审核。', ...q.reviewNotes],
      sourceNotes: [
        `试题 ${q.questionSource.bank} 第${q.questionSource.page}页；参考解答 ${q.answerSource.bank} 第${q.answerSource.page}页。`,
      ],
      questionType: q.options.length ? 'single' : 'fill',
      ...(!q.options.length ? { selfAssessment: true } : {}),
    })
  }
  report.papers.push({
    year: paper.year,
    total: paper.questions.length,
    published: published.length,
  })
  report.published += published.length
  banks.set(paper.category, [...(banks.get(paper.category) || []), ...published])
}
for (const [category, questions] of banks)
  fs.writeFileSync(
    path.join(root, `public/${category}-question-bank.json`),
    JSON.stringify(questions, null, 2) + '\n',
  )
fs.writeFileSync(path.join(root, 'data/raw/calculus-midterms/reviewed-papers.md'), markdown)
fs.writeFileSync(
  path.join(root, 'data/processed/calculus-midterms-validation-report.json'),
  JSON.stringify(report, null, 2) + '\n',
)
console.log(
  `Calulus midterms: ${report.total} archived, ${report.published} published, ${report.withheld.length} withheld`,
)
