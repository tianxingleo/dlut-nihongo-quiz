<script setup lang="ts">
import { ref, watch } from 'vue'
import type { TreeNode } from '../../config/courseTree'
import type { Category } from '../../types/question'

const props = defineProps<{
  nodes: TreeNode[]
  activeCategory: Category | null
  activeSubBank: string | null
  currentRoute: string
  isUnlocked: boolean
}>()

const emit = defineEmits<{
  (e: 'select-leaf', payload: { category: Category; subBank: string | null; route?: string }): void
}>()

const expanded = ref<Set<string>>(new Set())

function toggle(key: string) {
  if (expanded.value.has(key)) expanded.value.delete(key)
  else expanded.value.add(key)
  expanded.value = new Set(expanded.value)
}

function isLeafActive(n: TreeNode): boolean {
  if (n.type !== 'leaf') return false
  // 纯路由叶子：比较当前路由
  if (!n.category && n.route) return props.currentRoute === n.route
  if (!n.category) return false
  if (n.category !== props.activeCategory) return false
  if (n.subBank != null && n.subBank !== props.activeSubBank) return false
  return true
}

function clickLeaf(n: TreeNode) {
  if (n.type !== 'leaf') return
  if (n.requireUnlock && !props.isUnlocked) return
  if (n.route) {
    emit('select-leaf', {
      category: n.category ?? props.activeCategory ?? 'japanese2',
      subBank: null,
      route: n.route,
    })
    return
  }
  if (!n.category) return
  emit('select-leaf', { category: n.category, subBank: n.subBank ?? null })
}

function autoExpand() {
  const next = new Set<string>()
  function dfs(nodes: TreeNode[], ancestorKeys: string[] = []): boolean {
    let hit = false
    for (const n of nodes) {
      if (n.type === 'leaf') {
        const catMatch = n.category && n.category === props.activeCategory
        const routeMatch = n.route && n.route === props.currentRoute
        if (catMatch || routeMatch) {
          hit = true
          for (const k of ancestorKeys) next.add(k)
        }
      } else if (n.children?.length) {
        const childHit = dfs(n.children, [...ancestorKeys, n.key])
        if (childHit) {
          next.add(n.key)
          hit = true
        }
      }
    }
    return hit
  }
  dfs(props.nodes)
  expanded.value = new Set([...expanded.value, ...next])
}

watch(
  () => [props.activeCategory, props.currentRoute, props.nodes] as const,
  () => autoExpand(),
  { immediate: true },
)

function shouldRender(n: TreeNode): boolean {
  if (n.requireUnlock && !props.isUnlocked) return false
  return true
}
</script>

<template>
  <ul class="tree-nav" role="tree">
    <template v-for="n in nodes" :key="n.key">
      <li v-if="shouldRender(n)" :class="['tree-node', n.type]">
        <button
          v-if="n.type === 'group'"
          class="tree-row tree-group"
          @click="toggle(n.key)"
          :aria-expanded="expanded.has(n.key)"
        >
          <span class="tree-caret" :class="{ open: expanded.has(n.key) }">▶</span>
          <span v-if="n.icon" class="tree-icon">{{ n.icon }}</span>
          <span class="tree-label">{{ n.label }}</span>
        </button>
        <button
          v-else
          class="tree-row tree-leaf"
          :class="{ active: isLeafActive(n) }"
          @click="clickLeaf(n)"
        >
          <span class="tree-caret placeholder"></span>
          <span v-if="n.icon" class="tree-icon">{{ n.icon }}</span>
          <span class="tree-label">{{ n.label }}</span>
        </button>
        <TreeNav
          v-if="n.type === 'group' && expanded.has(n.key) && n.children?.length"
          :nodes="n.children"
          :active-category="activeCategory"
          :active-sub-bank="activeSubBank"
          :current-route="currentRoute"
          :is-unlocked="isUnlocked"
          @select-leaf="(p) => emit('select-leaf', p)"
        />
      </li>
    </template>
  </ul>
</template>

<style scoped>
.tree-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  user-select: none;
}
.tree-node {
  position: relative;
}
.tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  border-radius: 3px;
  transition:
    background 0.15s var(--ease-ink),
    color 0.15s var(--ease-ink);
}
.tree-row:hover {
  background: var(--bg-hover);
}
.tree-caret {
  display: inline-block;
  width: 12px;
  color: var(--text-muted);
  font-size: 10px;
  transition: transform 0.15s var(--ease-ink);
  flex-shrink: 0;
}
.tree-caret.open {
  transform: rotate(90deg);
}
.tree-caret.placeholder {
  visibility: hidden;
}
.tree-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-hover);
  border-radius: 3px;
  flex-shrink: 0;
}
.tree-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-node.group > .tree-nav {
  padding-left: 18px;
  margin-top: 2px;
}

.tree-leaf.active {
  color: var(--accent);
  font-weight: 500;
  background: var(--bg-hover);
}
.tree-leaf.active .tree-icon {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
</style>
