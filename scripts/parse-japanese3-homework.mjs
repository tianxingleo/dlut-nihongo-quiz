import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const category = 'japanese3-homework'
const sourceFile = 'data/raw/japanese3/homework-lessons-47-50.txt'
const source = readFileSync(new URL(`../${sourceFile}`, import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
)
const groups = [
  { id: 'lesson-47', title: '第47课助词填空', count: 5 },
  { id: 'lesson-48', title: '第48课助词填空', count: 3 },
  { id: 'lesson-49', title: '第49课助词填空', count: 6 },
  { id: 'lesson-50', title: '第50课助词填空', count: 7 },
  { id: 'review-l', title: '復習L', count: 32 },
  { id: 'final-review', title: '総復習', count: 69, excludes: /^(?:1[6-9]|2[0-6]|57)$/ },
]

// 空位从 0 开始。仅接受原解析列出的同义答案，保留作业要求的句型和活用。
const alternatives = {
  'lesson-49-2': { 0: ['へ'] },
  'final-review-28': { 3: ['あげたい'] },
  'final-review-29': { 2: ['習いたい', '習うつもりだ'] },
  'final-review-30': { 1: ['通う'] },
  'final-review-39': { 0: ['複雑で'] },
  'final-review-42': { 0: ['苦すぎて'] },
  'final-review-49': { 0: ['服を汚されてしまいました'] },
  'final-review-52': { 0: ['マンガをかくの'] },
}

const slotMarkers = '①②③④⑤⑥'
const optionPattern = /^[A-Z]\. /u
const joinLines = (lines) => lines.join('  \n')

function parseOptions(lines, id) {
  assert.ok(lines.length >= 2 && lines.every((line) => optionPattern.test(line)), id)
  return lines.map((line) => ({ key: line[0], text: line.slice(3) }))
}

function parseQuestion(group, number, body, answer) {
  const id = `${group.id}-${number}`
  const lines = body.split('\n').map((line) => line.trim())
  if (/^[A-Z]．/.test(answer)) {
    const options = parseOptions(
      lines.filter((line) => optionPattern.test(line)),
      id,
    )
    const correct = options.find((option) => option.key === answer[0])
    assert.ok(correct, `${id} 缺少正确选项`)
    return {
      questionType: 'single',
      stem: joinLines(lines.filter((line) => !optionPattern.test(line))),
      options,
      answerKey: correct.key,
      answerText: correct.text,
    }
  }

  let fillSlots
  let stem
  if (answer.startsWith('①')) {
    const optionLine = /^[①②] [A-Z]\. /u
    stem = joinLines(lines.filter((line) => !optionLine.test(line)))
    const parts = answer.split('；')
    const choiceLines = lines.filter((line) => optionLine.test(line))
    assert.equal(choiceLines.length, parts.length, `${id} 的选项组数与答案不符`)
    fillSlots = parts.map((part, index) => {
      assert.equal(part[0], slotMarkers[index], id)
      assert.equal(choiceLines[index][0], part[0], id)
      assert.ok(stem.includes(part[0]), id)
      const options = parseOptions(choiceLines[index].slice(2).split(/\s+(?=[A-Z]\. )/u), id)
      const correct = options.find((option) => option.key === part[1])
      assert.ok(correct, `${id} 的${part[0]}缺少正确选项`)
      assert.equal(correct.text, part.slice(3), id)
      return { answers: [correct.text], options }
    })
  } else {
    const answers = answer.replace(/（[^）]*）$/u, '').split('／')
    assert.ok(answers.length <= slotMarkers.length && answers.every(Boolean), id)
    let slotIndex = 0
    stem = joinLines(lines).replace(/\(\s*\)|（\s*）|____/gu, () => slotMarkers[slotIndex++])
    assert.equal(slotIndex, answers.length, `${id} 的空位数与答案不符`)
    fillSlots = answers.map((text, index) => ({
      answers: [text, ...(alternatives[id]?.[index] ?? [])],
    }))
  }
  const answerText = fillSlots.map((slot) => slot.answers[0]).join('／')
  return { questionType: 'fill', stem, options: [], fillSlots, answerKey: answerText, answerText }
}

const sections = source.split(/^(.+)\n={30}\n/gm).slice(1)
assert.equal(sections.length, groups.length * 2, '作业分组数量错误')
const questions = groups.flatMap((group, index) => {
  assert.equal(sections[index * 2], group.title)
  const section = sections[index * 2 + 1]
  const records = [
    ...section.matchAll(/^(\d+)\. (.+(?:\n[ \t]+[^\n]+)*)\n\n答案：(.+)\n解析：(.+)$/gm),
  ]
  const expectedNumbers = Array.from({ length: group.count }, (_, i) => i + 1).filter(
    (number) => !group.excludes?.test(String(number)),
  )
  assert.deepEqual(
    records.map((record) => Number(record[1])),
    expectedNumbers,
    group.title,
  )
  return records.map(([, originalNumber, body, answer, explanation], position) => {
    const number = Number(originalNumber)
    return {
      id: `${category}-${group.id}-${number}`,
      category,
      groupId: group.id,
      groupTitle: group.title,
      numberInGroup: number,
      ...parseQuestion(group, number, body, answer),
      translation: '',
      explanation,
      grammarPoints: [],
      tags: [group.title],
      source: {
        file: sourceFile,
        group: group.title,
        position: position + 1,
        originalNumbers: [originalNumber],
      },
      status: 'ready',
      answerProvenance: 'generated',
      explanationSource: 'generated',
    }
  })
})

const output = new URL(`../public/${category}-question-bank.json`, import.meta.url)
writeFileSync(output, JSON.stringify(questions, null, 2) + '\n')
console.log(`[${category}] 已生成 ${questions.length} 题`)
