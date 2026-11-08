import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { generate } from './parse-japanese1-vocabulary.mjs'

const read = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'))
const docs = ['midterm', 'final'].map((s) =>
  read(`data/raw/japanese1/japanese1-${s}-vocabulary.json`),
)
const banks = docs.map((d) => read(`public/japanese1-${d.scope}-question-bank.json`))

test('published banks are reproducible and only contain reviewed source entries', () => {
  for (let i = 0; i < docs.length; i++) {
    assert.deepEqual(generate(docs[i]).questions, banks[i])
    for (const q of banks[i]) assert.equal(docs[i].entries[q.source.position - 1].status, 'ready')
    assert.equal(banks[i].length, docs[i].entries.filter((e) => e.status === 'ready').length * 2)
  }
})
test('every question has four distinct options, one keyed answer and no corrupted text', () => {
  const ids = new Set()
  for (const bank of banks)
    for (const q of bank) {
      assert.ok(!ids.has(q.id))
      ids.add(q.id)
      assert.equal(q.options.length, 4)
      assert.equal(new Set(q.options.map((o) => o.text.normalize('NFKC'))).size, 4)
      assert.equal(q.options.find((o) => o.key === q.answerKey).text, q.answerText)
      assert.equal(q.options.filter((o) => o.text === q.answerText).length, 1)
      assert.ok(!JSON.stringify(q).includes('\uFFFD'))
      assert.ok(!q.stem.includes('待核实'))
      if (q.subType === 'kanji-to-kana')
        assert.ok(q.options.every((o) => !/\p{Script=Han}/u.test(o.text)))
    }
})
test('known source mistakes stay corrected and ambiguous fragments are withheld', () => {
  const all = docs.flatMap((d) => d.entries)
  const entry = (id) => all.find((e) => e.id === id)
  assert.equal(entry('japanese1-mid-0155').reading, 'くじはん')
  assert.equal(entry('japanese1-mid-0262').word, 'お手洗い')
  assert.equal(entry('japanese1-final-0011').reading, 'にっぽんばし')
  assert.equal(entry('japanese1-final-0239').word, 'ナンプラー')
  for (const id of [
    'japanese1-mid-0186',
    'japanese1-mid-0303',
    'japanese1-mid-0314',
    'japanese1-final-0136',
    'japanese1-final-0172',
  ])
    assert.equal(entry(id).status, 'needs_review')
})
test('kana-only words use translation questions, and same readings are not distractors', () => {
  for (let i = 0; i < docs.length; i++)
    for (const q of banks[i]) {
      const e = docs[i].entries[q.source.position - 1]
      if (!/\p{Script=Han}/u.test(e.word)) assert.equal(q.subType, undefined)
      if (q.subType === 'kana-to-kanji') {
        const equivalent = docs[i].entries.filter((x) => x.reading === e.reading).map((x) => x.word)
        assert.equal(q.options.filter((o) => equivalent.includes(o.text)).length, 1)
      }
    }
})
