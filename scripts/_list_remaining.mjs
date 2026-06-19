import fs from 'fs'
const report = JSON.parse(fs.readFileSync('data/processed/word-validation-report.json', 'utf-8'))
const aSkips = report.skipped.filter((s) => s.reason.startsWith('A '))

const fileMap = {
  '日语汉字单词选择题-第26-28课.md': 'data/raw/日语汉字单词选择题-第26-28课.md',
  '日语汉字单词选择题-第28-31课.md': 'data/raw/日语汉字单词选择题-第28-31课.md',
  '日语汉字单词选择题-第32-36课.md': 'data/raw/日语汉字单词选择题-第32-36课.md',
}

const heads = []
for (const s of aSkips) {
  const f = fileMap[s.file]
  const content = fs.readFileSync(f, 'utf-8')
  const lines = content.split(/\r?\n/)
  const pattern = new RegExp('^###\\s+' + s.num + '\\.\\s+(.+)$')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pattern)
    if (m) {
      const head = m[1].split(/[（(]/)[0].split(/—/)[0].trim()
      const kanjiOnly = [...head].filter((c) => /[一-鿿]/.test(c))
      heads.push({ lesson: s.lesson, num: s.num, head, kanji: kanjiOnly.join('') })
      break
    }
  }
}

console.log(`剩余 ${heads.length} 条未解决：`)
for (const h of heads) {
  console.log(`  L${h.lesson} #${h.num}: ${h.head} (汉字: ${h.kanji})`)
}

const allKanji = new Set()
for (const h of heads) for (const c of h.kanji) allKanji.add(c)
console.log(`\n涉及 ${allKanji.size} 个汉字: ${[...allKanji].sort().join('')}`)
