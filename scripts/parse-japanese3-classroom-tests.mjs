import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const banks = [
  { category: 'japanese3-classroom-words', label: '单词', count: 37 },
  { category: 'japanese3-classroom-grammar', label: '语法', count: 42 },
]

// 11月2日的部分词汇题在整理稿中省略了划线标记，按题型和选项补出考查词。
const missingTargets = {
  1: '関係',
  2: 'あいて',
  3: '長生き',
  4: '救急車',
  7: '人口',
  8: '婚約',
  10: '厳しい',
}

function formatStem(stem, topic, groupId, number, context) {
  const notes = []
  const underline = stem.match(/（「([^」]+)」划线(?:；([^\n]+))?）$/u)
  const sourceNote = stem.match(/（注：([^\n]+)）$/u)
  const target = underline?.[1] ?? (groupId === 'test-1102' ? missingTargets[number] : undefined)

  if (underline) stem = stem.slice(0, underline.index)
  if (underline?.[2]) notes.push(underline[2])
  if (sourceNote) {
    stem = stem.slice(0, sourceNote.index)
    notes.push(sourceNote[1])
  }
  if (groupId === 'test-1116' && number === 5) {
    stem = stem.replace('ご遠慮な（', 'ご遠慮なく（')
  }
  if (target === 'むえて') {
    stem = stem.replace('む_えて', 'もえて')
    notes.push('整理稿写作「む_えて」，依参考答案「燃えて」的读音订正为「もえて」。')
  }
  if (target) {
    const word = target === 'むえて' ? 'もえて' : target
    assert.ok(stem.includes(word), `${context} 缺少划线词 ${word}`)
    const prompt = topic === '读音' ? '请选择划线部分的读音。' : '请选择划线部分的汉字写法。'
    stem = `${prompt}\n\n${stem.replace(word, `<u>${word}</u>`)}`
  }
  return { stem, notes }
}

function parseBank({ category, label, count }, seenQuestions) {
  const file = `data/raw/japanese3/classroom-tests/${label}题整理.md`
  const markdown = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const questions = []
  const sections = markdown.split(/^## /mu).slice(1)

  for (const section of sections) {
    const [heading, ...lines] = section.split(/\r?\n/u)
    if (heading === `${label}题答案速查` || heading === '各套题语法考点一览') continue
    const record = heading.match(/^(单词|语法)第 (\d+) 题（(\d+)月(\d+)日第(\d+)题，([^\n]+)）$/u)
    assert.equal(record?.[1], label, `无法识别题目标题：${heading}`)
    const [, position, month, day, originalNumber, topicLabel] = record.slice(1)
    const groupTitle = `${month}月${day}日`
    const groupId = `test-${month.padStart(2, '0')}${day.padStart(2, '0')}`
    const originalId = `${groupId}-${originalNumber}`
    const context = `${groupTitle}第${originalNumber}题`
    assert.equal(Number(position), questions.length + 1, `${heading} 的整理稿序号不连续`)
    assert.ok(!seenQuestions.has(originalId), `${context} 重复收录`)
    seenQuestions.add(originalId)

    const fields = Object.fromEntries(
      lines.flatMap((line) => {
        const field = line.match(/^\*\*(题干|选项|答案|解析)：\*\*\s+(.+)$/u)
        return field ? [[field[1], field[2]]] : []
      }),
    )
    const topic = topicLabel.replace(/^考(?:查)?/u, '')
    const { stem, notes } = formatStem(
      fields.题干 ?? '',
      topic,
      groupId,
      Number(originalNumber),
      context,
    )
    const optionParts = (fields.选项 ?? '').trim().split(/(?:^|\s+)([A-D])\.\s+/u)
    assert.equal(optionParts.length, 9, `${context} 的选项数量错误`)
    const options = Array.from('ABCD', (key, index) => {
      assert.equal(optionParts[index * 2 + 1], key, `${context} 的选项顺序错误`)
      return { key, text: optionParts[index * 2 + 2].trim() }
    })
    assert.ok(stem && options.every(({ text }) => text), `${context} 的题干或选项为空`)
    assert.equal(new Set(options.map(({ text }) => text)).size, 4, `${context} 的选项重复`)

    const answer = fields.答案?.match(/^([A-D])（(.+)）$/u)
    const correct = options.find(({ key }) => key === answer?.[1])
    assert.ok(correct, `${context} 缺少有效答案`)
    const explanation = label === '语法' ? fields.解析 : answer[2]
    assert.ok(explanation, `${context} 缺少解析`)
    if (label === '语法') assert.equal(answer[2], correct.text, `${context} 的答案文字与选项不符`)

    questions.push({
      id: `${category}-${originalId}`,
      category,
      groupId,
      groupTitle,
      numberInGroup: Number(originalNumber),
      stem,
      options,
      answerKey: correct.key,
      answerText: correct.text,
      translation: '',
      explanation: [explanation, ...notes.map((note) => `题干备注：${note}`)].join('\n\n'),
      grammarPoints: label === '语法' ? [topic] : [],
      tags: [topic],
      source: {
        file,
        group: groupTitle,
        position: Number(position),
        originalNumbers: [originalNumber],
      },
      status: 'ready',
      questionType: 'single',
      answerProvenance: 'generated',
      explanationSource: 'generated',
    })
  }
  assert.equal(questions.length, count, `${label}题数量不符`)
  return { category, questions }
}

const seenQuestions = new Set()
const parsedBanks = banks.map((bank) => parseBank(bank, seenQuestions))
for (const { category, questions } of parsedBanks) {
  const output = new URL(`../public/${category}-question-bank.json`, import.meta.url)
  writeFileSync(output, JSON.stringify(questions, null, 2) + '\n')
  console.log(`[${category}] 已生成 ${questions.length} 题`)
}
