# 题库维护流程

本文档讲怎么加题、改题、加新学科。**核心原则：`data/raw/*.md` 是唯一可信源，永远不要手改 `public/*.json`** —— 它们是脚本生成的，下次跑 parser 就会被覆盖。

## 五个学科分类

| 分类 | Category key | 源 md | JSON 输出 | Parser 命令 | 题数（约） |
|---|---|---|---|---|---|
| 日语语法 | `grammar` | `data/raw/日语期末复习题目答案解析_题目选项在上版.md` | `public/question-bank.json` | `npm run parse:grammar` | 99 |
| 日语单词 | `word` | `data/raw/日语汉字单词选择题-第26-36课.md` | `public/word-question-bank.json` | `npm run parse:words` | 686 |
| 中国近现代史 | `history` | `data/raw/history/*.md` | `public/history-question-bank.json` | `npm run parse:history` | 2,921 |
| 党史 | `party` | `data/raw/party/*.md` | `public/party-question-bank.json` | `npm run parse:party` | 1,661 |
| 军事理论 | `military` | `data/raw/military/*.md` | `public/military-question-bank.json` | `npm run parse:military` | 737 |

合计 **6,104 题**，其中多选题 1,412 道（历史 838 + 党史 532 + 军事 42）。

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
