import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = JSON.parse(
  readFileSync(resolve(root, 'data/raw/jp1-mid24/reviewed-questions.json'), 'utf8'),
)
const bank = JSON.parse(readFileSync(resolve(root, 'public/jp1-mid24-question-bank.json'), 'utf8'))
const byNumber = (number) => bank.find((q) => q.numberInGroup === number)

test('95道原题去除重叠截图，4道有歧义的题不自动判分', () => {
  assert.equal(source.length, 95)
  assert.equal(bank.length, 91)
  assert.equal(new Set(bank.map((q) => q.numberInGroup)).size, 91)
  assert.deepEqual(
    source.filter((q) => q.excludeFromPractice).map((q) => q.numberInGroup),
    [3, 4, 78, 88],
  )
  for (const number of [3, 4, 78, 88]) assert.equal(byNumber(number), undefined)
})

test('可判分题有四个不同选项，答案文字一致且来源不冒充官方', () => {
  for (const q of bank) {
    assert.equal(new Set(q.options.map((option) => option.text)).size, 4, q.id)
    assert.equal(q.options.find((option) => option.key === q.answerKey)?.text, q.answerText, q.id)
    assert.equal(q.answerProvenance, 'generated')
  }
})

test('纠正原照片中的选项字母和排序题星号位置', () => {
  for (const [number, key] of [
    [8, 'C'],
    [9, 'D'],
    [23, 'D'],
    [31, 'D'],
    [67, 'C'],
    [73, 'A'],
    [81, 'D'],
    [82, 'A'],
  ]) {
    assert.equal(byNumber(number).answerKey, key, `原卷第${number}题`)
  }
  assert.match(byNumber(73).stem, /）たい。$/u)
  assert.match(byNumber(81).stem, /車［★］［　］/u)
})

test('阅读文章不串题，面积为16平方米而非1.6', () => {
  for (const n of [91, 92]) {
    assert.match(byNumber(n).stem, /キヨスク/u)
    assert.match(byNumber(n).stem, /16平方/u)
    assert.doesNotMatch(byNumber(n).stem, /実力テストのお知らせ|1\.6平方/u)
  }
  for (const n of [93, 94, 95]) {
    assert.match(byNumber(n).stem, /実力テストのお知らせ/u)
    assert.doesNotMatch(byNumber(n).stem, /キヨスク/u)
  }
})

test('运行时题库由结构化源可重复生成，保留原题ID', () => {
  assert.deepEqual(
    bank,
    source.filter((q) => !q.excludeFromPractice).map(({ excludeFromPractice, ...q }) => q),
  )
  assert.equal(byNumber(81).id, 'jp1-mid24-q091')
})
