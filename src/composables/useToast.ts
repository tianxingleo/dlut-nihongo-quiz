import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  type: 'info' | 'success' | 'error'
  duration: number
}

const toasts = ref<Toast[]>([])
let nextId = 0

export function useToast() {
  function showToast(message: string, type: Toast['type'] = 'info', duration = 2500) {
    const id = nextId++
    toasts.value.push({ id, message, type, duration })
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration)
    }
  }

  function removeToast(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return { toasts, showToast, removeToast }
}
