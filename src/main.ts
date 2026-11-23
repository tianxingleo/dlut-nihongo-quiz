import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)
app.use(router)

// 全局错误兜底：渲染/生命周期中的未捕获异常默认只打到控制台且可能白屏，
// 这里统一捕获并给出可见提示，避免用户无感知地停在坏页面。
app.config.errorHandler = (err, _instance, info) => {
  console.error(`Vue 全局错误（${info}）:`, err)
  showErrorToast('应用出现异常，建议刷新页面')
}

// 开发环境不使用离线缓存。旧页面可能已被之前注册的 SW 接管，
// 注销后必须先重新加载，再挂载答题页面，避免读到旧题库或触发离开答题确认。
async function mountApp() {
  if (import.meta.env.DEV && 'serviceWorker' in navigator) {
    try {
      const scope = new URL(import.meta.env.BASE_URL, location.href).href
      const scriptURL = new URL('sw.js', scope).href
      const registration = await navigator.serviceWorker.getRegistration(scope)
      const isAppWorker =
        registration?.scope === scope &&
        [registration.active, registration.waiting, registration.installing].some(
          (worker) => worker?.scriptURL === scriptURL,
        )
      if (isAppWorker) {
        const removed = await registration.unregister()
        if (!removed) throw new Error('无法注销开发环境的旧 Service Worker')
      }
      if (
        (!registration || isAppWorker) &&
        navigator.serviceWorker.controller?.scriptURL === scriptURL
      ) {
        window.location.reload()
        return
      }
    } catch (error) {
      console.warn('开发环境 Service Worker 清理失败:', error)
    }
  }
  app.mount('#app')
}
void mountApp()

// 未处理的 Promise 拒绝：兜底提示而非静默失败
window.addEventListener('unhandledrejection', (event) => {
  console.error('未处理的 Promise 拒绝:', event.reason)
})

function showErrorToast(message: string) {
  if (document.getElementById('global-error-toast')) return

  const style = document.createElement('style')
  style.textContent = `
    #global-error-toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10001;
      background: var(--bg-card, #1a1a18);
      color: var(--text-primary, #fafaf5);
      border: 1px solid var(--accent, #c44536);
      padding: 10px 14px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: inherit;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      animation: slide-up 0.3s ease-out;
    }
    #global-error-toast button {
      background: var(--accent, #c44536);
      color: #fff;
      border: none;
      padding: 5px 12px;
      cursor: pointer;
      font-family: inherit;
      font-size: 13px;
    }
  `
  document.head.appendChild(style)

  const toast = document.createElement('div')
  toast.id = 'global-error-toast'
  toast.setAttribute('role', 'alert')
  toast.textContent = message
  const btn = document.createElement('button')
  btn.textContent = '刷新'
  btn.addEventListener('click', () => window.location.reload())
  toast.appendChild(btn)
  document.body.appendChild(toast)
}

// Service Worker 注册 + 升级提示
// 流程：发现新 SW → 等 installed → 提示用户「新版本可用」→ 用户点刷新 →
//       postMessage SKIP_WAITING → SW 接管 → controllerchange → reload。
// 避免静默拿到旧 SW 控制的页面，也避免不打招呼直接 reload 打断用户答题。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const scope = new URL(import.meta.env.BASE_URL, location.href)
    const swUrl = new URL('sw.js', scope).href
    let accepted = false
    const offer = (worker: ServiceWorker) =>
      showUpdateToast(() => {
        accepted = true
        worker.postMessage('SKIP_WAITING')
      })
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting)
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          if (!newWorker) return
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // 已有 controller 说明是「升级」，不是首次安装
              offer(newWorker)
            }
          })
        })
      })
      .catch((err) => console.warn('SW 注册失败:', err))

    // SW 接管后自动刷新一次，让新资源生效
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!accepted || refreshing) return
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
