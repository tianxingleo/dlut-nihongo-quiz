import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import { parseExamMarkdown, type RawQuestion } from './lib/parse-exam-markdown'

function tagQuestion(q: RawQuestion): { grammarPoints: string[]; tags: string[] } {
  const grammarPoints: string[] = []
  const tags: string[] = []
  const full = (q.stem + ' ' + q.explanation + ' ' + q.groupTitle).toLowerCase()

  const grammarMap: [string, RegExp][] = [
    ['ように', /ように/],
    ['ようにしている', /ようにしている/],
    ['ようにしてください', /ようにしてください/],
    ['ようになる', /ようになる/],
    ['ないで', /ないで/],
    ['とおりに/どおりに', /[とど]おりに/],
    ['た後で', /後で|あとで/],
    ['気が付く', /気が付[くき]/],
    ['命令形', /命令形/],
    ['禁止形', /禁止形|辞书形.*な/],
    ['てあります', /てあります/],
    ['なさい', /なさい/],
    ['ほうがいい', /ほうがいい/],
    ['かもしれません', /かもしれません/],
    ['こそあど', /[こそあど]んなに|[こそあど]の/],
    ['通う', /通[うい]/],
    ['実は', /実は/],
    ['〜し', /列举理由|〜し/],
    ['ながら', /ながら/],
    ['それで', /それで/],
    ['聞こえる', /聞こえ/],
    ['見られる', /見られる/],
    ['しか', /しか/],
    ['可能形', /可能形|可能动[词詞]/],
    ['自他动词', /自动词|他动词|自他/],
    ['てしまう', /てしまう|てしま[いっ]/],
    ['たしか', /たしか/],
    ['んです', /んです/],
    ['何も/何か', /何[もか]/],
    ['いただけませんか', /いただけませんか/],
    ['なかなか〜ない', /なかなか.*ない/],
    ['存在句', /存在句|に.*ある|に.*いる/],
    ['は对比', /对比|は.*は/],
    ['副词', /副词|たいてい|ちょうど|はっきり/],
    ['寒暄表达', /寒暄|それは大変|おかげさまで|お気をつけて/],
    ['とか', /とか/],
    ['しばらく', /しばらく/],
    ['まだ/もう', /まだ|もう.*ない/],
    ['〜中', /中.*正在/],
    ['放題', /放題|ほうだい/],
    ['ておく', /ておく|ておき/],
    ['受身', /被动|受身|受害/],
    ['てもらう', /てもら[うい]/],
    ['なら', /なら|建议.*なら/],
    ['たら', /たら|发现.*たら/],
    ['汉字读音', /读音|音读|训读|読み方/],
    ['汉字选择', /汉字.*选择|正确.*汉字|汉字.*正/],
    ['阅读理解', /文章|阅读|筆者|内容/],
    ['排序', /排序|★/],
    ['使役', /使役|させる|させ/],
  ]
  for (const [gp, re] of grammarMap) {
    if (re.test(full)) grammarPoints.push(gp)
  }

  const tagMap: [string, RegExp][] = [
    ['ように', /ように/],
    ['ない形', /ない形|否定形/],
    ['目的表达', /为了|为了不/],
    ['可能形', /可能形|可能动[词辭]/],
    ['ようになる', /ようになる/],
    ['とか', /とか/],
    ['どおりに', /[とど]おりに/],
    ['に', /助词.*に|に.*固定|に.*搭配/],
    ['を', /助词.*を|を.*表示/],
    ['が', /助词.*が|が.*主语/],
    ['で', /助词.*で|で.*表示/],
    ['と', /助词.*と|と.*引用/],
    ['命令形', /命令形/],
    ['禁止形', /禁止形/],
    ['てあります', /てあります/],
    ['他动词', /他动词/],
    ['自动词', /自动词/],
    ['ている', /ている|状態/],
    ['ほうがいい', /ほうがいい/],
    ['かもしれません', /かもしれません/],
    ['こそあど', /こそあど|[こそあど]んなに/],
    ['固定搭配', /固定搭配|固定常用|固定/],
    ['场景表达', /场景|寒暄/],
    ['副词', /副词/],
    ['数量+しか', /しか/],
    ['对比', /对比/],
    ['んです', /んです/],
    ['なかなか', /なかなか/],
    ['てしまう', /てしまう/],
    ['存在句', /存在/],
    ['尊敬语', /敬語|礼貌|いただけ/],
    ['汉字', /汉字|漢字|读音|仮名/],
    ['阅读', /文章|阅读|筆者/],
    ['排序', /排序|★/],
    ['easy', /基本|简单/],
    ['medium', /注意|需要|中等/],
    ['hard', /难|易错|重要|关键/],
  ]
  for (const [t, re] of tagMap) {
    if (re.test(full)) tags.push(t)
  }

  return { grammarPoints: [...new Set(grammarPoints)], tags: [...new Set(tags)] }
}

const GROUP_OFFSET = 20

function main() {
  const rawPath = path.resolve(__dirname, '../data/raw/japanese/2024年日语期末试卷.md')
  const existingBankPath = path.resolve(__dirname, '../public/question-bank.json')

  // Parse 2024 exam
  const rawQuestions = parseExamMarkdown(fs.readFileSync(rawPath, 'utf-8'))

  // Offset groupIds to avoid collision with 学习通 groups (g01-g10): g01→g21, g02→g22, ...
  const enriched = rawQuestions.map((q, i) => {
    const { grammarPoints, tags } = tagQuestion(q)
    const groupNum = parseInt(q.groupId.substring(1))
    const newGroupId = `g${String(groupNum + GROUP_OFFSET).padStart(2, '0')}`
    return {
      id: `${newGroupId}-q${String(q.numberInGroup).padStart(2, '0')}`,
      groupId: newGroupId,
      groupTitle: `2024 · ${q.groupTitle}`,
      numberInGroup: q.numberInGroup,
      stem: q.stem,
      options: q.options,
      answerKey: q.answerKey,
      answerText: q.answerText,
      translation: q.translation,
      explanation: q.explanation,
      grammarPoints,
      tags,
      source: {
        file: '2024年日语期末试卷.md',
        group: q.groupTitle,
        position: i + 1,
      },
      status: 'ready' as const,
    }
  })

  // Read existing question bank
  let existing: any[] = []
  if (fs.existsSync(existingBankPath)) {
    existing = JSON.parse(fs.readFileSync(existingBankPath, 'utf-8'))
  }

  // Remove old 2024 entries before merging (idempotent re-run)
  const merged = [...existing.filter((q: any) => !q.groupId.startsWith('g2')), ...enriched]

  const report: string[] = []
  report.push(`原有题库: ${existing.length} 题`)
  report.push(`2024新增: ${enriched.length} 题`)
  report.push(`合并后: ${merged.length} 题`)

  const ids = merged.map((q: any) => q.id)
  const dupIds = ids.filter((id: string, i: number) => ids.indexOf(id) !== i)
  if (dupIds.length) report.push(`⚠ 重复ID: ${dupIds.join(', ')}`)

  const groups: Record<string, number[]> = {}
  for (const q of merged) {
    if (!groups[q.groupId]) groups[q.groupId] = []
    groups[q.groupId].push(q.numberInGroup)
  }
  for (const [gid, nums] of Object.entries(groups)) {
    const sorted = [...nums].sort((a, b) => a - b)
    report.push(`  ${gid}: ${sorted.length}题`)
  }

  report.push('✅ 合并完成')

  fs.writeFileSync(existingBankPath, JSON.stringify(merged, null, 2), 'utf-8')
  fs.writeFileSync(
    path.resolve(__dirname, '../data/processed/japanese-2024-validation-report.json'),
    JSON.stringify(
      {
        report,
        count: enriched.length,
        merged: merged.length,
      },
      null,
      2,
    ),
    'utf-8',
  )

  console.log(report.join('\n'))
  console.log(`\n写入: ${existingBankPath} (${merged.length} 题)`)
}

main()
