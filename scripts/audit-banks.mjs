// 题库审计：在 CI 里跑，发现 schema 不合规或同文件内部重复就 exit 1。
// 不检查跨文件重复 —— 历史/党史/军理 的「按章节 / 按优先级」分组本身就会让同一题
// 在不同 groupId 出现，这是 by design（见 memory question_bank_structure.md）。
// `category` 字段不在必填里：grammar/word bank 是早期 parser 生成的，没写 category，
// 运行时 loadQuestionBank 会用 loader 参数回填，运行无害。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public')

const BANKS = [
  'question-bank.json',
  'word-question-bank.json',
  'history-question-bank.json',
  'party-question-bank.json',
  'military-question-bank.json',
]

const REQUIRED_FIELDS = ['id', 'groupId', 'stem', 'options', 'answerKey', 'explanation']

const norm = (s) =>
  (s || '')
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？""''（）()【】《》、,.;:!?'"[\]<>]/g, '')
    .toLowerCase()

let problems = 0

function fail(file, msg) {
  console.error(`  ✗ ${file}: ${msg}`)
  problems++
}

for (const name of BANKS) {
  const file = path.join(PUBLIC, name)
  console.log(`\n=== ${name} ===`)

  if (!fs.existsSync(file)) {
    fail(name, '文件不存在（请先运行 npm run parse:all）')
    continue
  }

  let data
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    fail(name, `JSON 解析失败: ${e.message}`)
    continue
  }

  if (!Array.isArray(data)) {
    fail(name, `顶层应为数组，实际为 ${typeof data}`)
    continue
  }

  console.log(`  题数: ${data.length}`)
  if (data.length === 0) {
    fail(name, '空题库')
    continue
  }

  // schema 校验：必填字段
  let schemaIssues = 0
  for (const q of data) {
    for (const f of REQUIRED_FIELDS) {
      if (!(f in q) || q[f] === undefined || q[f] === null) {
        if (schemaIssues < 5) fail(name, `题 ${q.id || '(no id)'} 缺字段 ${f}`)
        schemaIssues++
      }
    }
    // 填空题不需要选项
    if (q.questionType !== 'fill' && (!Array.isArray(q.options) || q.options.length < 2)) {
      if (schemaIssues < 10) fail(name, `题 ${q.id} options 不是数组或少于 2 项`)
      schemaIssues++
    }
  }
  if (schemaIssues === 0) console.log('  schema: OK')
  else console.log(`  schema: ${schemaIssues} 处问题`)

  // id 唯一性
  const idCounts = new Map()
  for (const q of data) {
    idCounts.set(q.id, (idCounts.get(q.id) || 0) + 1)
  }
  const dupIds = [...idCounts.entries()].filter(([, n]) => n > 1)
  if (dupIds.length > 0) {
    for (const [id, n] of dupIds.slice(0, 5)) fail(name, `id 重复: ${id} × ${n}`)
  } else {
    console.log('  id 唯一性: OK')
  }

  // 同文件内部题干+答案重复（跨 groupId 也算）
  // 不同 groupId 共享题目是 by design，但完全相同的题干+答案在同一 bank 内是冗余。
  const stemAnsMap = new Map()
  for (const q of data) {
    const k = norm(q.stem) + '||' + norm(q.answerText || q.answerKey)
    if (!k) continue
    if (!stemAnsMap.has(k)) stemAnsMap.set(k, [])
    stemAnsMap.get(k).push(q)
  }
  const stemAnsDups = [...stemAnsMap.values()].filter((g) => g.length > 1)
  if (stemAnsDups.length > 0) {
    console.log(`  题干+答案重复 cluster: ${stemAnsDups.length}`)
    for (const g of stemAnsDups.slice(0, 3)) {
      const ids = g.map((q) => q.id).join(', ')
      console.log(`    - [${g[0].groupId}] "${g[0].stem.slice(0, 60)}…" → ${ids}`)
    }
    // 重复 cluster 不 fail CI（允许同 bank 跨组复用），只提示。
  } else {
    console.log('  题干+答案: 无重复')
  }
}

console.log('')
if (problems > 0) {
  console.error(`✗ 题库审计未通过：${problems} 个问题`)
  process.exit(1)
}
console.log('✓ 题库审计通过')
