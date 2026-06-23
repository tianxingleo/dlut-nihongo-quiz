# SEO 与路由优化记录

## 优化日期
2026-06-23

## 1. 路由模式优化

### 问题
- 原先使用 `createWebHashHistory()`，URL 带 `#`（如 `example.com/#/home`）
- Hash 模式对 SEO 不友好，搜索引擎不会索引 `#` 后的内容

### 解决方案
- 改用 `createWebHistory(import.meta.env.BASE_URL)`，URL 变为 `example.com/home`
- 创建 `public/404.html` 实现 GitHub Pages SPA 重定向
- 在 `index.html` 添加 SPA 重定向处理脚本

### 修改文件
- `src/router/index.ts` - 切换路由历史模式
- `public/404.html` - 新建，GitHub Pages SPA 重定向
- `index.html` - 添加重定向处理脚本

## 2. SEO 基础优化

### 新增文件
- `public/robots.txt` - 搜索引擎爬虫配置
- `public/sitemap.xml` - 站点地图，列出所有页面

### 优化内容
- 完善 `<title>` 标签，包含核心关键词
- 优化 `<meta description>`，更详细且包含关键词
- 添加 `<meta keywords>` 标签
- 添加 `<link rel="canonical">` 规范化 URL

## 3. 社交分享优化

### Open Graph 标签（Facebook、微信等）
- `og:type` - 网站类型
- `og:url` - 页面 URL
- `og:title` - 分享标题
- `og:description` - 分享描述
- `og:locale` - 语言区域
- `og:site_name` - 站点名称

### Twitter Card 标签
- `twitter:card` - 卡片类型
- `twitter:url` - 页面 URL
- `twitter:title` - 分享标题
- `twitter:description` - 分享描述

## 4. 结构化数据

添加 JSON-LD 结构化数据，帮助搜索引擎理解页面内容：
- `@type: WebApplication` - 标识为 Web 应用
- 包含应用名称、描述、分类、作者等信息
- 标明免费应用（price: 0）

## 5. PWA 配置更新

更新 `manifest.json`：
- `start_url` - 改为绝对路径 `/dlut-nihongo-quiz/`
- `scope` - 改为绝对路径 `/dlut-nihongo-quiz/`

## 技术说明

### GitHub Pages SPA 重定向原理

1. 用户访问 `example.com/dlut-nihongo-quiz/home`
2. GitHub Pages 返回 404.html（因为该路径不存在实际文件）
3. 404.html 中的脚本将 URL 重写为 `example.com/dlut-nihongo-quiz/?/home`
4. 重定向到 index.html
5. index.html 中的脚本解析参数，恢复真实 URL
6. Vue Router 接管路由

### 优势
- URL 更美观、更专业
- 对搜索引擎友好，可被正确索引
- 社交分享时显示优化的标题和描述
- 支持 PWA 安装

## 验证方法

部署后可以使用以下工具验证：
1. [Google Rich Results Test](https://search.google.com/test/rich-results) - 测试结构化数据
2. [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) - 测试 Open Graph
3. [Twitter Card Validator](https://cards-dev.twitter.com/validator) - 测试 Twitter Card
4. [Google Search Console](https://search.google.com/search-console) - 监控索引状态
