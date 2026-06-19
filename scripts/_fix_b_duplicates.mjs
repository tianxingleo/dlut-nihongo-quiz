import fs from 'fs'

const files = [
  'data/raw/日语汉字单词选择题-第26-28课.md',
  'data/raw/日语汉字单词选择题-第28-31课.md',
  'data/raw/日语汉字单词选择题-第32-36课.md',
]

// 改进策略：按优先级生成自然的干扰假名
// 优先考虑学生常见的读音错误

// 浊音/半浊音
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

// 辅音替换（常见学生误读：k↔t, k↔s, k↔h, t↔s）
const consShift = {
  か: 'た',
  き: 'ち',
  く: 'つ',
  け: 'て',
  こ: 'と', // k→t
  た: 'さ',
  ち: 'し',
  つ: 'す',
  て: 'せ',
  と: 'そ', // t→s
  さ: 'は',
  し: 'ひ',
  す: 'ふ',
  せ: 'へ',
  そ: 'ほ', // s→h
  は: 'か',
  ひ: 'き',
  ふ: 'く',
  へ: 'け',
  ほ: 'こ', // h→k
  ま: 'な',
  み: 'に',
  む: 'ぬ',
  め: 'ね',
  も: 'の', // m→n
  な: 'ら',
  に: 'り',
  ぬ: 'る',
  ね: 'れ',
  の: 'ろ', // n→r
  ら: 'や',
  り: 'ゆ',
  る: 'よ', // r→y (limited)
}

// 母音替换（仅末尾，避免中间产生怪异组合）
const vowelShift = { あ: 'え', い: 'あ', う: 'い', え: 'い', お: 'う' }

function uniq(arr) {
  return [...new Set(arr)]
}

function generateKanaAlt(original, existingSet) {
  const candidates = []

  // === 策略1：动词 ます 结尾变形 ===
  if (original.endsWith('します')) {
    const stem = original.slice(0, -3)
    candidates.push(stem + 'する') // 連絡します → 連絡する
    candidates.push(stem + 'しまする') // 错误连用
    candidates.push(stem + 'すます') // 错位
  } else if (original.endsWith('ます')) {
    const stem = original.slice(0, -2)
    candidates.push(stem + 'る') // 食べます → 食べる
    candidates.push(stem + 'ました') // 过去形混入
    candidates.push(stem + 'ませ') // 不完整
  }

  // === 策略2：浊音化（首字符） ===
  if (original.length > 0) {
    const first = original[0]
    if (dakuten[first]) candidates.push(dakuten[first] + original.slice(1))
    if (devoice[first]) candidates.push(devoice[first] + original.slice(1))
  }

  // === 策略3：辅音替换（首字符） ===
  if (original.length > 0 && consShift[original[0]]) {
    candidates.push(consShift[original[0]] + original.slice(1))
  }

  // === 策略4：第二字符浊音化 ===
  if (original.length >= 2) {
    const second = original[1]
    if (dakuten[second]) candidates.push(original[0] + dakuten[second] + original.slice(2))
    if (devoice[second]) candidates.push(original[0] + devoice[second] + original.slice(2))
  }

  // === 策略5：末尾母音替换 ===
  if (original.length > 0) {
    const last = original[original.length - 1]
    if (vowelShift[last]) candidates.push(original.slice(0, -1) + vowelShift[last])
  }

  // === 策略6：删除/替换 っ ===
  if (original.includes('っ')) {
    candidates.push(original.replace('っ', '')) // 删 っ
    candidates.push(original.replace('っ', 'つ')) // っ→つ
  } else if (original.length >= 3) {
    // 在第二个字符后插入 っ
    candidates.push(original.slice(0, 2) + 'っ' + original.slice(2))
  }

  // === 策略7：末尾长音化（仅当不以 う/い/お 结尾） ===
  const lastChar = original[original.length - 1]
  if (!'ういお'.includes(lastChar) && !original.endsWith('ん')) {
    candidates.push(original + 'う')
  }

  // === 策略8：末尾加 ん（仅当不以 ん 结尾） ===
  if (!original.endsWith('ん') && original.length <= 5) {
    candidates.push(original + 'ん')
  }

  // === 策略9：删末尾字符（如 はしります→はしります→はしりま） ===
  if (original.length >= 4) {
    candidates.push(original.slice(0, -1))
  }

  // === 策略10：拗音化（如 し→しゃ） ===
  // 略 - 复杂度高

  // 选第一个不冲突且不同的
  for (const c of candidates) {
    if (c !== original && !existingSet.has(c) && c.length >= 2) return c
  }

  return original + 'ー' // 兜底
}

let totalFixed = 0
const report = []
for (const f of files) {
  const content = fs.readFileSync(f, 'utf-8')
  const lines = content.split(/\r?\n/)
  let mode = null,
    currentOpts = []

  function flush() {
    if (mode !== 'B' || currentOpts.length === 0) {
      currentOpts = []
      return
    }
    const texts = currentOpts.map((o) => o.text)
    const seen = {}
    let dupIdxs = []
    for (let i = 0; i < texts.length; i++) {
      if (seen[texts[i]] !== undefined) dupIdxs.push(i)
      else seen[texts[i]] = i
    }
    if (dupIdxs.length === 0) {
      currentOpts = []
      return
    }

    for (const dupIdx of dupIdxs) {
      const dup = currentOpts[dupIdx]
      const original = dup.text
      const existing = new Set(currentOpts.map((o) => o.text))
      const alt = generateKanaAlt(original, existing)

      // 更新数据结构
      currentOpts[dupIdx].text = alt

      // 修改 markdown
      const origLine = lines[dup.lineIdx]
      const annoMatch = origLine.match(/【.+?】/)
      const anno = annoMatch ? annoMatch[0] : `【無对应标准汉字】`
      const correctMark = dup.correct ? ' ✅' : ''
      lines[dup.lineIdx] = `- ${dup.key}. ${alt}${correctMark} ${anno}`
      totalFixed++
      report.push({ file: f.split('/').pop(), line: dup.lineIdx + 1, from: original, to: alt })
    }
    currentOpts = []
  }

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t.match(/^##\s+第\d+课/)) {
      flush()
      mode = null
      continue
    }
    if (t.match(/^###\s+\d+\.\s+/)) {
      flush()
      mode = null
      continue
    }
    if (t.match(/^\*\*[AB]\.\s*给假名选汉字/)) {
      flush()
      mode = 'A'
      continue
    }
    if (t.match(/^\*\*[AB]\.\s*给汉字选假名/)) {
      flush()
      mode = 'B'
      continue
    }
    const om = t.match(/^-\s+([A-D])[\.、\s]+(.+?)(\s*✅)?\s*$/)
    if (om && (mode === 'A' || mode === 'B')) {
      let body = om[2].replace(/【.+?】/, '').trim()
      currentOpts.push({ key: om[1], text: body, correct: !!om[3], lineIdx: i })
      continue
    }
  }
  flush()
  fs.writeFileSync(f, lines.join('\n'), 'utf-8')
}

console.log(`B 子题共修复: ${totalFixed}\n`)
for (const r of report) {
  console.log(`  ${r.file} L${r.line}: ${r.from} → ${r.to}`)
}
