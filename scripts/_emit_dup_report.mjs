// 把所有题库的"同文件内重复"清单导出为 JSON，便于后续自动去重
import fs from 'fs'

const BANKS = [
  {
    json: 'public/party-question-bank.json',
    files: [
      {
        file: '党史题库_按优先级整理.md',
        groups: ['party-p1', 'party-p2', 'party-p3', 'party-p4'],
      },
      { file: '党史题库_完整版.md', groups: ['party-single', 'party-multi', 'party-judge'] },
    ],
  },
  {
    json: 'public/military-question-bank.json',
    files: [
      {
        file: '军理题库_按优先级整理.md',
        groups: ['military-p1', 'military-p2', 'military-p3', 'military-p4'],
      },
      {
        file: '军理题库_整理版.md',
        groups: [
          'military-ch1',
          'military-ch2',
          'military-ch3',
          'military-ch4',
          'military-ch5',
          'military-ch6',
          'military-ch7',
          'military-ch8',
          'military-ch9',
          'military-ch10',
          'military-ch11',
          'military-ch12',
          'military-ch13',
          'military-ch14',
          'military-ch15',
          'military-ch16',
          'military-ch17',
          'military-ch18',
        ],
      },
    ],
  },
  {
    json: 'public/history-question-bank.json',
    files: [
      { file: '刷题单1-核心必刷T0.md', groups: ['t0'] },
      { file: '刷题单2-重点掌握T1.md', groups: ['t1'] },
      { file: '刷题单3-常规巩固T2.md', groups: ['t2'] },
      { file: '刷题单4-查漏补缺T3.md', groups: ['t3'] },
      { file: '刷题单5-机考模拟.md', groups: ['t5-1', 't5-2', 't5-3', 't5-4'] },
      { file: '1-大工题库.md', groups: ['hist-a'] },
      { file: '4-近代史习题集.md', groups: ['hist-b'] },
      { file: '2-纲要分章题库.md', groups: ['hist-c'] },
    ],
  },
]

const norm = (s) =>
  (s || '')
    .replace(/\s+/g, '')
    .replace(/[，。、；：！？""''（）()【】《》、,.;:!?'"[\]<>]/g, '')
    .toLowerCase()

const report = {}

for (const bank of BANKS) {
  const questions = JSON.parse(fs.readFileSync(bank.json, 'utf-8'))
  report[bank.json] = { files: {} }

  for (const fdef of bank.files) {
    const qs = questions.filter((q) => fdef.groups.includes(q.groupId))
    const byStem = new Map()
    for (const q of qs) {
      const k = norm(q.stem)
      if (!k) continue
      if (!byStem.has(k)) byStem.set(k, [])
      byStem.get(k).push(q)
    }
    const dups = [...byStem.values()].filter((g) => g.length > 1)
    const extra = dups.reduce((s, g) => s + g.length - 1, 0)

    report[bank.json].files[fdef.file] = {
      total: qs.length,
      unique: byStem.size,
      extraCopies: extra,
      clusterCount: dups.length,
      clusters: dups.map((g) => {
        const first = g[0]
        const sameAns = g.every(
          (q) => norm(q.answerText || q.answerKey) === norm(first.answerText || first.answerKey),
        )
        return {
          stem: first.stem,
          answer: first.answerText || first.answerKey,
          sameAnswer: sameAns,
          count: g.length,
          subGroups: [...new Set(g.map((q) => q.groupId))],
          ids: g.map((q) => q.id),
        }
      }),
    }
  }
}

fs.writeFileSync(
  'data/processed/within-file-duplicates.json',
  JSON.stringify(report, null, 2),
  'utf-8',
)

// 汇总打印
console.log('\n📊 同文件内重复汇总 (data/processed/within-file-duplicates.json)')
console.log('═'.repeat(70))
for (const [bank, data] of Object.entries(report)) {
  console.log(`\n${bank}`)
  for (const [file, info] of Object.entries(data.files)) {
    const pct = ((info.extraCopies / info.total) * 100).toFixed(1)
    console.log(
      `  ${file}: ${info.total}题 → 唯一${info.unique}, 净重复${info.extraCopies} (${pct}%), cluster ${info.clusterCount}`,
    )
  }
}
