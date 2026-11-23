import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const category = 'japanese3-final-vocabulary'
const file = 'data/raw/japanese3/vocabulary-47-50.md'
const markdown = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const [body, answerTable] = markdown.split(/^## 答案速查/mu)
assert.ok(answerTable, '缺少答案速查表')
const answerKeys = [...answerTable.matchAll(/^\| 答案 \|(.+)$/gmu)].flatMap((row) =>
  row[1]
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean),
)

const lessonCounts = { 47: 28, 48: 14, 49: 26, 50: 24 }
const records = body.split(/^## 单词第 /mu).slice(1)
assert.equal(records.length, 92, '原稿题量应为 92 题')
assert.equal(answerKeys.length, records.length, '答案速查表题量不符')

const questions = records.map((record, index) => {
  const heading = record.match(/^(\d+) 题（(47|48|49|50)课，考(读音|汉字书写)：([^）]+)）$/mu)
  assert.ok(heading, `第 ${index + 1} 题的标题无法识别`)
  const [, number, lesson, topic, headword] = heading
  const position = index + 1
  const context = `第 ${number} 题`
  assert.equal(Number(number), position, `${context} 的题号不连续`)

  const stemField = record.match(/^\*\*题干：\*\* (.+)（「([^」]+)」划线）$/mu)
  assert.ok(stemField, `${context} 缺少题干或划线标记`)
  const [, sourceSentence, target] = stemField
  let sentence = sourceSentence
  assert.equal(sentence.split(target).length, 2, `${context} 的划线词须在题干中出现一次`)

  const optionParts = record.match(/^\*\*选项：\*\* A\. (.+?)　B\. (.+?)　C\. (.+?)　D\. (.+)$/mu)
  assert.ok(optionParts, `${context} 缺少四个选项`)
  const options = optionParts.slice(1).map((value, i) => ({ key: 'ABCD'[i], text: value.trim() }))

  const answer = record.match(/^\*\*答案：\*\* ([A-D])（(.+)）$/mu)
  assert.ok(answer, `${context} 缺少答案或解析`)
  const [, answerKey, explanation] = answer
  assert.equal(answerKey, answerKeys[index], `${context} 的答案与速查表不符`)
  const correct = options.find(({ key }) => key === answerKey)
  assert.ok(explanation.startsWith(`${correct.text}，`), `${context} 的答案文字与选项不符`)

  // 「目差す」也是「めざす」的写法，替换这个干扰项以保证只有一个正确选项。
  if (position === 62) {
    assert.equal(options[0].text, '目差して')
    options[0].text = '目刺して'
  }
  // 「拝見する」的宾语使用「を」。
  if (position === 82) {
    assert.equal(sentence, 'お手紙のはいけんいたしました。')
    sentence = 'お手紙をはいけんいたしました。'
  }
  assert.ok(
    options.every(({ text }) => text),
    `${context} 有空选项`,
  )
  assert.equal(new Set(options.map(({ text }) => text)).size, 4, `${context} 有重复选项`)

  const groupId = `lesson-${lesson}`
  const groupTitle = `第${lesson}课`
  const reading = topic === '读音'
  const prompt = reading ? '请选择划线部分的读音。' : '请选择划线部分的汉字写法。'
  return {
    id: `${category}-${groupId}-${number}`,
    category,
    groupId,
    groupTitle,
    numberInGroup: position,
    stem: `${prompt}\n\n${sentence.replace(target, `<u>${target}</u>`)}`,
    options,
    answerKey,
    answerText: correct.text,
    translation: '',
    explanation,
    grammarPoints: [],
    tags: [topic],
    subType: reading ? 'kanji-to-kana' : 'kana-to-kanji',
    headword,
    source: { file, group: groupTitle, position, originalNumbers: [number] },
    status: 'ready',
    questionType: 'single',
    answerProvenance: 'generated',
    explanationSource: 'generated',
  }
})

for (const [lesson, count] of Object.entries(lessonCounts)) {
  assert.equal(questions.filter(({ groupId }) => groupId === `lesson-${lesson}`).length, count)
}

const output = new URL(`../public/${category}-question-bank.json`, import.meta.url)
writeFileSync(output, JSON.stringify(questions, null, 2) + '\n')
console.log(`[${category}] 已生成 ${questions.length} 题`)
