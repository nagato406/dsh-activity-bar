# dsh-activity-bar

DeepSeek Harness Web GUI 插件：给画面最左侧加一条 **VS Code 风格的活动栏**（独立的窄图标列，
侧栏抽屉在它右边）。工作区、设备、插件、任务看板的入口从侧栏的整行文字行挪进这条列；其它
插件可以通过 `ctx.activityBar` 注册自己的图标与左侧视图。

## 它做什么

- **活动栏图标列（独立容器）**：画面最左一条 44px 图标列（宽度可被主题用
  `--dsh-activity-bar-width` 覆盖），侧栏抽屉在它右边。图标顺序：`工作区` → 侧栏里已有的
  入口行（按它们原本的上下顺序）→ 其它插件注册的条目。收起抽屉时滑走的是抽屉，图标列留在
  原处：它不在抽屉的盒子里，皮肤给侧栏列画的那圈边框也不会把它圈进去。
- **镜像而不是重写**：官方 `sidebar.panellist` 行（插件、任务看板…）与插件注入的入口行
  （`data-dsh-part="sidebar-entry"`，例如 dsh-interconnect 的「设备」、dsh-task-board 的
  「任务看板」）会被**镜像**成图标：图标是原行图标的克隆，点击就是点原行，选中态读原行。
  于是任何现有/未来的入口行自动出现在活动栏里，不需要各自适配。
- **只有「行」看宽态**：侧栏显示宽内容时入口行被镜像、原行让位交还给图标列。浏览器布局里
  收起态会留下外壳自己的 56px 竖条，此时图标列让位，避免两条并排的图标列；桌面布局
  （macOS 与 Windows 标题栏模式）的收起抽屉是零宽，图标列照常留在原处，它就是唯一的导航。
- **视图**：`工作区` 是内建视图（外壳自带的工作区/会话浏览器）。其它视图由注册条目提供，
  激活时官方浏览器隐藏、注册者的内容显示在同一块区域里。
- **点击语义（混合）**：`工作区` 图标切换左侧浏览器（已在该视图时按 VS Code 语义收起侧栏）；
  `插件` / `任务看板` / `设备` 这类图标打开各自的**中间栏面板**（现有页面不动，只是入口挪位）。

## 安装

```sh
# 1) 装进 web profile（本地目录用 link:）
dsh plugin --profile web add link:/path/to/dsh-activity-bar

# 2) 重启 dsh web（bundle 行变化需要重启才生效）
```

也可以直接编辑 profile：在 `~/.dsh/profiles/web/package.json` 的
`dsh.profile.bundles` 里加一行 `@linxin666/dsh-activity-bar`，并让它出现在依赖里
（`"@linxin666/dsh-activity-bar": "link:/path/to/dsh-activity-bar"`）。

## 给插件作者：注册条目

```ts
// 本插件的 apply 里（活动栏是可选依赖，用 ctx.inject 等它的服务）
ctx.inject(['activityBar'], (scoped) => {
  const bar = scoped.get('activityBar')
  if (bar === undefined) return
  scoped.effect(() => bar.register({
    id: 'my-plugin:view',
    label: () => '我的视图',
    icon: '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3">…</svg>',
    kind: 'view',
    view: 'my-plugin:main',
    mountView: (container) => {
      container.append(myNode())
      return () => { /* 清理 */ }
    },
  }), 'my-plugin: activity bar entry')
})
```

- `kind: 'view'` 切左侧视图（`mountView` 往给定容器里画，返回清理函数）。
- `kind: 'action'` 只执行 `activate()`（例如打开你自己的中间栏面板）。
- `active` 可给一个 `{ subscribe, isActive }` 让图标跟随你自己的选中态；不给时视图条目按
  「当前视图是不是它」判断。
- `order` 只在注册条目之间排序（省略按 1000）；镜像行永远排在注册条目之前。

**不要**依赖活动栏一定存在：未安装/未启用时 `ctx.activityBar` 不存在，你的插件应当照常
工作（把 `ctx.inject(['activityBar'], …)` 写成可选增强，而不是放进插件自己的 `inject`）。

## 实现要点（维护者）

- 官方侧栏没有外部插件可注册的槽（`sidebar` 是 single 且被 ui-sidebar 独占），所以这条
  图标列是**注入**到 AppFrame（三列共享的栅格容器）上的：只插入自己的节点，绝不移动或包裹
  React 拥有的节点；用 MutationObserver 自愈（React 重渲染挤掉时在同一帧补回）。
- 挂 AppFrame 而不是侧栏根：侧栏列正是皮肤装饰的目标（皮肤按 `[class*='sidebarCol']` 给整
  列画边框），挂进侧栏根会被算进那圈边框、会随抽屉滑走、还会被列的 `overflow: hidden` 裁掉。
  挂到栅格容器上，图标列靠宿主的 `padding-left` 让出自己那条带：侧栏、会话区、右栏一起右移，
  外壳自己的栅格解算一行都不用改。
- 外壳状态全写在 AppFrame 的属性上：`data-dsh-activity-bar-host`（图标条挂在这里）、
  `-wide`（侧栏正在显示宽内容）、`-view`（自定义视图激活）、`-rail`（外壳竖条接管，图标条
  让位）。隐藏官方行、让出左侧带、隐藏内建浏览器全部走 CSS（见
  `src/client/activity-bar.module.css`）。
- 图标条底色跟随侧栏列**实际画出来的**底色（读它的计算样式），皮肤把整列刷成自己的颜色时
  不会在它旁边留一条突兀的色带；列用渐变或透明时退回 CSS 里的主题 token。
- 自绘图标与镜像图标用 `WeakMap` 记录「写进去的那串标记」再比对：`innerHTML` 回读会被
  重新序列化，拿它比较会导致每次重画都写 DOM、观察者再触发重画，微任务空转。
- `shared/tsdown.client.ts`、`shared/web-platform.ts` 从 dsh-web-ui 的 `shared/` 原样取来
  （与 dsh-interconnect 同一份），浏览器半区打包与平台模块表因此和家族插件一致。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build      # tsc 出 lib/types，tsdown 出 lib/index.js 与 lib/client.js
```

## 已知限制

- 浏览器布局里收起侧栏会把导航交回外壳自己的 56px 竖条，图标列随之让位；桌面布局（收起抽屉
  零宽）则一直留着图标列。
- 图标列占 44px 画面宽度（外壳的栅格解算仍按整个窗口算，所以会话区少这几十像素）；介意居中
  观感时用主题变量调窄图标列。
- 官方行在宽态被 CSS 隐藏（不是卸载），所以它们的行为、选中态与无障碍语义仍然只有一个
  事实来源：原行本身。
- 图标条底部就是画面底部：将来若有外壳版本把自己页脚控件钉在画面左缘，会与图标条下段重叠。
