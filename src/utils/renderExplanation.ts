export function renderExplanation(md: string): string {
  const esc = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  return esc.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
}
