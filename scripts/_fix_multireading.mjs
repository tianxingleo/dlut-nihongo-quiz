import fs from 'fs'

// 56 个多音字题：把"也是合法读音"的干扰项替换成"真正错的假名"
const dakuten = {
  か: 'が',
  き: 'ぎ',
  く: 'ぐ',
  け: 'げ',
  こ: 'ご',
  さ: 'ざ',
  し: 'じ',
  す: 'ず',
  せ: 'ぜ',
  そ: 'ぞ',
  た: 'だ',
  ち: 'ぢ',
  つ: 'づ',
  て: 'で',
  と: 'ど',
  は: 'ば',
  ひ: 'び',
  ふ: 'ぶ',
  へ: 'べ',
  ほ: 'ぼ',
}
const handaku = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' }
const devoice = {
  が: 'か',
  ぎ: 'き',
  ぐ: 'く',
  げ: 'け',
  ご: 'こ',
  ざ: 'さ',
  じ: 'し',
  ず: 'す',
  ぜ: 'せ',
  ぞ: 'そ',
  だ: 'た',
  ぢ: 'ち',
  づ: 'つ',
  で: 'て',
  ど: 'と',
  ば: 'は',
  び: 'ひ',
  ぶ: 'ふ',
  べ: 'へ',
  ぼ: 'ほ',
  ぱ: 'は',
  ぴ: 'ひ',
  ぷ: 'ふ',
  ぺ: 'へ',
  ぽ: 'ほ',
}
const consShift = {
  か: 'た',
  き: 'ち',
  く: 'つ',
  け: 'て',
  こ: 'と',
  た: 'さ',
  ち: 'し',
  つ: 'す',
  て: 'せ',
  と: 'そ',
  さ: 'は',
  し: 'ひ',
  す: 'ふ',
  せ: 'へ',
  そ: 'ほ',
  は: 'か',
  ひ: 'き',
  ふ: 'く',
  へ: 'け',
  ほ: 'こ',
  ま: 'な',
  み: 'に',
  む: 'ぬ',
  め: 'ね',
  も: 'の',
  な: 'ら',
  に: 'り',
  ぬ: 'る',
  ね: 'れ',
  の: 'ろ',
  ら: 'や',
  り: 'ゆ',
  る: 'よ',
}
const vowelShift = { あ: 'え', い: 'あ', う: 'い', え: 'い', お: 'う' }

function generateKanaAlt(original, existingSet) {
  const candidates = []
  if (original.endsWith('します')) {
    const stem = original.slice(0, -3)
    candidates.push(stem + 'する', stem + 'しまする', stem + 'すます')
  } else if (original.endsWith('ます')) {
    const stem = original.slice(0, -2)
    candidates.push(stem + 'る', stem + 'ました', stem + 'ませ')
  }
  if (original.length > 0) {
    const first = original[0]
    if (dakuten[first]) candidates.push(dakuten[first] + original.slice(1))
    if (devoice[first]) candidates.push(devoice[first] + original.slice(1))
    if (consShift[first]) candidates.push(consShift[first] + original.slice(1))
  }
  if (original.length >= 2) {
    const second = original[1]
    if (dakuten[second]) candidates.push(original[0] + dakuten[second] + original.slice(2))
    if (devoice[second]) candidates.push(original[0] + devoice[second] + original.slice(2))
  }
  if (original.length > 0) {
    const last = original[original.length - 1]
    if (vowelShift[last]) candidates.push(original.slice(0, -1) + vowelShift[last])
  }
  if (original.includes('っ')) {
    candidates.push(original.replace('っ', ''))
    candidates.push(original.replace('っ', 'つ'))
  } else if (original.length >= 3) {
    candidates.push(original.slice(0, 2) + 'っ' + original.slice(2))
  }
  for (const c of candidates) {
    if (c !== original && !existingSet.has(c) && c.length >= 2) return c
  }
  return original + 'ー'
}

const questions = JSON.parse(fs.readFileSync('public/word-question-bank.json', 'utf-8'))
const k2k = questions.filter((q) => q.subType === 'kanji-to-kana')

const toFix = []
for (const q of k2k) {
  const m = q.explanation.match(/其他选项的对应的汉字[：:]\s*(.+)$/)
  if (!m) continue
  const parts = m[1].split(/[；;]/).map((s) => s.trim())
  const headKanji = q.headword.split(/[（(—]/)[0].trim()
  const kanjiChars = [...headKanji].filter((c) => /[一-鿿]/.test(c))
  const validAlts = []
  for (const p of parts) {
    const mm = p.match(/^([A-D])\.\s*(.+?)\s*→\s*(.+?)\s*$/)
    if (!mm) continue
    const key = mm[1],
      optText = mm[2],
      refKanji = mm[3]
    if (
      kanjiChars.some((k) => refKanji.includes(k)) &&
      !refKanji.includes('无') &&
      !refKanji.includes('無')
    ) {
      validAlts.push({ key, optText, refKanji })
    }
  }
  if (validAlts.length > 0)
    toFix.push({ qid: q.id, qheadKanji: headKanji, qstem: q.stem, validAlts })
}

console.log(`需要修复的多音字歧义题: ${toFix.length}`)

const files = [
  'data/raw/日语汉字单词选择题-第26-28课.md',
  'data/raw/日语汉字单词选择题-第28-31课.md',
  'data/raw/日语汉字单词选择题-第32-36课.md',
]

let totalFixed = 0
const report = []

for (const fix of toFix) {
  const m = fix.qid.match(/^w(\d+)-(\d+)-([ab])$/)
  if (!m) continue
  const lesson = +m[1]
  const num = +m[2]
  const subLetter = m[3].toUpperCase()

  let file = null
  if (lesson >= 26 && lesson <= 27) file = files[0]
  else if (lesson >= 28 && lesson <= 31) file = files[1]
  else if (lesson >= 32 && lesson <= 36) file = files[2]
  if (!file) continue

  const content = fs.readFileSync(file, 'utf-8')
  const lines = content.split(/\r?\n/)

  let lessonLineIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(new RegExp(`^##\\s+第${lesson}课`))) {
      lessonLineIdx = i
      break
    }
  }
  if (lessonLineIdx < 0) {
    console.log(`  lesson not found`)
    continue
  }

  let entryLineIdx = -1
  for (let i = lessonLineIdx + 1; i < lines.length; i++) {
    if (lines[i].match(/^##\s+第\d+课/)) break
    const em = lines[i].match(new RegExp(`^###\\s+${num}\\.\\s+`))
    if (em) {
      entryLineIdx = i
      break
    }
  }
  if (entryLineIdx < 0) {
    console.log(`  entry #${num} not found`)
    continue
  }
  console.log(`  entry at L${entryLineIdx + 1}`)

  let subLineIdx = -1
  for (let i = entryLineIdx + 1; i < lines.length; i++) {
    if (lines[i].match(/^###\s+\d+\.\s+/)) break
    if (lines[i].match(/^##\s+第\d+课/)) break
    const sm = lines[i].match(/^\*\*([AB])\.\s*给汉字选假名/)
    if (sm && sm[1] === subLetter) {
      subLineIdx = i
      break
    }
  }
  if (subLineIdx < 0) {
    console.log(`  sub ${subLetter} not found`)
    continue
  }
  console.log(`  sub at L${subLineIdx + 1}`)

  const opts = []
  for (let i = subLineIdx + 1; i < lines.length; i++) {
    if (
      lines[i].match(/^\*\*[AB]\./) ||
      lines[i].match(/^###\s+\d+\.\s+/) ||
      lines[i].match(/^---/)
    )
      break
    const om = lines[i].match(/^-\s+([A-D])[\.、\s]+(.+?)(\s*✅)?\s*$/)
    if (om) {
      let body = om[2].replace(/【.+?】/, '').trim()
      opts.push({ key: om[1], text: body, correct: !!om[3], lineIdx: i })
    }
  }

  const existingSet = new Set(opts.map((o) => o.text))
  let modified = false
  if (process.env.DEBUG && fix.qid === 'w26-002-b') {
    console.log(`DEBUG ${fix.qid}: lesson=${lesson} num=${num} sub=${subLetter}`)
    console.log(`  file=${file}, entryLineIdx=${entryLineIdx}, subLineIdx=${subLineIdx}`)
    console.log(`  opts:`, opts)
    console.log(`  validAlts:`, fix.validAlts)
  }
  for (const va of fix.validAlts) {
    const optIdx = opts.findIndex((o) => o.key === va.key)
    if (optIdx < 0) continue
    const original = opts[optIdx].text
    existingSet.delete(original)
    const alt = generateKanaAlt(original, existingSet)
    existingSet.add(alt)

    const newAnno = `【無对应标准汉字（読み間違い）】`
    lines[opts[optIdx].lineIdx] = `- ${va.key}. ${alt} ${newAnno}`

    totalFixed++
    report.push({
      file: file.split('/').pop(),
      line: opts[optIdx].lineIdx + 1,
      qid: fix.qid,
      from: original,
      to: alt,
      refKanji: va.refKanji,
    })
    modified = true
  }

  if (modified) fs.writeFileSync(file, lines.join('\n'), 'utf-8')
}

console.log(`\n共修复: ${totalFixed}`)
for (const r of report) {
  console.log(`  ${r.file} L${r.line} [${r.qid}]: ${r.from} -> ${r.to}  (原ref: ${r.refKanji})`)
}
