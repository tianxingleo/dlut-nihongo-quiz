import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(router)
app.mount('#app')

// Service Worker 注册 + 升级提示
// 流程：发现新 SW → 等 installed → 提示用户「新版本可用」→ 用户点刷新 →
//       postMessage SKIP_WAITING → SW 接管 → controllerchange → reload。
// 避免静默拿到旧 SW 控制的页面，也避免不打招呼直接 reload 打断用户答题。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', location.href).href
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          if (!newWorker) return
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // 已有 controller 说明是「升级」，不是首次安装
              showUpdateToast(() => {
                newWorker.postMessage('SKIP_WAITING')
              })
            }
          })
        })
      })
      .catch((err) => console.warn('SW 注册失败:', err))

    // SW 接管后自动刷新一次，让新资源生效
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })
  })
}

function showUpdateToast(onAccept: () => void) {
  if (document.getElementById('sw-update-toast')) return

  // 创建样式元素，使用 CSS 变量以支持暗色/亮色模式
  const style = document.createElement('style')
  style.textContent = `
    #sw-update-toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      background: var(--bg-card, #1a1a18);
      color: var(--text-primary, #fafaf5);
      padding: 10px 14px;
      border: 1px solid var(--accent, #c44536);
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: inherit;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      animation: slide-up 0.3s ease-out;
    }
    #sw-update-toast button {
      background: var(--accent, #c44536);
      color: #fff;
      border: none;
      padding: 5px 12px;
      cursor: pointer;
      font-family: inherit;
      font-size: 13px;
      transition: background 0.2s;
    }
    #sw-update-toast button:hover {
      background: var(--accent-hover, #a83828);
    }
    @keyframes slide-up {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `
  document.head.appendChild(style)

  const toast = document.createElement('div')
  toast.id = 'sw-update-toast'
  toast.setAttribute('role', 'alert')
  toast.textContent = '已发布新版本'
  const btn = document.createElement('button')
  btn.textContent = '立即生效'
  btn.addEventListener('click', () => {
    onAccept()
    toast.remove()
    style.remove()
  })
  toast.appendChild(btn)
  document.body.appendChild(toast)
}
