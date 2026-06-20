// Add 2021 exam questions to question-bank.json as group g11
const fs = require('fs')
const path = require('path')

const bankPath = path.join(__dirname, '..', 'public', 'question-bank.json')
const existing = JSON.parse(fs.readFileSync(bankPath, 'utf-8'))

// 阅读理解 Q78-Q80 share the same 花屋 (flower shop) passage. Embed it in
// every stem so each question can stand alone on the quiz page.
const HANAYA_ARTICLE = [
  '最近、近所の花屋が閉店した。30年以上も「町の花屋さん」として愛着されてきた店だ。',
  'この店がオープンしたのは、わたしがまだ小学校に入る前だった。わたしにとって、①店の思い出はそのまま子どものころの思い出と重なる。家族の誕生日や家にお客さんが来る時などには、母と一緒にこの店で花を買っていた。',
  '小学校を卒業する時には、こんなことがあった。クラス全員でお金を出し合い、担任の先生に花束をおくることになった。「お礼の気持ちを表すために、見たことのないほど大きいのをおくろう」とわたしたちは話し合った。しかし、小学生のおこづかいの中集まったお金は少しだけだった。それで、②わたしたちはどきどきしながら、「大好きな先生にあげるから、できるだけ大きい花束を作ってください」とお願いした。おじさんは嫌な顔もしないで、特別大きなバラの花束を作ってくれた。',
  '30年以上もきれいな花束を作り続け、あたたかい思い出を作ってくれたおじさんに、「ありがとう、お疲れ様でした。」と言いたい。',
].join('\n\n')

const newQuestions = [
  // ===== Q1-10: 汉字读音选择 =====
  {
    id: 'g11-q01', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 1,
    stem: 'それは**頼まれた**書類です。',
    options: [
      { key: 'A', text: 'つつまれ' }, { key: 'B', text: 'たのまれ' },
      { key: 'C', text: 'たまれ' }, { key: 'D', text: 'うまれ' }
    ],
    answerKey: 'B', answerText: 'たのまれ',
    translation: '那是被拜托处理的文件。',
    explanation: '「頼む」读作「たのむ」，被动态是「頼まれる」，过去形「頼まれた」。',
    grammarPoints: ['被动形'], tags: ['读音', '被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 1 }, status: 'ready'
  },
  {
    id: 'g11-q02', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 2,
    stem: '知らない人に財布を**拾って**もらいました。',
    options: [
      { key: 'A', text: 'ちがって' }, { key: 'B', text: 'すてって' },
      { key: 'C', text: 'ひろって' }, { key: 'D', text: 'ひらって' }
    ],
    answerKey: 'C', answerText: 'ひろって',
    translation: '请不认识的人帮我捡了钱包。',
    explanation: '「拾う」读作「ひろう」，て形是「拾って／ひろって」。',
    grammarPoints: ['て形'], tags: ['读音', 'て形', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 2 }, status: 'ready'
  },
  {
    id: 'g11-q03', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 3,
    stem: '庭に花を**植える**。',
    options: [
      { key: 'A', text: 'もえる' }, { key: 'B', text: 'かえる' },
      { key: 'C', text: 'うえる' }, { key: 'D', text: 'はえる' }
    ],
    answerKey: 'C', answerText: 'うえる',
    translation: '在院子里种花。',
    explanation: '「植える」读作「うえる」，意思是"种植"。「生える／はえる」是"长出来"。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 3 }, status: 'ready'
  },
  {
    id: 'g11-q04', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 4,
    stem: '来月、うちの大学で国際会議を**行う**。',
    options: [
      { key: 'A', text: 'もよう' }, { key: 'B', text: 'おこなう' },
      { key: 'C', text: 'いこう' }, { key: 'D', text: 'いきなう' }
    ],
    answerKey: 'B', answerText: 'おこなう',
    translation: '下个月，我们大学将举行国际会议。',
    explanation: '「行う」读作「おこなう」，意思是"举行、进行"。「行く」才读作「いく」。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 4 }, status: 'ready'
  },
  {
    id: 'g11-q05', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 5,
    stem: '子供に服を**汚された**。',
    options: [
      { key: 'A', text: 'よごされ' }, { key: 'B', text: 'つぶされ' },
      { key: 'C', text: 'こわされ' }, { key: 'D', text: 'よこされ' }
    ],
    answerKey: 'A', answerText: 'よごされ',
    translation: '衣服被孩子弄脏了。',
    explanation: '「汚す」读作「よごす」，被动态「汚される」，过去形「汚された」。',
    grammarPoints: ['被动形'], tags: ['读音', '被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 5 }, status: 'ready'
  },
  {
    id: 'g11-q06', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 6,
    stem: '初めて地震を**経験**しましたから、慌てました。',
    options: [
      { key: 'A', text: 'かいけん' }, { key: 'B', text: 'けいけん' },
      { key: 'C', text: 'がいけん' }, { key: 'D', text: 'たいけん' }
    ],
    answerKey: 'B', answerText: 'けいけん',
    translation: '因为第一次经历地震，所以慌了。',
    explanation: '「経験」读作「けいけん」，意思是"经验、经历"。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 6 }, status: 'ready'
  },
  {
    id: 'g11-q07', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 7,
    stem: '書き方について**注意**された。',
    options: [
      { key: 'A', text: 'じゅい' }, { key: 'B', text: 'ちゅうい' },
      { key: 'C', text: 'ちゅい' }, { key: 'D', text: 'しゅい' }
    ],
    answerKey: 'B', answerText: 'ちゅうい',
    translation: '被提醒了写法。',
    explanation: '「注意」读作「ちゅうい」，意思是"注意、提醒、警告"。「注意された」表示"被提醒"。',
    grammarPoints: ['被动形'], tags: ['读音', '被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 7 }, status: 'ready'
  },
  {
    id: 'g11-q08', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 8,
    stem: '先生に**褒められて**、うれしいです。',
    options: [
      { key: 'A', text: 'ほうめられ' }, { key: 'B', text: 'うめられ' },
      { key: 'C', text: 'ほめられ' }, { key: 'D', text: 'しめられ' }
    ],
    answerKey: 'C', answerText: 'ほめられ',
    translation: '被老师表扬了，很高兴。',
    explanation: '「褒める」读作「ほめる」，被动态「褒められる」。',
    grammarPoints: ['被动形'], tags: ['读音', '被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 8 }, status: 'ready'
  },
  {
    id: 'g11-q09', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 9,
    stem: '子供の時、よく父に**叱られました**。',
    options: [
      { key: 'A', text: 'かえられ' }, { key: 'B', text: 'ちかられ' },
      { key: 'C', text: 'しられ' }, { key: 'D', text: 'しかられ' }
    ],
    answerKey: 'D', answerText: 'しかられ',
    translation: '小时候经常被父亲骂。',
    explanation: '「叱る」读作「しかる」，被动态「叱られる」。',
    grammarPoints: ['被动形'], tags: ['读音', '被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 9 }, status: 'ready'
  },
  {
    id: 'g11-q10', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 10,
    stem: '友達に**誘われた**。',
    options: [
      { key: 'A', text: 'さそわれ' }, { key: 'B', text: 'てつだわれ' },
      { key: 'C', text: 'いわれ' }, { key: 'D', text: 'ゆうわれ' }
    ],
    answerKey: 'A', answerText: 'さそわれ',
    translation: '被朋友邀请了。',
    explanation: '「誘う」读作「さそう」，被动态「誘われる」。',
    grammarPoints: ['被动形'], tags: ['读音', '被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 10 }, status: 'ready'
  },
  // ===== Q11-15: 汉字读音选择 =====
  {
    id: 'g11-q11', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 11,
    stem: 'もう日本の生活に**慣れました**。',
    options: [
      { key: 'A', text: 'はなれ' }, { key: 'B', text: 'かれ' },
      { key: 'C', text: 'はれ' }, { key: 'D', text: 'なれ' }
    ],
    answerKey: 'D', answerText: 'なれ',
    translation: '已经习惯日本的生活了。',
    explanation: '「慣れる」读作「なれる」，意思是"习惯"。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 11 }, status: 'ready'
  },
  {
    id: 'g11-q12', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 12,
    stem: '食べ物が**腐りました**。',
    options: [
      { key: 'A', text: 'かり' }, { key: 'B', text: 'ふさがり' },
      { key: 'C', text: 'はかり' }, { key: 'D', text: 'くさり' }
    ],
    answerKey: 'D', answerText: 'くさり',
    translation: '食物坏了。',
    explanation: '「腐る」读作「くさる」，意思是"腐烂、变坏"。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 12 }, status: 'ready'
  },
  {
    id: 'g11-q13', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 13,
    stem: 'ハンカチで涙を**拭いた**。',
    options: [
      { key: 'A', text: 'しいた' }, { key: 'B', text: 'ぬいた' },
      { key: 'C', text: 'ふいた' }, { key: 'D', text: 'かいた' }
    ],
    answerKey: 'C', answerText: 'ふいた',
    translation: '用手帕擦了眼泪。',
    explanation: '「拭く」读作「ふく」，过去形「拭いた／ふいた」。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 13 }, status: 'ready'
  },
  {
    id: 'g11-q14', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 14,
    stem: '毎月2万円**貯金**しています。',
    options: [
      { key: 'A', text: 'ちょぎん' }, { key: 'B', text: 'ちょきん' },
      { key: 'C', text: 'ちょうきん' }, { key: 'D', text: 'ちゅうぎん' }
    ],
    answerKey: 'B', answerText: 'ちょきん',
    translation: '每个月存两万日元。',
    explanation: '「貯金」读作「ちょきん」，意思是"存钱"。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 14 }, status: 'ready'
  },
  {
    id: 'g11-q15', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 15,
    stem: '**珍しい**物を発見しました。',
    options: [
      { key: 'A', text: 'めずらしい' }, { key: 'B', text: 'はずかしい' },
      { key: 'C', text: 'たのしい' }, { key: 'D', text: 'おしい' }
    ],
    answerKey: 'A', answerText: 'めずらしい',
    translation: '发现了罕见的东西。',
    explanation: '「珍しい」读作「めずらしい」，意思是"稀奇的、罕见的"。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 15 }, status: 'ready'
  },
  // ===== Q16-19: 假名→汉字选择 =====
  {
    id: 'g11-q16', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 16,
    stem: '**きょか**をもらえば、寮でパーティーができます。',
    options: [
      { key: 'A', text: '教科' }, { key: 'B', text: '許可' },
      { key: 'C', text: '巨額' }, { key: 'D', text: '拒否' }
    ],
    answerKey: 'B', answerText: '許可',
    translation: '如果得到许可，就可以在宿舍开派对。',
    explanation: '「きょか」写作「許可」，意思是"许可、批准"。「教科／きょうか」是"课程"，「巨額／きょがく」是"巨额"，「拒否／きょひ」是"拒绝"。',
    grammarPoints: [], tags: ['假名→汉字', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 16 }, status: 'ready'
  },
  {
    id: 'g11-q17', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 17,
    stem: '来週、新製品の**はっぴょう**会があるので、ぜひ来てください。',
    options: [
      { key: 'A', text: '発送' }, { key: 'B', text: '発表' },
      { key: 'C', text: '発行' }, { key: 'D', text: '発見' }
    ],
    answerKey: 'B', answerText: '発表',
    translation: '下周有新产品发布会，请一定来。',
    explanation: '「発表会」读作「はっぴょうかい」，意思是"发布会"。「発送／はっそう」是"发送"，「発行／はっこう」是"发行"，「発見／はっけん」是"发现"。',
    grammarPoints: [], tags: ['假名→汉字', '促音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 17 }, status: 'ready'
  },
  {
    id: 'g11-q18', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 18,
    stem: 'あそこに**おおぜい**の人が集まっていますね。',
    options: [
      { key: 'A', text: '大変' }, { key: 'B', text: '大勢' },
      { key: 'C', text: '多勢' }, { key: 'D', text: '大正' }
    ],
    answerKey: 'B', answerText: '大勢',
    translation: '那里聚集了很多人呢。',
    explanation: '「大勢」读作「おおぜい」，意思是"很多人"。「大変／たいへん」是"非常"，「多勢／たぜい」也是"许多人"但用法不同，「大正／たいしょう」是年号。',
    grammarPoints: [], tags: ['假名→汉字', '长音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 18 }, status: 'ready'
  },
  {
    id: 'g11-q19', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 19,
    stem: 'にもつを**はこぶ**。',
    options: [
      { key: 'A', text: '動く' }, { key: 'B', text: '運転' },
      { key: 'C', text: '運ぶ' }, { key: 'D', text: '送る' }
    ],
    answerKey: 'C', answerText: '運ぶ',
    translation: '搬运行李。',
    explanation: '「運ぶ」读作「はこぶ」，意思是"搬运、运送"。「動く／うごく」是"动"，「運転／うんてん」是"驾驶"，「送る／おくる」是"送"。',
    grammarPoints: [], tags: ['假名→汉字', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 19 }, status: 'ready'
  },
  // ===== Q20-28: 词汇读音/选词 =====
  {
    id: 'g11-q20', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 20,
    stem: '目を**閉じる**と、川の音が聞こえます。',
    options: [
      { key: 'A', text: 'とじる' }, { key: 'B', text: 'あじる' },
      { key: 'C', text: 'ちじる' }, { key: 'D', text: 'びじる' }
    ],
    answerKey: 'A', answerText: 'とじる',
    translation: '闭上眼睛，就能听到河水声。',
    explanation: '「閉じる」读作「とじる」，意思是"闭上"。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 20 }, status: 'ready'
  },
  {
    id: 'g11-q21', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 21,
    stem: '私は**歴史**に興味があります。',
    options: [
      { key: 'A', text: 'れいし' }, { key: 'B', text: 'れきし' },
      { key: 'C', text: 'れきいし' }, { key: 'D', text: 'れいきし' }
    ],
    answerKey: 'B', answerText: 'れきし',
    translation: '我对历史有兴趣。',
    explanation: '「歴史」读作「れきし」，意思是"历史"。「興味があります」表示"对……有兴趣"。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 21 }, status: 'ready'
  },
  {
    id: 'g11-q22', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 22,
    stem: '先日は日本で**地震**がありました。',
    options: [
      { key: 'A', text: 'ちじん' }, { key: 'B', text: 'ちしん' },
      { key: 'C', text: 'じしん' }, { key: 'D', text: 'じじん' }
    ],
    answerKey: 'C', answerText: 'じしん',
    translation: '前些天日本发生了地震。',
    explanation: '「地震」读作「じしん」，意思是"地震"。注意浊音「じ」vs 清音「ち」。',
    grammarPoints: [], tags: ['读音', '浊音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 22 }, status: 'ready'
  },
  {
    id: 'g11-q23', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 23,
    stem: '**平日**も休日も見学できる。',
    options: [
      { key: 'A', text: 'へいじつ' }, { key: 'B', text: 'へいにち' },
      { key: 'C', text: 'たいじつ' }, { key: 'D', text: 'たいにち' }
    ],
    answerKey: 'A', answerText: 'へいじつ',
    translation: '平日和休息日都可以参观。',
    explanation: '「平日」读作「へいじつ」，意思是"工作日、平日"。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 23 }, status: 'ready'
  },
  {
    id: 'g11-q24', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 24,
    stem: 'ちょっと**休憩**しましょう。',
    options: [
      { key: 'A', text: 'きゅうけ' }, { key: 'B', text: 'きゅうけい' },
      { key: 'C', text: 'やすみ' }, { key: 'D', text: 'やすけい' }
    ],
    answerKey: 'B', answerText: 'きゅうけい',
    translation: '稍微休息一下吧。',
    explanation: '「休憩」读作「きゅうけい」，意思是"休息"。「休み」也有休息的意思，但不是该汉字读音。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 24 }, status: 'ready'
  },
  {
    id: 'g11-q25', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 25,
    stem: '大声を出したら、**近所**迷惑ですよ。',
    options: [
      { key: 'A', text: 'ちかどころ' }, { key: 'B', text: 'ちなどころ' },
      { key: 'C', text: 'きんじょ' }, { key: 'D', text: 'きんしょ' }
    ],
    answerKey: 'C', answerText: 'きんじょ',
    translation: '大声喧哗会给邻居添麻烦哦。',
    explanation: '「近所」读作「きんじょ」，意思是"附近、邻居"。「近所迷惑」指"给邻居添麻烦"。注意浊音「じょ」。',
    grammarPoints: [], tags: ['读音', '浊音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 25 }, status: 'ready'
  },
  {
    id: 'g11-q26', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 26,
    stem: '彼は法律に**詳しい**です。',
    options: [
      { key: 'A', text: 'しょうしい' }, { key: 'B', text: 'いそがしい' },
      { key: 'C', text: 'くわしい' }, { key: 'D', text: 'やさしい' }
    ],
    answerKey: 'C', answerText: 'くわしい',
    translation: '他对法律很熟悉。',
    explanation: '「詳しい」读作「くわしい」，意思是"详细的、熟悉的"。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 26 }, status: 'ready'
  },
  {
    id: 'g11-q27', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 27,
    stem: '「時は金なり」という**諺**がある。',
    options: [
      { key: 'A', text: 'ものがたり' }, { key: 'B', text: 'ことば' },
      { key: 'C', text: 'ものごと' }, { key: 'D', text: 'ことわざ' }
    ],
    answerKey: 'D', answerText: 'ことわざ',
    translation: '有句谚语叫"时间就是金钱"。',
    explanation: '「諺」读作「ことわざ」，意思是"谚语"。「時は金なり」是"时间就是金钱"。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 27 }, status: 'ready'
  },
  {
    id: 'g11-q28', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 28,
    stem: '優秀な成績で大学を**卒業**した。',
    options: [
      { key: 'A', text: 'とつぎゅう' }, { key: 'B', text: 'そぎょう' },
      { key: 'C', text: 'そつぎょう' }, { key: 'D', text: 'そつぎゅう' }
    ],
    answerKey: 'C', answerText: 'そつぎょう',
    translation: '以优秀成绩从大学毕业。',
    explanation: '「卒業」读作「そつぎょう」，意思是"毕业"。注意促音「そつ」和长音「ぎょう」。',
    grammarPoints: [], tags: ['读音', '促音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 28 }, status: 'ready'
  },
  // ===== Q29-30: 词汇选择 =====
  {
    id: 'g11-q29', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 29,
    stem: 'このボタンを押すと、（　　　）が閉まりますよ。',
    options: [
      { key: 'A', text: 'カップル' }, { key: 'B', text: 'カーテン' },
      { key: 'C', text: 'シーズン' }, { key: 'D', text: 'シート' }
    ],
    answerKey: 'B', answerText: 'カーテン',
    translation: '按这个按钮，窗帘就会关上。',
    explanation: '能和「閉まる」搭配的是「カーテンが閉まる」，意思是"窗帘会关上"。',
    grammarPoints: ['自动词'], tags: ['词汇', '外来语', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 29 }, status: 'ready'
  },
  {
    id: 'g11-q30', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 30,
    stem: 'たくさん買い物したので、財布に500円ぐらいしか**残って**いない。',
    options: [
      { key: 'A', text: 'いきって' }, { key: 'B', text: 'かえって' },
      { key: 'C', text: 'のこって' }, { key: 'D', text: 'あらって' }
    ],
    answerKey: 'C', answerText: 'のこって',
    translation: '买了很多东西，所以钱包里只剩大约500日元了。',
    explanation: '「残る」读作「のこる」，て形「残って」。',
    grammarPoints: [], tags: ['读音', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 30 }, status: 'ready'
  },
  // ===== Q31-40: 假名→汉字 词汇选择 =====
  {
    id: 'g11-q31', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 31,
    stem: '道が分からないとき、**こうばん**に聞いてもいいです。',
    options: [
      { key: 'A', text: '交替' }, { key: 'B', text: '公表' },
      { key: 'C', text: '交番' }, { key: 'D', text: '警察' }
    ],
    answerKey: 'C', answerText: '交番',
    translation: '不认识路的时候，可以问派出所。',
    explanation: '「こうばん」写作「交番」，意思是"派出所、警察岗亭"。「警察」读作「けいさつ」。',
    grammarPoints: [], tags: ['假名→汉字', '词汇', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 31 }, status: 'ready'
  },
  {
    id: 'g11-q32', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 32,
    stem: '**きかい**があれば、アメリカへ行きたいです。',
    options: [
      { key: 'A', text: '集合' }, { key: 'B', text: '会合' },
      { key: 'C', text: '機械' }, { key: 'D', text: '機会' }
    ],
    answerKey: 'D', answerText: '機会',
    translation: '如果有机会，想去美国。',
    explanation: '这里的「きかい」意思是"机会"，写作「機会」。不是「機械／きかい」的"机器"。',
    grammarPoints: [], tags: ['假名→汉字', '同音词', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 32 }, status: 'ready'
  },
  {
    id: 'g11-q33', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 33,
    stem: '今年新しい**せつび**を購入しました。',
    options: [
      { key: 'A', text: '設計' }, { key: 'B', text: '商品' },
      { key: 'C', text: '機械' }, { key: 'D', text: '設備' }
    ],
    answerKey: 'D', answerText: '設備',
    translation: '今年购买了新设备。',
    explanation: '「せつび」写作「設備」，意思是"设备、设施"。',
    grammarPoints: [], tags: ['假名→汉字', '词汇', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 33 }, status: 'ready'
  },
  {
    id: 'g11-q34', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 34,
    stem: '事故に**あいました**。',
    options: [
      { key: 'A', text: '会い' }, { key: 'B', text: '遭い' },
      { key: 'C', text: '相い' }, { key: 'D', text: '合い' }
    ],
    answerKey: 'B', answerText: '遭い',
    translation: '遇到了事故。',
    explanation: '表示"遇到事故、遭遇不好的事情"时用「遭う」。所以是「事故に遭いました」。',
    grammarPoints: [], tags: ['假名→汉字', '同音词', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 34 }, status: 'ready'
  },
  {
    id: 'g11-q35', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 35,
    stem: '**こわい**顔をしています。',
    options: [
      { key: 'A', text: '弱い' }, { key: 'B', text: '言い' },
      { key: 'C', text: '強い' }, { key: 'D', text: '怖い' }
    ],
    answerKey: 'D', answerText: '怖い',
    translation: '摆着一张可怕的脸。',
    explanation: '「こわい」写作「怖い」，意思是"可怕的"。',
    grammarPoints: [], tags: ['假名→汉字', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 35 }, status: 'ready'
  },
  {
    id: 'g11-q36', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 36,
    stem: 'その本は**ねだん**が高いです。',
    options: [
      { key: 'A', text: '価格' }, { key: 'B', text: '値段' },
      { key: 'C', text: '価値' }, { key: 'D', text: '価段' }
    ],
    answerKey: 'B', answerText: '値段',
    translation: '那本书价格很高。',
    explanation: '「ねだん」写作「値段」，意思是"价格"。「価格／かかく」也是价格，但读音不同。',
    grammarPoints: [], tags: ['假名→汉字', '词汇', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 36 }, status: 'ready'
  },
  {
    id: 'g11-q37', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 37,
    stem: 'あの会社は**きゅうりょう**がいい。',
    options: [
      { key: 'A', text: '薪水' }, { key: 'B', text: '給与' },
      { key: 'C', text: '工資' }, { key: 'D', text: '給料' }
    ],
    answerKey: 'D', answerText: '給料',
    translation: '那家公司工资不错。',
    explanation: '「きゅうりょう」写作「給料」，意思是"工资"。「給与」读作「きゅうよ」。',
    grammarPoints: [], tags: ['假名→汉字', '词汇', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 37 }, status: 'ready'
  },
  {
    id: 'g11-q38', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 38,
    stem: '友達の結婚（　　　）に出るために新しい服を買いました。',
    options: [
      { key: 'A', text: '会' }, { key: 'B', text: '儀' },
      { key: 'C', text: '式' }, { key: 'D', text: '礼' }
    ],
    answerKey: 'C', answerText: '式',
    translation: '为了参加朋友的婚礼，买了新衣服。',
    explanation: '固定搭配是「結婚式」，意思是"婚礼"。',
    grammarPoints: [], tags: ['词汇', '固定搭配', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 38 }, status: 'ready'
  },
  {
    id: 'g11-q39', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 39,
    stem: '機械が**せいじょう**かどうかチェックした。',
    options: [
      { key: 'A', text: '正情' }, { key: 'B', text: '正常' },
      { key: 'C', text: '威常' }, { key: 'D', text: '盛情' }
    ],
    answerKey: 'B', answerText: '正常',
    translation: '检查了机器是否正常。',
    explanation: '「せいじょう」写作「正常」，意思是"正常"。',
    grammarPoints: [], tags: ['假名→汉字', '词汇', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 39 }, status: 'ready'
  },
  {
    id: 'g11-q40', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 40,
    stem: '子供の時、小さい犬を**かって**いました。',
    options: [
      { key: 'A', text: '買って' }, { key: 'B', text: '借って' },
      { key: 'C', text: '飼って' }, { key: 'D', text: '書って' }
    ],
    answerKey: 'C', answerText: '飼って',
    translation: '小时候养过小狗。',
    explanation: '养动物用「飼う／かう」，て形「飼って」。买东西才用「買う／買って」。',
    grammarPoints: ['て形'], tags: ['假名→汉字', '同音词', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 40 }, status: 'ready'
  },
  // ===== Q41-46: 语法（被动/授受） =====
  {
    id: 'g11-q41', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 41,
    stem: '鈴木さんにカメラを（　　　）ました。',
    options: [
      { key: 'A', text: '貸させて' }, { key: 'B', text: '貸してくれ' },
      { key: 'C', text: '貸してもらい' }, { key: 'D', text: '貸され' }
    ],
    answerKey: 'C', answerText: '貸してもらい',
    translation: '请铃木先生借给我相机。',
    explanation: '「Aさんに〜てもらう」表示"请A为我做某事 / 得到A的帮助"。「鈴木さんにカメラを貸してもらいました」意为"请铃木先生借给我相机"。',
    grammarPoints: ['授受动词', 'てもらう'], tags: ['语法', '授受', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 41 }, status: 'ready'
  },
  {
    id: 'g11-q42', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 42,
    stem: 'コンピューターはいろいろな所で（　　　）います。',
    options: [
      { key: 'A', text: '使った' }, { key: 'B', text: '使わせて' },
      { key: 'C', text: '使われて' }, { key: 'D', text: '使って' }
    ],
    answerKey: 'C', answerText: '使われて',
    translation: '电脑在很多地方被使用。',
    explanation: '主语是「コンピューター」，意思是"电脑在很多地方被使用"，要用被动态「使われています」。',
    grammarPoints: ['被动形'], tags: ['语法', '被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 42 }, status: 'ready'
  },
  {
    id: 'g11-q43', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 43,
    stem: 'この小説は有名な作家（　　　）書かれました。',
    options: [
      { key: 'A', text: 'によって' }, { key: 'B', text: 'で' },
      { key: 'C', text: 'によると' }, { key: 'D', text: 'を' }
    ],
    answerKey: 'A', answerText: 'によって',
    translation: '这部小说是由有名的作家写的。',
    explanation: '被动态中表示"由某人创作、发明、建造"等时，常用「〜によって」。',
    grammarPoints: ['被动形', 'によって'], tags: ['语法', '被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 43 }, status: 'ready'
  },
  {
    id: 'g11-q44', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 44,
    stem: '女：この漫画はすごい人気ですね。\n男：ええ、多くの子供に（　　　）いるそうですよ。',
    options: [
      { key: 'A', text: '読ませて' }, { key: 'B', text: '読んで' },
      { key: 'C', text: '読まれて' }, { key: 'D', text: '読まされて' }
    ],
    answerKey: 'C', answerText: '読まれて',
    translation: '女：这本漫画真受欢迎啊。\n男：是啊，听说被很多孩子读呢。',
    explanation: '漫画"被很多孩子阅读"，要用被动态「読まれている」。不是使役「読ませる」，也不是使役被动「読まされる」。',
    grammarPoints: ['被动形'], tags: ['语法', '被动', '会话', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 44 }, status: 'ready'
  },
  {
    id: 'g11-q45', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 45,
    stem: '雨に（　　　）、風邪を引いてしまいました。',
    options: [
      { key: 'A', text: '降り' }, { key: 'B', text: '降って' },
      { key: 'C', text: '降らせて' }, { key: 'D', text: '降られて' }
    ],
    answerKey: 'D', answerText: '降られて',
    translation: '被雨淋了，结果感冒了。',
    explanation: '「雨に降られる」是受害被动，意思是"被雨淋了、遇上下雨"。表示"遭受不好的事情"。',
    grammarPoints: ['被动形', '受害被动'], tags: ['语法', '被动', '受害被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 45 }, status: 'ready'
  },
  {
    id: 'g11-q46', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 46,
    stem: '動物も人の気持ちがわかると（　　　）います。',
    options: [
      { key: 'A', text: '言われて' }, { key: 'B', text: '言った' },
      { key: 'C', text: '言いて' }, { key: 'D', text: '言わせて' }
    ],
    answerKey: 'A', answerText: '言われて',
    translation: '据说动物也能理解人的心情。',
    explanation: '「〜と言われています」表示"据说……、人们认为……"。是固定句型表达普遍说法。',
    grammarPoints: ['被动形', 'と言われている'], tags: ['语法', '被动', '固定句型', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 46 }, status: 'ready'
  },
  // ===== Q47-52: 语法（与File 1重叠，用File 1版本） =====
  {
    id: 'g11-q47', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 47,
    stem: 'この雑誌はわかい人に（　　　）います。',
    options: [
      { key: 'A', text: '読めて' }, { key: 'B', text: '読まれて' },
      { key: 'C', text: '読まされて' }, { key: 'D', text: '読んで' }
    ],
    answerKey: 'B', answerText: '読まれて',
    translation: '这本杂志被年轻人阅读。',
    explanation: '杂志"被年轻人阅读"，用被动态「読まれています」。',
    grammarPoints: ['被动形'], tags: ['语法', '被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 47 }, status: 'ready'
  },
  {
    id: 'g11-q48', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 48,
    stem: 'お米は外国から（　　　）います。',
    options: [
      { key: 'A', text: '輸出されて' }, { key: 'B', text: '輸入されて' },
      { key: 'C', text: '輸入させて' }, { key: 'D', text: '輸入しれて' }
    ],
    answerKey: 'B', answerText: '輸入されて',
    translation: '大米是从外国进口的。',
    explanation: '「外国から」表示"从外国"，所以是"从外国进口"。「輸入されている」表示"被进口"。「輸出」是出口。',
    grammarPoints: ['被动形'], tags: ['语法', '被动', '词汇', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 48 }, status: 'ready'
  },
  {
    id: 'g11-q49', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 49,
    stem: '宿題を忘れて、先生（　　　）しかられました。',
    options: [
      { key: 'A', text: 'は' }, { key: 'B', text: 'が' },
      { key: 'C', text: 'を' }, { key: 'D', text: 'に' }
    ],
    answerKey: 'D', answerText: 'に',
    translation: '忘记作业，被老师批评了。',
    explanation: '被动态中，动作发出者常用「に」表示。「先生にしかられました」意为"被老师批评了"。',
    grammarPoints: ['被动形', '助词に'], tags: ['语法', '被动', '助词', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 49 }, status: 'ready'
  },
  {
    id: 'g11-q50', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 50,
    stem: 'この庭園は日本の有名なデザイナー（　　　）設計されました。',
    options: [
      { key: 'A', text: 'にて' }, { key: 'B', text: 'になって' },
      { key: 'C', text: 'にして' }, { key: 'D', text: 'によって' }
    ],
    answerKey: 'D', answerText: 'によって',
    translation: '这个庭园是由日本著名设计师设计的。',
    explanation: '被动句中表示"由某人设计、创作"时，用「〜によって」。',
    grammarPoints: ['被动形', 'によって'], tags: ['语法', '被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 50 }, status: 'ready'
  },
  {
    id: 'g11-q51', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 51,
    stem: '風邪を引かない（　　　）、毎日朝の運動をします。',
    options: [
      { key: 'A', text: 'ように' }, { key: 'B', text: 'たびに' },
      { key: 'C', text: 'ために' }, { key: 'D', text: 'おきに' }
    ],
    answerKey: 'A', answerText: 'ように',
    translation: '为了不感冒，每天早上运动。',
    explanation: '「〜ないように」表示"为了不……"。与「ために」的区别：「ように」前面接非意志动词或否定形，表示"为了达到某种状态"。',
    grammarPoints: ['ように', 'ために'], tags: ['语法', '目的表达', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 51 }, status: 'ready'
  },
  {
    id: 'g11-q52', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 52,
    stem: '子供のころ、嫌いだった野菜が最近（　　　）ようになりました。',
    options: [
      { key: 'A', text: '食べている' }, { key: 'B', text: '食べる' },
      { key: 'C', text: '食べられる' }, { key: 'D', text: '食べた' }
    ],
    answerKey: 'C', answerText: '食べられる',
    translation: '小时候讨厌的蔬菜，最近变得能吃了。',
    explanation: '「食べられる」是可能形，表示"能吃"。「食べられるようになりました」意为"变得能吃了"。表示能力的变化。',
    grammarPoints: ['可能形', 'ようになる'], tags: ['语法', '可能形', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 52 }, status: 'ready'
  },
  // ===== Q53-69: 语法选择 (from File 3) =====
  {
    id: 'g11-q53', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 53,
    stem: '何でも（　　　）気持ちが大切なんです。',
    options: [
      { key: 'A', text: 'チャレーンジ' }, { key: 'B', text: 'チャーレンジ' },
      { key: 'C', text: 'チャレンジ' }, { key: 'D', text: 'チャージ' }
    ],
    answerKey: 'C', answerText: 'チャレンジ',
    translation: '什么都敢于挑战的心情很重要。',
    explanation: '考查片假名拼写。challenge 的正确日语拼写是「チャレンジ」。句意：什么都敢于挑战的心情很重要。',
    grammarPoints: [], tags: ['片假名', '外来语', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 53 }, status: 'ready'
  },
  {
    id: 'g11-q54', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 54,
    stem: '私は、1年前には、ぜんぜん日本語が話せませんでしたが、先生のおかげで、今は話せる（　　　）。',
    options: [
      { key: 'A', text: 'ようになりました' }, { key: 'B', text: 'ことにしました' },
      { key: 'C', text: 'ことになりました' }, { key: 'D', text: 'ようにしました' }
    ],
    answerKey: 'A', answerText: 'ようになりました',
    translation: '我一年前完全不会说日语，但多亏了老师，现在变得会说了。',
    explanation: '「話せるようになりました」表示"变得会说了"。「ようになる」表示能力、状态发生变化。',
    grammarPoints: ['ようになる', '可能形'], tags: ['语法', '可能形', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 54 }, status: 'ready'
  },
  {
    id: 'g11-q55', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 55,
    stem: '早く試合に（　　　）ようになりたいです。',
    options: [
      { key: 'A', text: '出られる' }, { key: 'B', text: '出る' },
      { key: 'C', text: '出す' }, { key: 'D', text: 'でれる' }
    ],
    answerKey: 'A', answerText: '出られる',
    translation: '想早点变得能够参加比赛。',
    explanation: '「試合に出る」表示"参加比赛"。「出られるようになりたい」表示"想变得能够参加比赛"。要用标准可能形「出られる」。「でれる」是口语省略形，不用于正式考试。',
    grammarPoints: ['可能形', 'ようになる'], tags: ['语法', '可能形', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 55 }, status: 'ready'
  },
  {
    id: 'g11-q56', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 56,
    stem: '「絶対にパスポートを（　　　）。」\n「はい、わかりました。」',
    options: [
      { key: 'A', text: 'なくすようにしてください' },
      { key: 'B', text: 'ようにしています' },
      { key: 'C', text: 'なくしないようにしてください' },
      { key: 'D', text: 'なくさないようにしてください' }
    ],
    answerKey: 'D', answerText: 'なくさないようにしてください',
    translation: '"绝对不要弄丢护照。""好的，我知道了。"',
    explanation: '「なくす」的否定形是「なくさない」（一类动词）。「なくさないようにしてください」表示"请不要弄丢"。A 的意思变成"请努力弄丢"，错误；C 的否定形式错误（五段动词否定应为「なくさない」而非「なくしない」）。',
    grammarPoints: ['ようにしてください', '否定形'], tags: ['语法', '否定', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 56 }, status: 'ready'
  },
  {
    id: 'g11-q57', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 57,
    stem: '早く上手にお茶を（　　　）ことができるようになりたいです。',
    options: [
      { key: 'A', text: 'はいる' }, { key: 'B', text: 'たつ' },
      { key: 'C', text: 'たてる' }, { key: 'D', text: 'いる' }
    ],
    answerKey: 'C', answerText: 'たてる',
    translation: '想早点变得能够熟练地点茶。',
    explanation: '「お茶をたてる」是固定表达，表示"点茶、泡抹茶"。「ことができるようになりたい」表示"想变得能够……"。',
    grammarPoints: ['可能形', '固定搭配'], tags: ['语法', '可能形', '文化', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 57 }, status: 'ready'
  },
  {
    id: 'g11-q58', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 58,
    stem: '「日本語が上手ですね。」\n「毎日1時間日本語の本を読む（　　　）。」',
    options: [
      { key: 'A', text: 'ようにしています' }, { key: 'B', text: 'ようになりました' },
      { key: 'C', text: 'ようにしましょう' }, { key: 'D', text: 'ようにしてください' }
    ],
    answerKey: 'A', answerText: 'ようにしています',
    translation: '"你日语真好啊。""我每天尽量读1小时日语书。"',
    explanation: '「～ようにしています」表示"坚持做…… / 尽量做到……"。描述自己日常坚持的习惯。',
    grammarPoints: ['ようにしている'], tags: ['语法', '习惯', '会话', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 58 }, status: 'ready'
  },
  {
    id: 'g11-q59', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 59,
    stem: '「夜11時過ぎたら、洗濯（　　　）。近所に迷惑ですから。」',
    options: [
      { key: 'A', text: 'するようになりました' },
      { key: 'B', text: 'するようにしましょう' },
      { key: 'C', text: 'するようにしてください' },
      { key: 'D', text: 'しないようにしてください' }
    ],
    answerKey: 'D', answerText: 'しないようにしてください',
    translation: '"过了晚上11点，请不要洗衣服。会给邻居添麻烦。"',
    explanation: '因为"会给邻居添麻烦"，所以应是"请不要洗衣服"。「しないようにしてください」表示"请不要做……"。',
    grammarPoints: ['ようにしてください', '否定'], tags: ['语法', '否定', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 59 }, status: 'ready'
  },
  {
    id: 'g11-q60', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 60,
    stem: 'A：朝はいつも4時半ごろ起きています。\nB：どうして（　　　）早く起きるんですか。',
    options: [
      { key: 'A', text: 'こんなに' }, { key: 'B', text: 'どんなに' },
      { key: 'C', text: 'あんなに' }, { key: 'D', text: 'そんなに' }
    ],
    answerKey: 'D', answerText: 'そんなに',
    translation: 'A：我早上总是4点半左右起床。\nB：为什么起那么早呢？',
    explanation: '对方说自己4点半起床，说话人回应"为什么那么早起床？"这里用「そんなに」，表示"那么、那样地"（指对方所述的程度）。「こんなに」指自己这边的程度，「あんなに」指远方/第三方的程度。',
    grammarPoints: ['こそあど'], tags: ['语法', '指示词', '会话', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 60 }, status: 'ready'
  },
  {
    id: 'g11-q61', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 61,
    stem: '「ショパンの曲が弾けるようになりましたか。」\n「いいえ、まだ弾けません。早く（　　　）。」',
    options: [
      { key: 'A', text: '弾けるようになりたいです' },
      { key: 'B', text: '弾けるようにしましょう' },
      { key: 'C', text: '弾けるようになりました' },
      { key: 'D', text: '弾けるようにしてください' }
    ],
    answerKey: 'A', answerText: '弾けるようになりたいです',
    translation: '"你能弹肖邦的曲子了吗？""不，还不会弹。想早点变得会弹。"',
    explanation: '前面说"还不会弹"，后面自然是"想早点变得会弹"。「～ようになりたい」表示"想变得能够……"。表示个人愿望。',
    grammarPoints: ['可能形', 'ようになる', '愿望'], tags: ['语法', '可能形', '愿望', '会话', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 61 }, status: 'ready'
  },
  {
    id: 'g11-q62', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 62,
    stem: '野菜が（　　　）食べなくてもいいよ。',
    options: [
      { key: 'A', text: '嫌いと' }, { key: 'B', text: '嫌いだら' },
      { key: 'C', text: '嫌いなら' }, { key: 'D', text: '嫌いだと' }
    ],
    answerKey: 'C', answerText: '嫌いなら',
    translation: '如果讨厌蔬菜的话，不吃也可以哦。',
    explanation: '「嫌いなら」表示"如果讨厌的话"。「なら」用于承接对方的话或已知信息提出条件。',
    grammarPoints: ['なら', '条件形'], tags: ['语法', '条件', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 62 }, status: 'ready'
  },
  {
    id: 'g11-q63', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 63,
    stem: 'レポートはあした（　　　）出さなければなりません。',
    options: [
      { key: 'A', text: 'までと' }, { key: 'B', text: 'までで' },
      { key: 'C', text: 'までに' }, { key: 'D', text: 'までを' }
    ],
    answerKey: 'C', answerText: 'までに',
    translation: '报告必须在明天之前提交。',
    explanation: '「までに」表示"在……之前完成某动作"。「明日までに出す」就是"明天之前交"。与「まで」的区别：「まで」表示持续到某个时间点，「までに」表示在截止时间前完成一次性动作。',
    grammarPoints: ['までに', '期限'], tags: ['语法', '助词', '期限', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 63 }, status: 'ready'
  },
  {
    id: 'g11-q64', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 64,
    stem: '道具を（　　　）、元の所に戻しておいてください。',
    options: [
      { key: 'A', text: '使えば' }, { key: 'B', text: '使うと' },
      { key: 'C', text: '使うなら' }, { key: 'D', text: '使ったら' }
    ],
    answerKey: 'D', answerText: '使ったら',
    translation: '用完工具后，请放回原处。',
    explanation: '「使ったら」表示"用完之后 / 如果用了的话"。「たら」表示动作先后顺序，前一动作完成后做后一动作。',
    grammarPoints: ['たら', '条件形'], tags: ['语法', '条件', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 64 }, status: 'ready'
  },
  {
    id: 'g11-q65', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 65,
    stem: 'ドラえもんは、「タケコプター」を頭につけると、自由に（　　　）。',
    options: [
      { key: 'A', text: '空が飛びます' }, { key: 'B', text: '空を飛べます' },
      { key: 'C', text: '空を飛びます' }, { key: 'D', text: '空が飛べます' }
    ],
    answerKey: 'B', answerText: '空を飛べます',
    translation: '哆啦A梦把竹蜻蜓戴在头上，就能自由地在空中飞。',
    explanation: '「空を飛ぶ」是固定搭配，表示"在空中飞"（移动经过的空间用「を」）。这里强调"能够自由飞"，所以用可能形「飛べます」。',
    grammarPoints: ['可能形', '助词を'], tags: ['语法', '可能形', '助词', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 65 }, status: 'ready'
  },
  {
    id: 'g11-q66', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 66,
    stem: 'かぎが掛かっていますから、部屋に（　　　）。',
    options: [
      { key: 'A', text: 'いりません' }, { key: 'B', text: 'はいれません' },
      { key: 'C', text: 'いれません' }, { key: 'D', text: 'はいりません' }
    ],
    answerKey: 'B', answerText: 'はいれません',
    translation: '因为锁着门，所以进不了房间。',
    explanation: '「入る」的可能形是「入れる／はいれる」。「部屋に入れません」表示"进不了房间"。注意区分「いりません」（不需要）和「はいれません」（进不去）。',
    grammarPoints: ['可能形'], tags: ['语法', '可能形', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 66 }, status: 'ready'
  },
  {
    id: 'g11-q67', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 67,
    stem: '天気が（　　　）富士山が見えるでしょう。',
    options: [
      { key: 'A', text: 'よくすれば' }, { key: 'B', text: 'よければ' },
      { key: 'C', text: 'よくければ' }, { key: 'D', text: 'いければ' }
    ],
    answerKey: 'B', answerText: 'よければ',
    translation: '如果天气好的话，应该能看到富士山吧。',
    explanation: '「いい」的条件形是「よければ」。是不规则变化，需要特别记忆。',
    grammarPoints: ['条件形', 'いい/よい'], tags: ['语法', '条件', '不规则', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 67 }, status: 'ready'
  },
  {
    id: 'g11-q68', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 68,
    stem: '天気予報（　　　）、午後から雨が降り出した。',
    options: [
      { key: 'A', text: 'とおりに' }, { key: 'B', text: 'とおりの' },
      { key: 'C', text: 'どおりに' }, { key: 'D', text: 'どおりだ' }
    ],
    answerKey: 'C', answerText: 'どおりに',
    translation: '正如天气预报所说，从下午开始下起了雨。',
    explanation: '名词后接「どおりに」（浊音化），表示"按照…… / 正如……"。「天気予報どおりに」表示"正如天气预报所说"。注意：名词后要浊音化变成「どおり」，动词连用形后是「とおり」。',
    grammarPoints: ['どおりに', 'とおりに'], tags: ['语法', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 68 }, status: 'ready'
  },
  {
    id: 'g11-q69', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 69,
    stem: '甲：鈴木さんはまだ？\n乙：鈴木さん（　　　）もうすぐ来ると思います。',
    options: [
      { key: 'A', text: 'たら' }, { key: 'B', text: 'と' },
      { key: 'C', text: 'なら' }, { key: 'D', text: 'ば' }
    ],
    answerKey: 'C', answerText: 'なら',
    translation: '甲：铃木先生还没来吗？\n乙：铃木先生的话，我想马上就会来。',
    explanation: '「鈴木さんなら」表示"如果你说的是铃木先生的话 / 至于铃木先生"。承接对方话中的人物提出判断。',
    grammarPoints: ['なら', '条件形'], tags: ['语法', '条件', '会话', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 69 }, status: 'ready'
  },
  // ===== Q71-75: 语序题 (from File 3) =====
  {
    id: 'g11-q71', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 71,
    stem: 'A「じゃあ、あしたはコンサート会場の入り口に5時に集まりませんか。」\nB「コンサートは7時からですから、そんなに＿＿ ＿＿ ★ ＿＿と思いますよ。」\nA. まだ　B. 行っても　C. 早く　D. 開いていない',
    options: [
      { key: 'A', text: 'まだ' }, { key: 'B', text: '行っても' },
      { key: 'C', text: '早く' }, { key: 'D', text: '開いていない' }
    ],
    answerKey: 'A', answerText: 'まだ',
    translation: 'A：那明天5点在音乐会会场入口集合吧。\nB：音乐会是7点开始的，我觉得那么早去也还没开门。',
    explanation: '正确语序：そんなに**早く**（C）**行っても**（B）**まだ**（A・★）**開いていない**（D）と思いますよ。「そんなに早く行っても」表示"即使那么早去"；「まだ開いていない」表示"还没开门"。★在第三个位置，是「まだ」。',
    grammarPoints: ['ても', 'まだ'], tags: ['语法', '语序', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 71 }, status: 'ready'
  },
  {
    id: 'g11-q72', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 72,
    stem: '学生「田中先生はいらっしゃいますか。」\n秘書「今、ほかの学生と話して＿＿ ＿＿ ★ ＿＿ください。」\nA. 待って　B. いらっしゃいます　C. すこし　D. から',
    options: [
      { key: 'A', text: '待って' }, { key: 'B', text: 'いらっしゃいます' },
      { key: 'C', text: 'すこし' }, { key: 'D', text: 'から' }
    ],
    answerKey: 'C', answerText: 'すこし',
    translation: '学生：田中老师在吗？\n秘书：现在正在和其他学生谈话，请稍等一下。',
    explanation: '正确语序：今、ほかの学生と話して**いらっしゃいます**（B）**から**（D）、**すこし**（C・★）**待って**（A）ください。「話していらっしゃいます」是「話しています」的尊敬语；「から」表示原因。★在第三个位置，是「すこし」。',
    grammarPoints: ['尊敬语', 'から'], tags: ['语法', '语序', '敬语', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 72 }, status: 'ready'
  },
  {
    id: 'g11-q73', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 73,
    stem: '父も私も、今日はかさがなくても＿＿ ＿＿ ★ ＿＿が、雨に降られてしまった。\nA. 出かけた　B. と思って　C. だろう　D. 大丈夫',
    options: [
      { key: 'A', text: '出かけた' }, { key: 'B', text: 'と思って' },
      { key: 'C', text: 'だろう' }, { key: 'D', text: '大丈夫' }
    ],
    answerKey: 'B', answerText: 'と思って',
    translation: '父亲和我都觉得今天没伞也应该没问题就出门了，结果被雨淋了。',
    explanation: '正确语序：今日はかさがなくても**大丈夫**（D）**だろう**（C）**と思って**（B・★）**出かけた**（A）が、雨に降られてしまった。「大丈夫だろうと思って」表示"想着应该没问题"。「雨に降られる」是受害被动。★在第三个位置，是「と思って」。',
    grammarPoints: ['受害被动', 'と思う'], tags: ['语法', '语序', '被动', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 73 }, status: 'ready'
  },
  {
    id: 'g11-q74', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 74,
    stem: '昨日動物園に行ったら、先月＿＿ ＿＿ ★ ＿＿見ることができました。\nA. 赤ちゃんを　B. 生まれた　C. ばかりの　D. ライオンの',
    options: [
      { key: 'A', text: '赤ちゃんを' }, { key: 'B', text: '生まれた' },
      { key: 'C', text: 'ばかりの' }, { key: 'D', text: 'ライオンの' }
    ],
    answerKey: 'D', answerText: 'ライオンの',
    translation: '昨天去动物园，看到了上个月刚出生的小狮子。',
    explanation: '正确语序：先月**生まれた**（B）**ばかりの**（C）**ライオンの**（D・★）**赤ちゃんを**（A）見ることができました。「生まれたばかり」表示"刚出生"；「ライオンの赤ちゃん」表示"小狮子"。★在第三个位置，是「ライオンの」。',
    grammarPoints: ['ばかり', 'たばかり'], tags: ['语法', '语序', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 74 }, status: 'ready'
  },
  {
    id: 'g11-q75', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 75,
    stem: 'ジョン「この『りかい』という言葉はどういう意味ですか。」\nアリ「ああ、確か『わかる』＿＿ ＿＿ ★ ＿＿んですけど。」\nA. 意味だった　B. という　C. ような　D. と思う',
    options: [
      { key: 'A', text: '意味だった' }, { key: 'B', text: 'という' },
      { key: 'C', text: 'ような' }, { key: 'D', text: 'と思う' }
    ],
    answerKey: 'A', answerText: '意味だった',
    translation: 'John：这个"理解"这个词是什么意思？\nAli：啊，我记得好像是"懂"这样的意思。',
    explanation: '正确语序：確か『わかる』**という**（B）**ような**（C）**意味だった**（A・★）**と思う**（D）んですけど。「〜というような意味」表示"类似于……这样的意思"；「と思うんですけど」表示委婉说明。★在第三个位置，是「意味だった」。',
    grammarPoints: ['という', 'ような', 'と思う'], tags: ['语法', '语序', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 75 }, status: 'ready'
  },
  // ===== Q76-80: 阅读理解 (from File 2) =====
  {
    id: 'g11-q76', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 76,
    stem: '下記のメールは、鈴木さんが和田さんに送ったものである。\n\nあて先：wada@nihonnote.co.jp\n件名：「新学期向け文房具」について\n\n日本ノート社\n営業部　和田様\n\nいつもお世話になっております。\n先日、送っていただきました「新学期向け文房具」のカタログを拝見しました。\nぜひ一度、お話をうかがいたいので、こちらに来ていただけますでしょうか。ご都合のよい日をお知らせください。\nよろしくお願いいたします。\n\n川村デパート\n文房具担当　鈴木みどり\n\n**鈴木が和田さんにこのメールを送った目的は何か。**',
    options: [
      { key: 'A', text: '文房具の説明にいつ来られるかと聞くこと' },
      { key: 'B', text: '文房具のカタログを見るように頼むこと' },
      { key: 'C', text: '文房具の説明にいつ行ったらいいかと聞くこと' },
      { key: 'D', text: '文房具のカタログを送るように頼むこと' }
    ],
    answerKey: 'A', answerText: '文房具の説明にいつ来られるかと聞くこと',
    translation: '铃木给和田发这封邮件的目的是什么？→ 询问对方什么时候能来说明文具。',
    explanation: '邮件中说「お話をうかがいたいので、こちらに来ていただけますでしょうか。ご都合のよい日をお知らせください」意思是"想听您介绍一下，所以能否请您来我们这里？请告知您方便的日期。"所以铃木的目的是问和田什么时候能来说明文具。B 错：铃木已经看过目录了。C 错：不是铃木问自己什么时候去，而是请和田过来。D 错：目录已经收到，不是要求寄目录。',
    grammarPoints: ['敬语', '阅读'], tags: ['阅读理解', '邮件', '敬语', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 76 }, status: 'ready'
  },
  {
    id: 'g11-q77', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 77,
    stem: 'いい病院とは、どんな病院だろう。医師がよく話を聞いてくれる、最新の機械があるかどうかと、人によって考えは様々だ。結局、自分にとって安心できる病院がいい病院だと言えるだろう。では、どうやっていい病院を見つけるか。人に聞いたり、本や雑誌、インターネットなどで調べたり、いくらでも方法はある。しかし、最終的に選ぶのは自分である。いい病院を選ぶための物差しを、自分の中にしっかり持っていることが重要だ。\n\n**この文章では、病院を選ぶ時に大切なのはどんなことだと言っているか。**',
    options: [
      { key: 'A', text: 'その病院に新しい機械がたくさんおいてあること' },
      { key: 'B', text: 'その病院の医者がよく話を聞いてくれること' },
      { key: 'C', text: 'その病院が本や雑誌などで紹介されていること' },
      { key: 'D', text: 'その病院がよいと自分で確かに思えること' }
    ],
    answerKey: 'D', answerText: 'その病院がよいと自分で確かに思えること',
    translation: '选择医院时最重要的是什么？→ 自己确实能认为那家医院好。',
    explanation: '文章最后说「最終的に選ぶのは自分である。いい病院を選ぶための物差しを、自分の中にしっかり持っていることが重要だ」意思是"最终选择的人是自己。重要的是自己心中要有选择好医院的标准。"所以重点不是设备、不是医生态度、不是媒体介绍，而是自己能否确实认为这家医院适合自己。A、B、C 都只是别人判断医院好坏时可能考虑的因素，不是文章最终强调的重点。',
    grammarPoints: ['阅读'], tags: ['阅读理解', '议论文', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 77 }, status: 'ready'
  },
  {
    id: 'g11-q78', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 78,
    stem: '最近、近所の花屋が閉店した。30年以上も「町の花屋さん」として愛着されてきた店だ。\nこの店がオープンしたのは、わたしがまだ小学校に入る前だった。わたしにとって、①店の思い出はそのまま子どものころの思い出と重なる。家族の誕生日や家にお客さんが来る時などには、母と一緒にこの店で花を買っていた。\n小学校を卒業する時には、こんなことがあった。クラス全員でお金を出し合い、担任の先生に花束をおくることになった。「お礼の気持ちを表すために、見たことのないほど大きいのをおくろう」とわたしたちは話し合った。しかし、小学生のおこづかいの中集まったお金は少しだけだった。それで、②わたしたちはどきどきしながら、「大好きな先生にあげるから、できるだけ大きい花束を作ってください」とお願いした。おじさんは嫌な顔もしないで、特別大きなバラの花束を作ってくれた。\n30年以上もきれいな花束を作り続け、あたたかい思い出を作ってくれたおじさんに、「ありがとう、お疲れ様でした。」と言いたい。\n\n**「店の思い出はそのまま子どものころの思い出と重なる」とあるが、それはどんな思い出か。**',
    options: [
      { key: 'A', text: '小学校を卒業する時に、先生といっしょにこの花屋で花を買ったこと' },
      { key: 'B', text: 'わたしは小学校に入学した時に、この花屋が開店したこと' },
      { key: 'C', text: '特別なことがある時には、よくこの店で花を買っていたこと' },
      { key: 'D', text: 'おじさんが大好きだったので、よくこの店で花を買っていたこと' }
    ],
    answerKey: 'C', answerText: '特別なことがある時には、よくこの店で花を買っていたこと',
    translation: '"店的回忆和童年回忆重合"指的是什么回忆？→ 有特别的事情时经常在这家店买花。',
    explanation: '文章中说「家族の誕生日や家にお客さんが来る時などには、母と一緒にこの店で花を買っていた」意思是"家人生日、家里来客人等特别的时候，常常和妈妈一起在这家店买花。"所以"店的回忆和童年回忆重合"指的是童年中特别的场合经常和这家花店有关。A 错：毕业时是给老师买花，不是和老师一起买。B 错：店是在"我上小学前"开的，不是"入学时"。D 错：不是因为喜欢花店叔叔才经常买花。',
    grammarPoints: ['阅读'], tags: ['阅读理解', '记叙文', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 78 }, status: 'ready'
  },
  {
    id: 'g11-q79', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 79,
    stem: `${HANAYA_ARTICLE}\n\n**「わたしたちはどきどきしながら」とあるが、どうしてどきどきしたのか。**`,
    options: [
      { key: 'A', text: '嫌そうな顔をしているおじさんに、無理なお願いをするから' },
      { key: 'B', text: 'もうすぐ閉店する花屋のおじさんに、無理なお願いをするから' },
      { key: 'C', text: 'お店に花があまりないのに、おじさんに無理なお願いをするから' },
      { key: 'D', text: 'お金が少ししかないのに、おじさんに無理なお願いをするから' }
    ],
    answerKey: 'D', answerText: 'お金が少ししかないのに、おじさんに無理なお願いをするから',
    translation: '"我们紧张地……"为什么紧张？→ 因为钱很少，却要勉强请求叔叔做很大的花束。',
    explanation: '前文说「小学生のおこづかいの中集まったお金は少しだけだった。それで、わたしたちはどきどきしながら……」意思是"大家从小学生零花钱中凑出来的钱只有一点点。因此我们很紧张地请求……"他们想要"见都没见过那么大的花束"，但是钱很少，所以觉得这个请求有点勉强，才会紧张。A 错：原文后面说叔叔没有露出不高兴的表情。B 错：当时不是因为花店马上关门。C 错：原文没有说店里花不够。',
    grammarPoints: ['阅读'], tags: ['阅读理解', '记叙文', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 79 }, status: 'ready'
  },
  {
    id: 'g11-q80', groupId: 'g11', groupTitle: '2021年真题', numberInGroup: 80,
    stem: `${HANAYA_ARTICLE}\n\n**この文章を書いた人が一番伝えたいことは何か。**`,
    options: [
      { key: 'A', text: '大好きだった花屋さんが閉店するので、さびしいと思う。' },
      { key: 'B', text: 'よい思い出を作ってくれた花屋のおじさんへの感謝の気持ち' },
      { key: 'C', text: '近所の花屋さんが閉店したので、とても不便だと思う。' },
      { key: 'D', text: '小学校時代にとてもお世話になった先生へのお礼の気持ち' }
    ],
    answerKey: 'B', answerText: 'よい思い出を作ってくれた花屋のおじさんへの感謝の気持ち',
    translation: '作者最想表达的是什么？→ 对创造了美好回忆的花店叔叔的感谢之情。',
    explanation: '文章最后一句是核心「あたたかい思い出を作ってくれたおじさんに、『ありがとう、お疲れ様でした。』と言いたい」意思是"我想对这位一直做美丽花束、给我留下温暖回忆的叔叔说：谢谢您，辛苦了。"所以作者最想表达的是对花店叔叔的感谢。A 只说"寂寞"，不够全面。C 文中没有强调"不方便"。D 老师只是回忆中的一部分，文章真正感谢的是花店叔叔。',
    grammarPoints: ['阅读'], tags: ['阅读理解', '记叙文', '主旨', '2021真题'],
    source: { file: '2021年真题', group: '2021年真题', position: 80 }, status: 'ready'
  }
]

// Merge with existing, validate no duplicate IDs
const existingIds = new Set(existing.map(q => q.id))
for (const q of newQuestions) {
  if (existingIds.has(q.id)) {
    console.error(`Duplicate ID: ${q.id}`)
    process.exit(1)
  }
  q.category = 'grammar'
}

const merged = [...existing, ...newQuestions]
fs.writeFileSync(bankPath, JSON.stringify(merged, null, 2), 'utf-8')
console.log(`Appended ${newQuestions.length} questions. Total: ${merged.length}`)
