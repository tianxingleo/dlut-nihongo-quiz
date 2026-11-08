# 题库维护流程

综合日语2的2024年期中A卷使用结构化源 `data/raw/jp1-mid24/reviewed-questions.json`，运行 `npm run parse:japanese2-midterm` 生成网页数据和Markdown存档，再运行 `npm run generate:meta`。原卷95题，当前收录91题，4题待复核；详见 [逐题校对记录](japanese2-2024-midterm-review.md)。该结构化源是此卷的唯一可编辑源，不要直接编辑生成的Markdown或public JSON。

本文档讲怎么加题、改题、加新学科。脚本生成的题库以 `data/raw/` 中的源文件为准，不要直接修改其 `public/*.json`，下次运行 parser 会覆盖。综合日语3单词题库直接维护 `public/japanese3-question-bank.json`。

## 学科分类

| 分类         | Category key | 源 md                                                                                                           | JSON 输出                             | Parser 命令               | 题数（约） |
| ------------ | ------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------- | ---------- |
| 综合日语2    | `japanese2`  | 单词：`data/raw/日语汉字单词选择题-第26-36课.md`<br>语法：`data/raw/日语期末复习题目答案解析_题目选项在上版.md` | `public/japanese2-question-bank.json` | `npm run parse:japanese2` | 963        |
| 综合日语3    | `japanese3`  | `data/raw/japanese3/vocabulary-37-43.md`（来源存档）                                                            | `public/japanese3-question-bank.json` | 直接维护 JSON             | 738        |
| 中国近现代史 | `history`    | `data/raw/history/*.md`                                                                                         | `public/history-question-bank.json`   | `npm run parse:history`   | 2,872      |
| 党史         | `party`      | `data/raw/party/*.md`                                                                                           | `public/party-question-bank.json`     | `npm run parse:party`     | 1,615      |
| 军事理论     | `military`   | `data/raw/military/*.md`                                                                                        | `public/military-question-bank.json`  | `npm run parse:military`  | 407        |

上表旧分类的近似题数仅供参考；实际题数见 `public/_meta.json`（也包含计算机组成各题库）。

## 综合日语3：第37–43课单词

延续综合日语2的结构：每个词条两道四选一（假名选写法、写法选假名），课次为 `w37` 至 `w43`，ID 为 `w37-001-a/b`。入口为「综合日语3 → 单词（第37–43课）」，与期中、期末真题共用学科入口，支持按课复习、随机出题与错题复习。

直接维护 `public/japanese3-question-bank.json`。`data/raw/japanese3/vocabulary-37-43.md` 作为来源存档，保留原书 PDF 物理页、OCR 行序、词性、备注和 StepFun 响应标识，不再自动生成运行时题库。

题库由 StepFun `step-5-preview` 辅助生成。教材中全假名、片假名词及短语按原表记保留；同一个词在不同课出现时按课保留。带 ▲ 的例句并入备注，无教材假名读音的缩写 `JL` 不生成双向题。

平常改题直接修改 JSON 题库，再运行：

```bash
npm run generate:meta
npm run audit:banks
```

改题时保留每个词条两种题型、四个唯一选项及唯一正确答案，并核对原读音/表记一致性与假名选项无汉字。题库审计负责通用结构检查；词条读音和双向题对应关系需人工核对。解析按选项文字组织，前端随机打乱选项后仍对应正确内容。

> **注意**：旧的 `grammar` 和 `word` 分类已合并为 `japanese2`。`public/question-bank.json` 和 `public/word-question-bank.json` 是旧分类的遗留文件，新分类使用 `public/japanese2-question-bank.json`。

## Markdown 题目格式

### 单选题（最常见）

```markdown
### 第N题

[题目正文，可以包含 ( ) 占位符]

A. 选项A
B. 选项B
C. 选项C
D. 选项D

答案：B

解析：[详细解析，为什么 B 是对的、其他选项错在哪]
```

### 多选题

题干末尾写「（多选）」或「（多选）」，答案列出所有正确选项的字母：

```markdown
#### 6. 题干正文（ ）（多选）

A. 选项A
B. 选项B
C. 选项C
D. 选项D

答案：ABC

解析：[为什么 ABC 对、D 错]
```

Parser 会检测到「（多选）」或答案长度 > 1，自动把 `multiAnswer: true`、`questionType: "multi"`。

### 判断题

```markdown
#### 4. 陈述句。（判断正误）

答案：错误

解析：[为什么错]
```

`questionType` 会被标为 `"judgement"`，前端没有选项，只显示对/错两个按钮。

### 块引用语法

历史/党史/军理题库大量使用 Markdown 块引用（`>` 前缀）来组织「刷题单 vs 原始题库」的层级。Parser 会剥掉 `>` 前缀，不影响题号识别：

```markdown
> #### 1. 这是一道被块引用包裹的题
>
> A. 选项A
> B. 选项B
>
> **答案：A**
```

## 完整流程

### 加题 / 改题

```bash
# 1. 编辑对应的 md 文件
$EDITOR data/raw/history/刷题单1-核心必刷（T0）.md

# 2. 跑 parser 重新生成 JSON
npm run parse:history

# 3. 检查验证报告（任意 parser 错误都会在这里反映）
cat data/processed/validation-report.json

# 4. 提交
git add data/raw public/ data/processed/
git commit -m "content: add 3 history questions to T0 list"
```

### 验证报告

`data/processed/validation-report.json` 里包含：

- 总题数
- 检测到的格式异常（孤立选项、缺失答案、重复题干等）
- 跨文件去重命中数（历史/党史/军理的多个刷题单会有重复题，去重是设计行为）

**只要 parser 退出码非 0 就说明有硬错误，必须修了再提交。**

## 新增学科分类

以「想加一个 `english` 分类」为例：

1. **建源目录**：`mkdir data/raw/english/`，把 md 放进去
2. **写 parser**：复制 `scripts/parse-history-markdown.ts` 改名 `parse-english-markdown.ts`，调整正则和分类常量
3. **注册脚本**：在 `package.json` 的 `scripts` 里加 `"parse:english": "tsx scripts/parse-english-markdown.ts"`
4. **扩展类型**：在 [`src/types/question.ts`](../src/types/question.ts) 的 `Category` 联合类型里加 `'english'`
5. **接前端**：在 `src/services/categoryStore.ts`、首页学科卡片、`QuestionCard.vue` 的判断里加新分支
6. **跑 parser、提交**：`npm run parse:english && git add ...`

> 如果新分类只有单选题、没有判断/多选，可以直接复用 `parse-markdown.ts` 的逻辑，但**不要共用 JSON 输出**——每个分类一个独立文件，避免分类切换时全量重载。

## 跨文件去重说明

历史/党史/军理的题库有意保留多个「刷题单」（T0-T5、A/B/C 等），同一道题在不同刷题单里会重复出现。Parser 在生成 JSON 时会按 `题干 + 答案` 的归一化 hash 去重，**仅保留首次出现的版本**，但 `source.file` 会记录它来自哪个刷题单。

这是设计行为，不要当成 bug 修。详见 [`data/raw/history/题目重复分析.md`](../data/raw/history/题目重复分析.md)。
