<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Question } from '../types/question'
import { toggleMultiSelect, isMultiAnswerCorrect } from '../utils/multiAnswer'
import TagBadge from './TagBadge.vue'

const props = defineProps<{
  question: Question
  selectedKey: string
  submitted: boolean
  mode: string
  questionIndex: number
  totalQuestions: number
  bookmarked: boolean
}>()

const emit = defineEmits<{
  select: [key: string]
  submit: []
  next: []
  bookmark: []
}>()

const showExplanation = ref(false)

function handleSelect(key: string) {
  if (props.submitted) return
  if (props.question.multiAnswer) {
    emit('select', toggleMultiSelect(props.selectedKey, key))
  } else {
    emit('select', key)
  }
}

const optionLabels = ['A', 'B', 'C', 'D', 'E']

function isSelected(key: string) { return props.selectedKey.includes(key) }
function isCorrectOption(key: string) {
  if (props.question.multiAnswer) {
    return props.submitted && props.question.answerKey.includes(key) && props.selectedKey.includes(key)
  }
  return props.submitted && key === props.question.answerKey
}
function isWrongOption(key: string) {
  if (props.question.multiAnswer) {
    return props.submitted && props.selectedKey.includes(key) && !props.question.answerKey.includes(key)
  }
  return props.submitted && props.selectedKey === key && key !== props.question.answerKey
}
function isMissedOption(key: string) {
  if (!props.question.multiAnswer) return false
  return props.submitted && props.question.answerKey.includes(key) && !props.selectedKey.includes(key)
}

const canSubmit = computed(() => props.selectedKey.length > 0)

const isCorrectOverall = computed(() => {
  if (props.question.multiAnswer) {
    return isMultiAnswerCorrect(props.selectedKey, props.question.answerKey)
  }
  return props.selectedKey === props.question.answerKey
})

const subTypeLabel = computed(() => {
  if (props.question.questionType === 'multi') return '多选'
  if (props.question.questionType === 'judgement') return '判断'
  if (props.question.questionType === 'single') return '单选'
  if (props.question.subType === 'kana-to-kanji') return '选汉字'
  if (props.question.subType === 'kanji-to-kana') return '选假名'
  return ''
})

const tagsSectionTitle = computed(() => props.question.category === 'word' ? '标签' : '考点')
</script>
<template>
  <div class="question-card">
    <div class="q-header">
      <span class="q-id">{{ question.id }}</span>
      <span class="q-group">{{ question.groupTitle }}</span>
      <span class="q-sub" v-if="subTypeLabel">{{ subTypeLabel }}</span>
      <span class="q-mode">{{ mode }}</span>
    </div>

    <div class="q-stem" v-text="question.stem" />
    <div class="q-hint" v-if="question.multiAnswer">多选，请勾选所有正确选项</div>

    <div class="q-options">
      <button
        v-for="(opt, i) in question.options" :key="opt.key"
        :class="[
          'opt-btn',
          {
            selected: isSelected(opt.key),
            correct: isCorrectOption(opt.key),
            wrong: isWrongOption(opt.key),
            missed: isMissedOption(opt.key),
            multi: !!question.multiAnswer,
          }
        ]"
        @click="handleSelect(opt.key)"
        :disabled="submitted"
      >
        <span class="opt-key">{{ optionLabels[i] }}</span>
        <span class="opt-text">{{ opt.text }}</span>
        <span v-if="isCorrectOption(opt.key)" class="opt-icon c">&#10003;</span>
        <span v-if="isWrongOption(opt.key)" class="opt-icon w">&#10007;</span>
        <span v-if="isMissedOption(opt.key)" class="opt-icon m">&middot;</span>
      </button>
    </div>

    <div class="q-actions" v-if="!submitted">
      <button class="btn btn-submit" :disabled="!canSubmit" @click="emit('submit')">提交答案</button>
    </div>
    <div class="q-actions" v-else>
      <button class="btn btn-submit" @click="emit('next')">
        {{ questionIndex >= totalQuestions - 1 ? '完成' : '下一题' }}
      </button>
      <button class="btn btn-ghost" :class="{ 'bookmark-active': bookmarked }" @click="emit('bookmark')">
        {{ bookmarked ? '已收藏' : '收藏' }}
      </button>
      <button class="btn btn-ghost" @click="showExplanation = !showExplanation">
        {{ showExplanation ? '收起解析' : '查看解析' }}
      </button>
    </div>

    <div class="q-result" v-if="submitted">
      <div class="result-line" :class="isCorrectOverall ? 'correct' : 'wrong'">
        <span class="result-badge">{{ isCorrectOverall ? '正确' : '错误' }}</span>
        答案：<strong>{{ question.answerKey }}<span v-if="question.answerText">. {{ question.answerText }}</span></strong>
      </div>
    </div>

    <div class="q-explanation" v-if="submitted && showExplanation">
      <div class="exp-section" v-if="question.headword">
        <h4>词条</h4>
        <p>{{ question.headword }}</p>
      </div>
      <div class="exp-section" v-if="question.translation">
        <h4>中文翻译</h4>
        <p>{{ question.translation }}</p>
      </div>
      <div class="exp-section" v-if="question.tags.length > 0">
        <h4>{{ tagsSectionTitle }}</h4>
        <div class="tag-list">
          <TagBadge v-for="t in question.tags" :key="t" :tag="t" />
        </div>
      </div>
      <div class="exp-section">
        <h4>解析</h4>
        <div class="exp-text" v-html="question.explanation.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')" />
      </div>
    </div>
  </div>
</template>
<style scoped>
.question-card {
  background: var(--bg-card); border: 1px solid var(--border);
  padding: 28px; max-width: 720px; margin: 0 auto;
}

/* Header */
.q-header { display: flex; gap: 12px; margin-bottom: 20px; font-size: 13px; align-items: center; }
.q-id { color: var(--accent); font-weight: 600; font-family: var(--font-mono); }
.q-group { color: var(--text-secondary); }
.q-sub {
  padding: 1px 8px; border: 1px solid var(--border);
  color: var(--text-secondary); font-size: 11px;
}
.q-mode { color: var(--text-muted); margin-left: auto; }

/* Stem */
.q-stem { font-size: 18px; line-height: 1.7; color: var(--text-primary); margin-bottom: 14px; }
.q-hint { font-size: 13px; color: var(--text-muted); margin-bottom: 18px; }

/* Options */
.q-options { display: flex; flex-direction: column; gap: 8px; }
.opt-btn {
  display: flex; align-items: center; gap: 14px; padding: 12px 16px;
  border: 1px solid var(--border); background: var(--bg-card);
  cursor: pointer; transition: all .12s; text-align: left; font-size: 15px;
  color: var(--text-primary);
  border-left: 3px solid transparent;
}
.opt-btn:hover:not(:disabled) { background: var(--bg-hover); }
.opt-btn.selected { border-left-color: var(--accent); background: var(--bg-hover); }
.opt-btn.correct { border-left-color: var(--correct); background: #f0f7f3; }
.opt-btn.wrong { border-left-color: var(--wrong); background: #fdf5f4; }
.opt-btn.missed { border-left-color: var(--warning); background: #fefdf6; border-left-style: dashed; }
.opt-key {
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  font-weight: 600; font-size: 12px; flex-shrink: 0; color: var(--text-muted);
  border: 1px solid var(--border); font-family: var(--font-mono);
}
.opt-btn.selected .opt-key { border-color: var(--accent); color: var(--accent); }
.opt-btn.multi .opt-key { border-radius: 0; }
.opt-text { flex: 1; }
.opt-icon { font-weight: 700; font-size: 15px; min-width: 20px; text-align: center; }
.opt-icon.c { color: var(--correct); }
.opt-icon.w { color: var(--wrong); }
.opt-icon.m { color: var(--warning); font-size: 20px; }

/* Actions */
.q-actions { display: flex; gap: 8px; margin-top: 22px; }
.btn-submit { padding: 9px 22px; border: 1px solid var(--border); font-size: 14px; transition: all .12s; background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-submit:disabled { opacity: .35; cursor: not-allowed; }
.btn-submit:hover:not(:disabled) { background: var(--accent-hover); }
.bookmark-active { color: var(--warning); border-color: var(--warning); background: #fefdf6; }

/* Result */
.q-result { margin-top: 18px; }
.result-line {
  font-size: 15px; padding: 10px 14px; border-left: 3px solid;
}
.result-line.correct { border-left-color: var(--correct); background: #f0f7f3; color: var(--correct); }
.result-line.wrong { border-left-color: var(--wrong); background: #fdf5f4; color: var(--wrong); }
.result-badge { font-weight: 600; margin-right: 4px; }

/* Explanation */
.q-explanation { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border); }
.exp-section { margin-bottom: 14px; }
.exp-section h4 { font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; font-weight: 600; }
.exp-text { font-size: 14px; color: var(--text-secondary); line-height: 1.75; max-height: 420px; overflow-y: auto; }
.tag-list { display: flex; flex-wrap: wrap; }
</style>
