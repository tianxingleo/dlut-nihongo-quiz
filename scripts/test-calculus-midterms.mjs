import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import katex from 'katex'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'))
const papers = read('data/raw/calculus-midterms/reviewed-papers.json')
const categories = [...new Set(papers.map((p) => p.category))]
const banks = categories.flatMap((c) => read(`public/${c}-question-bank.json`))
const question = (year, n) =>
  papers.find((p) => p.year === year).questions.find((q) => q.number === n)

test('source coverage and withholding are explicit; no omitted years or answer-only fragments', () => {
  assert.equal(papers.length, 12)
  assert.equal(
    papers.reduce((n, p) => n + p.questions.length, 0),
    187,
  )
  assert.equal(banks.length, 186)
  assert.equal(new Set(banks.map((q) => q.id)).size, banks.length)
  assert.ok(!banks.some((q) => q.id === question(2019, 11).id))
  for (const year of [2010, 2011, 2012, 2013, 2014, 2015, 2017, 2018, 2024, 2025])
    assert.equal(papers.find((p) => p.year === year).questions.length, 15)
  assert.equal(papers.find((p) => p.year === 2016).questions.length, 16)
  for (const q of banks) {
    assert.ok(q.stem.trim())
    assert.ok(q.answerText.trim())
    assert.ok(q.id.startsWith(q.category + '-'))
    if (q.options.length) {
      assert.deepEqual(
        q.options.map((o) => o.key),
        ['A', 'B', 'C', 'D'],
      )
      assert.equal(q.answerText, q.options.find((o) => o.key === q.answerKey).text)
    } else assert.equal(q.selfAssessment, true)
  }
})
test('all formula spans parse and no bare LaTeX or OCR replacement characters leak', () => {
  let count = 0
  for (const q of banks)
    for (const text of [q.stem, q.answerText, q.explanation, ...q.options.map((o) => o.text)]) {
      assert.ok(!/[\uFFFD\uE000-\uF8FF]/.test(text), q.id)
      assert.equal((text.match(/\$/g) || []).length % 2, 0, q.id)
      for (const m of text.matchAll(/\$\$([\s\S]*?)\$\$|\$([^$]*?)\$/g)) {
        assert.doesNotThrow(
          () => katex.renderToString(m[1] ?? m[2], { throwOnError: true, strict: 'ignore' }),
          q.id + ' ' + m[0],
        )
        count++
      }
      assert.ok(
        !/\\[A-Za-z]/.test(text.replace(/\$\$[\s\S]*?\$\$|\$[^$]*?\$/g, '')),
        q.id + ' bare LaTeX',
      )
      assert.ok(!/后续截断|页面至此|本页解答|未给出最终/.test(text), q.id)
    }
  assert.ok(count > 500)
})
test('printed keys and independently corrected calculations remain consistent', () => {
  assert.equal(
    papers
      .find((p) => p.year === 2024)
      .questions.slice(0, 10)
      .map((q) => q.answerKey)
      .join(''),
    'DBCCABDCDA',
  )
  assert.equal(
    papers
      .find((p) => p.year === 2025)
      .questions.slice(0, 10)
      .map((q) => q.answerKey)
      .join(''),
    'CABC DDACBA'.replaceAll(' ', ''),
  )
  assert.match(question(2017, 4).answerText, /-\\frac/)
  assert.match(question(2014, 4).answerText, /0\.4/)
  assert.match(question(2017, 14).answerText, /p\/2/)
  assert.match(question(2019, 20).answerText, /2x\(1\+x\^2\)/)
  // Finite-difference cross-check for the missing 1/2 in the reference PDF.
  const f = (x) => Math.sin(Math.log(Math.sqrt(x / (1 + x * x))))
  for (const x of [0.25, 0.5, 2, 3]) {
    const h = 1e-5,
      numerical = (f(x + h) - f(x - h)) / (2 * h)
    const corrected =
      ((1 - x * x) / (2 * x * (1 + x * x))) * Math.cos(Math.log(Math.sqrt(x / (1 + x * x))))
    assert.ok(Math.abs(numerical - corrected) < 1e-7)
  }
  // Normal-chord length for y²=px has its minimum at x=p/2, not x=p.
  const p = 2,
    P = p / 2,
    L2 = (x) => (P * (P + 2 * x) ** 3) / x ** 2
  assert.ok(L2(P) < L2(P * 0.9) && L2(P) < L2(P * 1.1))
})
test('generation is deterministic and does not depend on local OCR folders', () => {
  const files = [
    ...categories.map((c) => `public/${c}-question-bank.json`),
    'data/raw/calculus-midterms/reviewed-papers.md',
    'data/processed/calculus-midterms-validation-report.json',
  ]
  const before = files.map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
  execFileSync(process.execPath, ['scripts/parse-calculus-midterms.mjs'], { cwd: root })
  files.forEach((f, i) => assert.equal(fs.readFileSync(path.join(root, f), 'utf8'), before[i]))
})
