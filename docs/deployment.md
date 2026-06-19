# 部署

本项目通过 GitHub Actions 自动部署到 GitHub Pages，push 到 `main` 即触发。

## 线上地址

**https://tianxingleo.top/dlut-nihongo-quiz/**

> 该域名通过 GitHub Pages 的自定义域名配置指向 `tianxingleo.github.io`，仓库 Settings → Pages 中已设置。

## 工作流

| Workflow | 文件 | 触发 | 作用 |
|---|---|---|---|
| CI | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | push 到 `main`、PR 到 `main` | `npm ci` + `npm run build`，验证构建通过 |
| Deploy | [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) | push 到 `main`、手动触发 | 构建 + 上传 Pages artifact + 发布 |

两者都使用 **Node 24**（见 `actions/setup-node@v4` 的 `node-version: 24`）。

## 构建产物

- `npm run build` 先跑 `vue-tsc -b` 做类型检查，再跑 `vite build`
- 输出到 `dist/`
- Vite `base` 在 production 下为 `/dlut-nihongo-quiz/`（dev 下为 `/`），见 [`vite.config.ts`](../vite.config.ts)
- 路由使用 **hash history**（`/#/quiz`），刷新任意子页面都不会 404 —— 这是为了兼容 GitHub Pages 的静态文件服务

## 手动触发部署

如果需要在不 push 的情况下重新部署（比如外部依赖更新），可以：

1. 打开 [Actions 页面](https://github.com/tianxingleo/dlut-nihongo-quiz/actions/workflows/deploy.yml)
2. 选择 `Deploy to GitHub Pages` workflow
3. 点击 `Run workflow` 按钮

## 自定义域名

`tianxingleo.top` 的 DNS 配置：

- A 记录指向 GitHub Pages 的 IP（`185.199.108-111.153`）
- 仓库根目录**不需要** `CNAME` 文件，因为 Pages 设置里直接配置了自定义域名

如果你 fork 后想用自己的域名，需要在仓库 Settings → Pages 里改，并把 `vite.config.ts` 的 `base` 改成对应的路径。

## 本地预览生产构建

```bash
npm run build
npm run preview      # 默认 http://localhost:4173/dlut-nihongo-quiz/
```

`preview` 也会带上 production 的 `base`，所以路径和线上一致。
