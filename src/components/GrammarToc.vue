<script setup lang="ts">
import { computed, ref } from 'vue'

interface TocItem {
  id: string
  text: string
  level: 2 | 3
}

interface TocSection {
  item: TocItem
  children: TocItem[]
}

const props = defineProps<{
  items: TocItem[]
  activeId: string
}>()

const emit = defineEmits<{
  navigate: [id: string]
}>()

const collapsed = ref<Record<string, boolean>>({})

const sections = computed<TocSection[]>(() => {
  const result: TocSection[] = []
  let current: TocSection | null = null
  for (const item of props.items) {
    if (item.level === 2) {
      if (current) result.push(current)
      current = { item, children: [] }
    } else if (current) {
      current.children.push(item)
    }
  }
  if (current) result.push(current)
  return result
})

function toggle(id: string) {
  collapsed.value = { ...collapsed.value, [id]: !collapsed.value[id] }
}

function isActive(id: string) {
  return props.activeId === id
}
</script>
<template>
  <nav class="grammar-toc" aria-label="语法目录">
    <div class="toc-header">目录</div>
    <ul class="toc-list">
      <template v-for="section in sections" :key="section.item.id">
        <li
          :class="['toc-item', 'level-2', 'toc-section', { active: isActive(section.item.id) }]"
        >
          <div class="toc-section-head">
            <button
              type="button"
              class="toc-link toc-parent"
              :title="section.item.text"
              @click="emit('navigate', section.item.id)"
            >
              {{ section.item.text }}
            </button>
            <button
              v-if="section.children.length"
              type="button"
              class="toc-toggle"
              :class="{ open: !collapsed[section.item.id] }"
              @click.stop="toggle(section.item.id)"
              :aria-label="collapsed[section.item.id] ? '展开' : '折叠'"
            >
              <span class="toggle-icon" />
            </button>
          </div>
          <ul
            v-if="section.children.length"
            class="toc-children"
            :class="{ collapsed: collapsed[section.item.id] }"
          >
            <li
              v-for="child in section.children"
              :key="child.id"
              :class="['toc-item', 'level-3', { active: isActive(child.id) }]"
            >
              <button
                type="button"
                class="toc-link"
                :title="child.text"
                @click="emit('navigate', child.id)"
              >
                {{ child.text }}
              </button>
            </li>
          </ul>
        </li>
      </template>
    </ul>
  </nav>
</template>
<style scoped>
.grammar-toc {
  font-size: 13px;
  padding-right: 4px;
}
.toc-header {
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 10px;
  padding-left: 12px;
}
.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-left: 1px solid var(--border);
}
.toc-item {
  margin: 0;
}

.toc-section-head {
  display: flex;
  align-items: center;
}
.toc-parent {
  flex: 1;
  min-width: 0;
}

.toc-toggle {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  margin-right: 2px;
  font-size: 10px;
  line-height: 1;
  transition: color 0.12s;
}
.toc-toggle:hover {
  color: var(--text-primary);
}
.toggle-icon {
  display: inline-block;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  transition: transform 0.15s;
}
.toc-toggle.open .toggle-icon {
  transform: rotate(-180deg);
}

.toc-link {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  padding: 5px 12px;
  cursor: pointer;
  transition:
    color 0.12s,
    background 0.12s;
  border-left: 2px solid transparent;
  margin-left: -1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toc-link:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.toc-item.active > .toc-section-head > .toc-parent,
.toc-item.active > .toc-link {
  color: var(--accent);
  font-weight: 500;
  border-left-color: var(--accent);
}
.toc-children {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
  max-height: 600px;
}
.toc-children.collapsed {
  max-height: 0;
}
.toc-item.level-3 > .toc-link {
  font-size: 12px;
  padding-left: 24px;
  color: var(--text-muted);
}
.toc-item.level-3.active > .toc-link {
  color: var(--accent);
}

@media (max-width: 959px) {
  .grammar-toc {
    display: none;
  }
}
</style>
