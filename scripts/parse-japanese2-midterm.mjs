import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = resolve(root, 'data/raw/jp1-mid24')
const questions = JSON.parse(
  readFileSync(resolve(sourceDirectory, 'reviewed-questions.json'), 'utf8'),
)

assert.equal(questions.length, 95, '原卷应有95个独立题号')
assert.equal(new Set(questions.map((q) => q.id)).size, 95, '题目ID不能重复')
assert.deepEqual(
  questions.map((q) => q.numberInGroup),
  Array.from({ length: 95 }, (_, i) => i + 1),
  '原卷题号必须完整且按顺序排列',
)

for (const question of questions) {
  assert.equal(question.category, 'jp1-mid24')
  assert.equal(question.options.length, 4, `${question.id} 必须保留四个原卷选项`)
  assert.deepEqual(
    question.options.map((option) => option.key),
    ['A', 'B', 'C', 'D'],
  )
  const answer = question.options.find((option) => option.key === question.answerKey)
  assert.equal(answer?.text, question.answerText, `${question.id} 答案文字与选项不一致`)
  assert.equal(question.answerProvenance, 'generated', '无标准答案的照片不能标成printed')
  assert.equal(question.status, 'needs_review')
  if (!question.excludeFromPractice) {
    assert.equal(
      new Set(question.options.map((option) => option.text)).size,
      4,
      `${question.id} 可判分题不能有重复选项`,
    )
  }
}

const published = questions
  .filter((question) => !question.excludeFromPractice)
  .map(({ excludeFromPractice, ...question }) => question)

writeFileSync(
  resolve(root, 'public/jp1-mid24-question-bank.json'),
  JSON.stringify(published, null, 2) + '\n',
)

// Markdown 是便于人工核对的来源存档，由结构化源统一生成。
const archive = [
  '# 大连理工大学 综合日语2期中（A）2024年4月21日',
  '',
  '> 本存档由 reviewed-questions.json 生成；修改结构化源后运行 npm run parse:japanese2-midterm。',
  '> 原卷95题；原始照片page-003、001、002、004依次对应印刷页A-1至A-8，其余照片为重叠局部。',
  '> 答案及解析由AI校对，非官方答案，未经教师或人工确认。带“暂不上站”的题保留在源资料中，不参与自动判分。',
  '',
  '## 题组一：大连理工大学 综合日语2期中（A）2024年4月21日',
  '',
]
for (const question of questions) {
  archive.push(`### 第${question.numberInGroup}题`, '', `> 题目ID：${question.id}`, '')
  if (question.excludeFromPractice) {
    archive.push(`> 暂不上站：${question.excludeFromPractice}`, '')
  }
  archive.push('#### 题目', '', question.stem, '')
  for (const option of question.options) archive.push(`${option.key}. ${option.text}`)
  archive.push(
    '',
    '#### 答案与解析',
    '',
    `**${question.excludeFromPractice ? '候选答案（不用于判分）' : '参考答案'}：${question.answerKey} ${question.answerText}**`,
    '',
    question.explanation,
    '',
  )
}
writeFileSync(resolve(sourceDirectory, 'jp1-mid24.md'), archive.join('\n'))
const processed = resolve(root, 'data/processed')
mkdirSync(processed, { recursive: true })
const report = {
  category: 'jp1-mid24',
  source: 'data/raw/jp1-mid24/reviewed-questions.json',
  sourceQuestions: questions.length,
  publishedQuestions: published.length,
  excludedQuestions: questions
    .filter((question) => question.excludeFromPractice)
    .map((question) => ({
      originalNumber: question.numberInGroup,
      id: question.id,
      reason: question.excludeFromPractice,
    })),
  hardErrors: [],
  answerProvenance: 'generated',
  humanVerified: false,
}
writeFileSync(
  resolve(processed, 'jp1-mid24-validation-report.json'),
  JSON.stringify(report, null, 2) + '\n',
)
console.log(
  `综合日语2期中：原卷${questions.length}题，发布${published.length}题，暂缓${questions.length - published.length}题。`,
)
