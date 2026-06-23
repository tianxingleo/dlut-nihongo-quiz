import { escapeHtml } from './html'

export function renderExplanation(md: string): string {
  const esc = escapeHtml(md)
  return esc.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
}
