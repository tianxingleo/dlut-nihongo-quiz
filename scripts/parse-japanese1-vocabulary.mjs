import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kinds = ['普通词汇', '专有名词', '固定表达', '数字日期']
const norm = (s) => s.normalize('NFKC').replace(/[\s～〜~！？?！。、・／/（）()［\]：:]/g, '')
const kana = (s) => norm(s).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 96))
const han = (s) => new Set(s.match(/\p{Script=Han}/gu) || [])
// Exclude semantically related alternatives even when their source translations differ.
const families = [
  ['家', 'うち'],
  ['会社員', '社員'],
  ['こちら', 'ここ', 'これ', 'この～'],
  ['そちら', 'そこ', 'それ', 'その～'],
  ['あちら', 'あそこ', 'あれ', 'あの～'],
  ['私', '貴方', 'あのかた', 'あのひと', '彼', '彼女', '人', '方'],
  ['お土産', 'プレゼント'],
  ['テーブル', '机'],
  ['コンピューター', 'パソコン'],
  ['はい', 'ええ', 'そうです', 'そうですね', '分かりました', 'かしこまりました'],
  ['いいえ', '違います', '駄目'],
  ['もう', 'まだ'],
  ['少し', '少々', 'ちょっと'],
  ['すみません', '失礼します', '失礼ですが', 'ごめんなさい'],
  ['ございます', 'ある', 'あります', 'いる', 'いらっしゃる'],
  ['～から', '～からきました'],
  ['ください', '下さい', 'お願いします'],
]

export function compatible(a, b) {
  if (a.id === b.id || norm(a.word) === norm(b.word)) return false
  if (a.reading && b.reading && kana(a.reading) === kana(b.reading)) return false
  const aw = norm(a.word),
    bw = norm(b.word)
  if (aw.includes(bw) || bw.includes(aw)) return false
  if (families.some((f) => f.includes(a.word) && f.includes(b.word))) return false
  // A conservative exclusion: no shared Chinese character in translations.
  const am = han(a.meaning),
    bm = han(b.meaning)
  if ([...am].some((c) => bm.has(c))) return false
  return true
}
function hash(s) {
  let n = 2166136261
  for (const c of s) n = Math.imul(n ^ c.codePointAt(0), 16777619) >>> 0
  return n
}

export function generate(doc) {
  const entries = doc.entries.filter((e) => e.status === 'ready')
  const questions = [],
    omissions = []
  const category = `japanese1-${doc.scope}`
  for (const e of entries) {
    const isKanji = /\p{Script=Han}/u.test(e.word) && Boolean(e.reading)
    const directions = isKanji
      ? ['kana-to-kanji', 'kanji-to-kana']
      : ['japanese-to-chinese', 'chinese-to-japanese']
    for (const direction of directions) {
      const field =
        direction === 'kanji-to-kana'
          ? 'reading'
          : direction === 'japanese-to-chinese'
            ? 'meaning'
            : 'word'
      const answer = e[field]
      const pool = entries
        .filter(
          (b) =>
            compatible(e, b) &&
            b[field] &&
            (direction !== 'kana-to-kanji' || /\p{Script=Han}/u.test(b.word)),
        )
        .sort(
          (a, b) =>
            Number(b.type === e.type) - Number(a.type === e.type) ||
            hash(e.id + direction + a.id) - hash(e.id + direction + b.id),
        )
      const chosen = [],
        seen = new Set([norm(answer)])
      for (const b of pool) {
        if (seen.has(norm(b[field]))) continue
        seen.add(norm(b[field]))
        chosen.push(b)
        if (chosen.length === 3) break
      }
      if (chosen.length < 3) {
        omissions.push({ id: e.id, direction, reason: '不足三个无歧义干扰项' })
        continue
      }
      const texts = chosen.map((b) => b[field])
      const slot = hash(e.id + direction) % 4
      texts.splice(slot, 0, answer)
      const labels = {
        'kana-to-kanji': '假名 → 写法',
        'kanji-to-kana': '写法 → 假名',
        'japanese-to-chinese': '日语 → 中文',
        'chinese-to-japanese': '中文 → 日语',
      }
      const prompt =
        direction === 'kana-to-kanji'
          ? `${e.reading}（${e.meaning}）`
          : direction === 'kanji-to-kana'
            ? `${e.word}（${e.meaning}）`
            : direction === 'japanese-to-chinese'
              ? e.word
              : e.meaning
      const id = `${category}-${e.id.split('-').at(-1)}-${direction}`
      const kind = kinds.indexOf(e.type)
      questions.push({
        id,
        category,
        groupId: `${category}-type-${kind + 1}`,
        groupTitle: e.type,
        numberInGroup: questions.filter((q) => q.groupTitle === e.type).length + 1,
        stem: `${labels[direction]}｜${prompt}`,
        options: texts.map((text, i) => ({ key: 'ABCD'[i], text })),
        answerKey: 'ABCD'[slot],
        answerText: answer,
        translation: e.meaning,
        explanation: `${e.word}${e.reading ? `（${e.reading}）` : ''}：${e.meaning}。${e.partOfSpeech ? `词性／形式：${e.partOfSpeech}。` : ''}`,
        grammarPoints: [],
        tags: ['单词', doc.scopeLabel, e.type, labels[direction]],
        source: {
          file: `data/raw/japanese1/japanese1-${doc.scope}-vocabulary.json`,
          group: e.type,
          position: doc.entries.indexOf(e) + 1,
        },
        status: 'ready',
        answerProvenance: 'generated',
        explanationSource: 'generated',
        ...(isKanji ? { subType: direction } : { questionType: 'single' }),
        headword: `${e.word}${e.reading ? `（${e.reading}）` : ''} — ${e.meaning}`,
        sourceNotes: e.sources.map((s) => `${s.file} · ${s.section} · ${s.location}`),
      })
    }
  }
  return { questions, omissions }
}

export function publish() {
  const report = []
  for (const scope of ['midterm', 'final']) {
    const doc = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, `data/raw/japanese1/japanese1-${scope}-vocabulary.json`),
        'utf8',
      ),
    )
    const { questions, omissions } = generate(doc)
    fs.writeFileSync(
      path.join(ROOT, `public/japanese1-${scope}-question-bank.json`),
      JSON.stringify(questions, null, 2) + '\n',
    )
    report.push({
      scope,
      sourceEntries: doc.entries.length,
      publishedEntries: new Set(questions.map((q) => q.source.position)).size,
      questions: questions.length,
      withheld: doc.entries
        .filter((e) => e.status !== 'ready')
        .map((e) => ({ id: e.id, word: e.word, reason: e.notes })),
      omissions,
    })
  }
  fs.writeFileSync(
    path.join(ROOT, 'data/processed/japanese1-validation-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  console.log(
    report
      .map(
        (r) =>
          `${r.scope}: ${r.publishedEntries} words / ${r.questions} questions; withheld ${r.withheld.length}`,
      )
      .join('\n'),
  )
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) publish()
