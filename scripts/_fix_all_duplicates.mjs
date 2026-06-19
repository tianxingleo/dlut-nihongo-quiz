// 主修复脚本：依次执行所有修复步骤
// 1. 重置 markdown 到 HEAD
// 2. 重新应用 annotations
// 3. 修复 A 子题重复汉字
// 4. 修复 B 子题重复假名
// 5. 修复多音字歧义（先重新生成 JSON）
// 6. 修复 開imes 重复
// 7. 最终重新生成 JSON
import { execSync } from 'child_process'
import fs from 'fs'

const RAW_FILES = [
  'data/raw/日语汉字单词选择题-第26-28课.md',
  'data/raw/日语汉字单词选择题-第28-31课.md',
  'data/raw/日语汉字单词选择题-第32-36课.md',
]

console.log('=== 步骤 1: 重置 markdown ===')
execSync(
  'git checkout -- data/raw/日语汉字单词选择题-第26-28课.md data/raw/日语汉字单词选择题-第28-31课.md data/raw/日语汉字单词选择题-第32-36课.md',
  { stdio: 'inherit' },
)

console.log('\n=== 步骤 2: 应用 annotations ===')
execSync('npx tsx scripts/_apply_annotations.ts', { stdio: 'inherit' })

console.log('\n=== 步骤 3: 修复 A 子题重复汉字 ===')
execSync('node scripts/_fix_a_duplicates.mjs', { stdio: 'inherit' })

console.log('\n=== 步骤 4: 修复 B 子题重复假名 ===')
execSync('node scripts/_fix_b_duplicates.mjs', { stdio: 'inherit' })

console.log('\n=== 步骤 5: 重新生成 JSON 用于多音字检测 ===')
execSync('npx tsx scripts/parse-word-markdown.ts', { stdio: 'inherit' })

console.log('\n=== 步骤 6: 修复多音字歧义 ===')
execSync('node scripts/_fix_multireading.mjs', { stdio: 'inherit' })

console.log('\n=== 步骤 7: 修复 開imes 重复（修改 #99 → 開けます） ===')
// 改 #99 from 開きます to 開けます
const file = RAW_FILES[0]
const content = fs.readFileSync(file, 'utf-8')
const lines = content.split(/\r?\n/)
// 找到 #99
let entry99Start = -1
for (let i = 0; i < lines.length; i++) {
  if (lines[i].match(/^###\s+99\.\s+/)) {
    entry99Start = i
    break
  }
}
if (entry99Start >= 0) {
  // 找到下一个 --- 或下一个 ###
  let entry99End = lines.length
  for (let i = entry99Start + 1; i < lines.length; i++) {
    if (lines[i].match(/^###\s+\d+\.\s+/) || lines[i].match(/^---/)) {
      entry99End = i
      break
    }
  }
  // 替换 #99 整段
  const newEntry99 = [
    '### 99. 開けます（あけます）— 打开（他动词）',
    '',
    '**A. 给假名选汉字：あけます**',
    '- A. 開けます【あ.ける】 ✅',
    '- B. 開けます【あ.ける】',
    '- C. 閉けます【と.じる／し.める（非標準搭配）】',
    '- D. 関けます【非标准（関=かん）】',
    '',
    '**B. 给汉字选假名：開けます**',
    '- A. あけます【開.けます】 ✅',
    '- B. あきります【非标准变形】',
    '- C. あげます【上.げます（上げる）】',
    '- D. あけまする【非标准变形】',
    '',
  ]
  lines.splice(entry99Start, entry99End - entry99Start, ...newEntry99)
  fs.writeFileSync(file, lines.join('\n'), 'utf-8')
  console.log(`  ✓ #99 已替换为 開けます`)
} else {
  console.log(`  ⚠ 没找到 #99`)
}

// A 子题的 #99 仍然有 4 个相同选项，再跑一次 A fix
console.log('\n=== 步骤 8: 再次修复 A 子题（处理 #99 等） ===')
execSync('node scripts/_fix_a_duplicates.mjs', { stdio: 'inherit' })

console.log('\n=== 步骤 9: 最终重新生成 JSON ===')
execSync('npx tsx scripts/parse-word-markdown.ts', { stdio: 'inherit' })

console.log('\n✅ 全部完成')
