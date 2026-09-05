# The Mind Map — Obsidian 社区插件（Markdown 渲染层）

## 项目概览

- 目标：Obsidian 社区插件（TypeScript → 打包为 JavaScript）。
- 定位：**Markdown 渲染层**——`.mindmap.md` 是 100% 标准 Markdown（frontmatter + 标题 + 列表），插件解析为思维导图、编辑后无损回写为 Markdown；无任何专有格式。
- 入口：`src/main.ts`，编译为 `main.js`，由 Obsidian 加载。
- 发布产物：`main.js`、`manifest.json`、`styles.css`。
- 插件标识：`id: mindmap`（安装目录 `<vault>/.obsidian/plugins/mindmap/`）。
- 引擎：`simple-mind-map 0.14.0-fix.3`，以压缩产物 vendor 于 `vendor/simple-mind-map.cjs`（附手写类型声明 `vendor/simple-mind-map.d.cts`）。引擎 CSS vendor 于 `vendor/simple-mind-map.css`，已合并进根目录 `styles.css`。

## 环境与工具

- Node.js：当前 LTS（Node 18+）。
- 包管理器：npm。
- 打包器：esbuild（`esbuild.config.mjs`）。
- 类型：`obsidian` 类型定义。

### 安装

```bash
npm install
```

### 开发（watch）

```bash
npm run dev
```

### 生产构建

```bash
npm run build
```

### 手工安装（测试）

将 `main.js`、`manifest.json`、`styles.css` 复制到：

```
<Vault>/.obsidian/plugins/mindmap/
```

重载 Obsidian，在「设置 → 第三方插件」启用。

## 代码结构

```
src/
  main.ts        # 插件入口：生命周期、视图注册、command/file-menu/hover 源、文件事件同步
  view.ts        # 视图核心：加载/保存（md 往返）、布局/视口状态、标题重命名、引用更新
  md-outline.ts  # Markdown 大纲 → 导图树（frontmatter 跳过、标题/列表、行内 token；mdRaw 保真）
  md-serialize.ts# 导图树 → Markdown（未编辑逐字回写/编辑合成；链接/图片新增检测）
  md-open.ts     # .mindmap.md 触发判定、视图切换、打开方式偏好钩子
  view-wikilink.ts # wikilink 悬停预览 + Ctrl/Cmd+点击（与 Obsidian 阅读视图对齐）
  view-state.ts  # 按文件路径持久化布局/视口/openAs 到插件 data.json
  view-*.ts      # 工具栏/拖拽/右键/搜索/导出/状态栏/备注浮层/图片灯箱
  modal-*.ts     # 链接/图片/命名弹窗（官方 AbstractInputSuggest 联想）
  images-*.ts    # 图片解析/索引/保存（库内路径 ↔ 资源地址）、尺寸校正
  links-*.ts     # 库内文件解析、树内引用更新（重命名/删除）
  settings.ts    # 设置接口与设置面板（Obsidian 1.13+ 声明式）
  codeblock.ts   # ```mindmap 代码块渲染（Markdown 大纲）
docs/
  markdown-mindmap-standard.md  # Markdown ↔ 思维导图映射规则（权威标准）
scratch/
  md-roundtrip/                  # 往返回归测试：解析结构/层级深度/不动点/编辑合成
                                 #   运行：node scratch/md-roundtrip/build-test.mjs
```

## 关键约定

- 渲染层定位：正文保持纯 Markdown；布局/视口/打开偏好存 `data.json`（`viewState`，按文件路径），不写入文件。
- 中心主题 ⇄ 文件名：编辑根节点文本会重命名 `.mindmap.md`（Obsidian 原生更新链接/反链）；外部改名后视图重载中心随新名。
- 图片/链接对齐 Obsidian：`![[路径]]`/`[[笔记]]` 往返；插入弹窗联想库内文件；悬停预览用 `registerHoverLinkSource` + `hover-link`。
- 所有 DOM/事件/定时器监听使用 `this.register*` 助手注册，保证卸载清理；引擎实例事件经 `EventBinder` 记录统一销毁。
- 引擎 vendor 文件不可手工编辑；升级时用官方源码重新打包并替换。

## 发布流程

1. 更新 `manifest.json` 版本号 → `npm version patch|minor|major`（同步 `versions.json`）。
2. 创建与版本号完全一致的 GitHub Release tag（不带 `v` 前缀）。
3. 附加 `main.js`、`manifest.json`、`styles.css`（`.github/workflows/release.yml` 自动构建并创建草稿 Release）。

## 安全与合规

- 默认本地/离线运行；无遥测、不上传 vault 内容。
- 遵循 Obsidian 开发者政策与插件指南（`isDesktopOnly: true`，minAppVersion 1.13.0）。
