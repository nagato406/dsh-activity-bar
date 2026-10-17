/**
 * 活动栏引擎（纯 DOM，无 React 树）。
 *
 * 形态是 VS Code 的活动栏：**左侧一条独立的窄图标列**，侧栏抽屉在它右边，收起抽屉时
 * 图标列留在原地。官方侧栏没有外部插件可注册的槽（`sidebar` 是 single 且被 ui-sidebar
 * 独占，内层席位同样是 single），所以这条列是**注入**进去的，与 dsh-web-ui 家族的侧栏
 * 行、dsh-interconnect 的设备行同一套做法：只插入自己的节点，绝不移动或包裹 React 拥有
 * 的节点；用 MutationObserver 自愈，React 重渲染把节点挤掉时在同一帧（绘制前的微任务）
 * 补回。
 *
 * 挂在 AppFrame（三个栅格列的共同父节点）上而不是侧栏根里：侧栏列是皮肤的装饰目标
 * （皮肤按 `[class*='sidebarCol']` 给整列画金边），挂进侧栏根会被算进那圈边框，还会随
 * 抽屉一起滑走、被列的 `overflow: hidden` 裁掉。挂到栅格上则靠该容器的
 * `padding-left` 让出左侧一条带：侧栏、会话区、右栏一起右移，外壳自己的栅格解算不用改
 * 一行，图标列也就成了与抽屉行为无关的独立容器。
 *
 * 图标从哪来：官方 `sidebar.panellist` 行（React 渲染）与插件注入的入口行
 * （`data-dsh-part="sidebar-entry"`）都会被镜像成图标，按文档顺序排列 —— 于是
 * 「设备 / 插件 / 任务看板」那排行原样变成图标列，且以后任何新入口行自动跟上。
 * 两条选择器会命中同一个按钮（插件行本身就注入在面板列表里；皮肤的语义属性表又给带
 * 面板字形的官方行盖上 `sidebar-entry`），所以按元素去重，一个入口只出一个图标。
 *
 * 抽屉跟着页面走：镜像行打开的是中心栏页面，点完把抽屉收起；注册的 `view` 条目画在
 * 抽屉里，点开先展开；工作区图标回到抽屉里的浏览器。图标列里只有当前那块亮着 ——
 * 主面板被选中时工作区图标不再高亮（选中态仍是原行的 `aria-current` / `data-active`，
 * 镜像只读它）。
 *
 * 收起态：外壳收起侧栏有两种布局 —— 零宽（macOS 桌面与 Windows 标题栏模式，侧栏整列
 * 消失，没有可见的竖条）与 56px 竖条（普通浏览器里外壳自带的图标列）。零宽时图标条照常
 * 显示（此时它是唯一的导航），竖条时让位，避免两条并排的图标列；判定见
 * `collapseKeepsRail`。两种情况都靠 AppFrame 上的标记属性、纯 CSS 生效。
 *
 * 视图：`workspace` 是内建视图（外壳自带的工作区浏览器，默认显示）。其他视图由注册
 * 条目提供 `mountView(container)`，挂载到注入进工作区区域的容器里；此时用
 * `data-dsh-activity-bar-view` 把官方浏览器隐藏（槽锚点带内联 `display: contents`，
 * 所以必须 `!important`）。
 */
import { FALLBACK_ICON, WORKSPACE_ICON } from './icons.ts'
import type { ActivityBarItem } from './types.ts'

/** 侧栏列：AppFrame 的栅格项（同时也是 `data-pane="sidebar"` 的来源）。 */
const COLUMN_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"]'
/** 官方面板行：侧栏把 `sidebar.panellist` 的条目渲染成的按钮。 */
const PANEL_ROW_SELECTOR = 'nav[class*="panelList"] button'
/** 插件注入的入口行：L2 语义属性约定（sidebar-entry-core 的 `plugin` 选项）。 */
const ENTRY_ROW_SELECTOR = '[data-dsh-part="sidebar-entry"]'
/** 工作区浏览区域：自定义视图容器挂在它里面。 */
const REGION_SELECTOR = '[class*="regionArea"]'

/** AppFrame 上的挂载标记：本属性在时图标条是它的子节点，CSS 据此让出左侧一条带。 */
export const HOST_ATTRIBUTE = 'data-dsh-activity-bar-host'
/** AppFrame 上的宽态标记：侧栏正在显示宽内容（它的入口行已被镜像进图标条）。 */
export const WIDE_ATTRIBUTE = 'data-dsh-activity-bar-wide'
/** AppFrame 上的竖条让位标记：收起态由外壳自己的 56px 竖条承担导航，图标条隐藏。 */
export const RAIL_ATTRIBUTE = 'data-dsh-activity-bar-rail'
/** AppFrame 上的当前视图标记，值即视图 id；自定义视图激活时它隐藏官方浏览器。 */
export const VIEW_ATTRIBUTE = 'data-dsh-activity-bar-view'
/** 图标条自身的标记属性。 */
export const STRIP_ATTRIBUTE = 'data-dsh-activity-bar'
/** 自定义视图容器的标记属性。 */
export const VIEW_HOST_ATTRIBUTE = 'data-dsh-activity-bar-view-host'
/** 每个活动栏按钮上的条目 id。 */
export const ITEM_ATTRIBUTE = 'data-dsh-activity-bar-item'
/** 内建视图 id：外壳自带的工作区浏览器。 */
export const WORKSPACE_VIEW = 'workspace'
/** 注册条目的默认排序位（镜像行占 0..999）。 */
const DEFAULT_ITEM_ORDER = 1000
/** 计算样式里的「完全透明」：这时不覆盖图标条自己的底色。 */
const TRANSPARENT_COLOUR = /^rgba?\(0, 0, 0, 0\)$/

/** 活动栏驱动的外壳布局面（`ctx.layout` 的最小子集）。 */
export interface ActivityBarLayoutFace {
  /** 展开/收起左侧栏。 */
  toggleSidebar(): void
  /**
   * 选中某个主面板（中心栏页面）；传 `null` 把主面板选择交还会话视图。
   *
   * 省略时不碰主面板选择：活动栏仍能切视图与开合抽屉，只是「当前页面」的复位靠外壳
   * 自己的行为。
   */
  selectPanel?(panelId: string | null): void
}

/** 活动栏自绘条目的文案。 */
export interface ActivityBarLabels {
  /** 图标列整体的无障碍名称。 */
  bar(): string
  /** 工作区视图的悬浮说明与无障碍名称。 */
  workspace(): string
}

/** 挂载活动栏所需的全部外部输入。 */
export interface ActivityBarOptions {
  /** L2 语义属性插件 id：图标条输出 `data-dsh-plugin`。 */
  plugin: string
  /** CSS Module 类名表。 */
  css: Record<string, string>
  /** 自绘条目文案。 */
  labels: ActivityBarLabels
  /** 外壳布局面。 */
  layout: ActivityBarLayoutFace
  /** 语言切换订阅：切换后重画文案（纯 DOM 条目否则会留住挂载时的文案）。 */
  locale?: { subscribe(listener: () => void): () => void }
}

/** 活动栏句柄：注册表与视图控制的程序化入口。 */
export interface ActivityBarHandle {
  /** 注册一条条目；返回注销器。 */
  register(item: ActivityBarItem): () => void
  /** 切换左侧视图。 */
  openView(view: string): void
  /** 当前视图 id。 */
  activeView(): string
  /** 重画一次。 */
  refresh(): void
  /** 卸下图标条、视图容器、观察者与订阅。 */
  dispose(): void
}

/** 一条待渲染的图标：镜像行、内建项与注册条目在渲染前统一成这个形状。 */
interface RenderEntry {
  /** 稳定 key（DOM 复用与条目 id）。 */
  key: string
  /** 无障碍名称与悬浮提示。 */
  label: string
  /** 内联 SVG 标记。 */
  icon: string
  /** 是否选中。 */
  active: boolean
  /** 点击动作。 */
  activate: () => void
}

/** 侧栏列元素，或外壳尚未渲染时的 undefined。 */
function sidebarColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(COLUMN_SELECTOR) ?? undefined
}

/** 侧栏 UI 根：拥有 logo 行的那个元素（与家族共享内核同一套定位约定）。 */
function sidebarRoot(column: HTMLElement): HTMLElement | undefined {
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | null) ?? undefined
}

/**
 * 收起态下外壳是否还自带 56px 竖条。
 *
 * 抄的是 AppFrame 的收起宽度规则（`collapsedWidth = darwin || windowsTitlebar ? 0 :
 * SIDEBAR_COLLAPSED`）：桌面外壳收起时侧栏整列消失，浏览器里则留下一条 56px 竖条，那
 * 条竖条自己就是图标列。零宽时活动栏必须留下（它是唯一的导航），有竖条时让位。
 * @returns 收拾起态会留下外壳自己的竖条时为 true。
 */
function collapseKeepsRail(): boolean {
  return !document.documentElement.hasAttribute('data-windows-titlebar')
    && document.documentElement.dataset['platform'] !== 'darwin'
}

/** 文档顺序比较器：镜像行按用户看到的顺序排列。 */
function documentOrder(left: HTMLElement, right: HTMLElement): number {
  if (left === right) return 0
  return (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? -1 : 1
}

/** 记录每个按钮当前画上去的图标标记：`innerHTML` 回读会被重新序列化（自闭合标签、
 * 属性顺序），拿它跟输入串比较永远不相等，于是每次重画都写一次 DOM、观察者再触发一次
 * 重画 —— 微任务会一直空转。所以比对的是「写进去的那串标记」本身。 */
const appliedIcons = new WeakMap<HTMLElement, string>()

/**
 * 挂载活动栏。
 * @param options - 语义属性、类名、文案、布局面与语言订阅。
 * @returns 注册表与视图控制句柄；调用方负责在销毁时调用 `dispose()`。
 */
export function mountActivityBar(options: ActivityBarOptions): ActivityBarHandle {
  const registered: ActivityBarItem[] = []
  const activeDisposers = new Map<ActivityBarItem, () => void>()
  let view = WORKSPACE_VIEW
  let disposed = false
  let rendering = false
  let scheduled = false
  let root: HTMLElement | undefined
  let column: HTMLElement | undefined
  let frame: HTMLElement | undefined
  let disposeViewMount: (() => void) | undefined
  /** 本次渲染出来的条目（key → 条目），点击派发时按 id 查。 */
  const live = new Map<string, RenderEntry>()

  const strip = document.createElement('nav')
  strip.setAttribute(STRIP_ATTRIBUTE, '')
  strip.setAttribute('data-dsh-plugin', options.plugin)
  strip.setAttribute('data-dsh-part', 'activity-bar')
  strip.className = options.css['strip'] ?? ''

  const viewHost = document.createElement('div')
  viewHost.setAttribute(VIEW_HOST_ATTRIBUTE, '')
  viewHost.setAttribute('data-dsh-plugin', options.plugin)
  viewHost.setAttribute('data-dsh-part', 'activity-bar-view')
  viewHost.className = options.css['viewHost'] ?? ''

  /** 注册条目按 (order, 注册顺序) 排序。 */
  const sortedItems = (): ActivityBarItem[] => registered
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (left.item.order ?? DEFAULT_ITEM_ORDER) - (right.item.order ?? DEFAULT_ITEM_ORDER) || left.index - right.index)
    .map(entry => entry.item)

  /**
   * 镜像行在图标列里的稳定 key：插件自己打的 `data-dsh-plugin` 优先，其次是面板字形上
   * 的 `data-dsh-panel-entry`（官方行没有别的钩子），最后退回文案。
   */
  const rowKey = (row: HTMLElement, label: string): string => {
    const plugin = row.getAttribute('data-dsh-plugin')
    if (plugin !== null) return `entry:${plugin}`
    const glyph = row.querySelector('[data-dsh-panel-entry]')?.getAttribute('data-dsh-panel-entry')
    return glyph === undefined || glyph === null || glyph === '' ? `panel:${label}` : `panel:${glyph}`
  }

  /** 镜像一条侧栏入口行：官方行与插件注入行都走这里。 */
  const mirror = (row: HTMLElement): RenderEntry => {
    const label = row.getAttribute('aria-label') ?? row.textContent?.trim() ?? ''
    return {
      key: rowKey(row, label),
      label,
      icon: row.querySelector('svg')?.outerHTML ?? FALLBACK_ICON,
      // 官方行的选中态是 `aria-current="page"`，注入行是 `data-active="true"`；皮肤把
      // `sidebar-entry` 语义属性盖到官方行上之后两者会同时出现，任一成立即选中。
      active: row.getAttribute('aria-current') === 'page' || row.dataset['active'] === 'true',
      activate: () => { activateMirrored(row) },
    }
  }

  /** 收集需要镜像的行：插件注入行 + 官方面板行，按文档顺序；重复 key 追加序号。 */
  const mirrors = (sidebarRootElement: HTMLElement): RenderEntry[] => {
    const rows: HTMLElement[] = [
      ...sidebarRootElement.querySelectorAll<HTMLElement>(ENTRY_ROW_SELECTOR),
      ...sidebarRootElement.querySelectorAll<HTMLElement>(PANEL_ROW_SELECTOR),
    ]
    // 同一个按钮会被两个选择器同时命中：插件行本来就注入在 `nav.panelList` 里，皮肤又给
    // 带面板字形的官方行盖上了 `data-dsh-part="sidebar-entry"`（skin-center 的语义属性
    // 表）。按元素去重，一个入口只出一个图标。
    const unique = [...new Set(rows)].sort(documentOrder)
    const used = new Set<string>()
    return unique.map((row) => {
      const entry = mirror(row)
      let key = entry.key
      for (let suffix = 1; used.has(key); suffix++) key = `${entry.key}#${String(suffix)}`
      used.add(key)
      return { ...entry, key }
    })
  }

  /** 把条目按 key 同步进图标条：复用在位按钮，只写变化的部分。 */
  const paint = (entries: readonly RenderEntry[]): void => {
    live.clear()
    const reusable = new Map<string, HTMLButtonElement>()
    for (const child of Array.from(strip.children)) {
      if (!(child instanceof HTMLButtonElement)) continue
      const key = child.getAttribute(ITEM_ATTRIBUTE)
      if (key !== null) reusable.set(key, child)
    }
    const ordered: HTMLButtonElement[] = []
    for (const entry of entries) {
      live.set(entry.key, entry)
      let button = reusable.get(entry.key)
      if (button === undefined) {
        button = document.createElement('button')
        button.type = 'button'
        button.setAttribute(ITEM_ATTRIBUTE, entry.key)
        button.setAttribute('data-dsh-plugin', options.plugin)
        button.setAttribute('data-dsh-part', 'activity-bar-item')
        button.className = options.css['item'] ?? ''
        const glyph = document.createElement('span')
        glyph.className = options.css['icon'] ?? ''
        button.append(glyph)
      } else {
        reusable.delete(entry.key)
      }
      if (button.getAttribute('aria-label') !== entry.label) button.setAttribute('aria-label', entry.label)
      if (button.getAttribute('title') !== entry.label) button.setAttribute('title', entry.label)
      if (entry.active) {
        if (button.getAttribute('data-active') !== 'true') button.setAttribute('data-active', 'true')
        if (button.getAttribute('aria-current') !== 'page') button.setAttribute('aria-current', 'page')
      } else {
        if (button.hasAttribute('data-active')) button.removeAttribute('data-active')
        if (button.hasAttribute('aria-current')) button.removeAttribute('aria-current')
      }
      const glyph = button.firstElementChild
      if (glyph instanceof HTMLElement && appliedIcons.get(button) !== entry.icon) {
        glyph.innerHTML = entry.icon
        appliedIcons.set(button, entry.icon)
      }
      ordered.push(button)
    }
    for (const stale of reusable.values()) stale.remove()
    ordered.forEach((button, index) => {
      const current = strip.children[index] ?? null
      if (current !== button) strip.insertBefore(button, current)
    })
  }

  /**
   * 把视图标记与宽态写到 AppFrame 上：官方行让位、图标条占位、竖条让位全按这些属性
   * 生效（见 activity-bar.module.css）。
   */
  const syncState = (): void => {
    if (frame === undefined) return
    const wide = !frame.hasAttribute('data-sidebar-collapsed')
    frame.toggleAttribute(WIDE_ATTRIBUTE, wide)
    frame.toggleAttribute(RAIL_ATTRIBUTE, !wide && collapseKeepsRail())
    if (view === WORKSPACE_VIEW) frame.removeAttribute(VIEW_ATTRIBUTE)
    else frame.setAttribute(VIEW_ATTRIBUTE, view)
  }

  /**
   * 图标条底色跟随侧栏列实际画出来的底色：皮肤会把整列重刷成自己的颜色，写死主题
   * token 会让图标条在皮肤下成为一条突兀的色带。列用渐变或透明时退回 CSS 里的 token。
   */
  const paintBackdrop = (): void => {
    if (column === undefined || !column.isConnected) return
    const colour = getComputedStyle(column).backgroundColor
    const next = colour === '' || colour === 'transparent' || TRANSPARENT_COLOUR.test(colour) ? '' : colour
    if (strip.style.backgroundColor !== next) strip.style.backgroundColor = next
  }

  /** 重画：图标条内容 + 外壳状态标记 + 底色。 */
  const render = (): void => {
    if (disposed || rendering) return
    const current = root
    if (current === undefined) return
    rendering = true
    try {
      const barLabel = options.labels.bar()
      if (strip.getAttribute('aria-label') !== barLabel) strip.setAttribute('aria-label', barLabel)
      syncState()
      paintBackdrop()
      const entries: RenderEntry[] = [
        {
          key: WORKSPACE_VIEW,
          label: options.labels.workspace(),
          icon: WORKSPACE_ICON,
          active: view === WORKSPACE_VIEW && !panelSelected(),
          activate: activateWorkspace,
        },
        ...mirrors(current),
      ]
      for (const item of sortedItems()) {
        entries.push({
          key: item.id,
          label: item.label(),
          icon: item.icon ?? FALLBACK_ICON,
          active: item.active !== undefined
            ? item.active.isActive()
            : item.kind === 'view' && item.view !== undefined && item.view === view,
          activate: () => { activateItem(item) },
        })
      }
      paint(entries)
    } finally {
      rendering = false
    }
  }

  /** 合并同一帧内的多次触发：观察者回调本身就是微任务，这里再排队一次仍在绘制前。 */
  const schedule = (): void => {
    if (disposed || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      render()
    })
  }

  /** 把图标条放进 AppFrame、把视图容器放回工作区区域（React 重渲染后自愈）。 */
  const place = (): void => {
    if (frame === undefined || root === undefined) return
    frame.setAttribute(HOST_ATTRIBUTE, '')
    if (strip.parentElement !== frame) frame.append(strip)
    const host = root.querySelector<HTMLElement>(REGION_SELECTOR) ?? root
    if (viewHost.parentElement !== host) host.append(viewHost)
  }

  /** 找到外壳并落位；外壳尚未渲染时留待观察者。 */
  const tryPlace = (): void => {
    if (disposed) return
    if (frame !== undefined && frame.isConnected && root !== undefined && root.isConnected
      && strip.parentElement === frame) {
      place()
      render()
      return
    }
    column = sidebarColumn()
    if (column === undefined) return
    const nextRoot = sidebarRoot(column)
    const nextFrame = column.parentElement
    if (nextRoot === undefined || nextFrame === null) return
    root = nextRoot
    frame = nextFrame
    place()
    frameObserver.disconnect()
    frameObserver.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
    rootObserver.disconnect()
    rootObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-active', 'aria-current'] })
    render()
  }

  /** 侧栏当前是否展开（外壳把状态写在 AppFrame 的属性上）。 */
  const expanded = (): boolean => frame !== undefined && !frame.hasAttribute('data-sidebar-collapsed')

  /** 抽屉展开（已展开则不动）。 */
  const expand = (): void => { if (!expanded()) options.layout.toggleSidebar() }

  /** 抽屉收起：中心栏页面不需要它。 */
  const collapse = (): void => { if (expanded()) options.layout.toggleSidebar() }

  /**
   * 中心栏的主面板是否被选中：官方行给 `aria-current="page"`，插件注入行给
   * `data-active="true"`。工作区图标的选中态要避开它，否则图标列里会同时亮着两块。
   */
  const panelSelected = (): boolean => root !== undefined
    && root.querySelector('nav[class*="panelList"] [aria-current="page"], nav[class*="panelList"] [data-active="true"]') !== null

  /** 视图 id 是否可切：内建工作区，或已注册的 `kind: 'view'` 条目。 */
  const knownView = (next: string): boolean => next === WORKSPACE_VIEW
    || registered.some(candidate => candidate.kind === 'view' && candidate.view === next)

  /** 切到某个视图，只换抽屉内容、不动抽屉开合；未变化时什么都不做。 */
  const setView = (next: string): void => {
    if (next === view) return
    const item = next === WORKSPACE_VIEW
      ? undefined
      : registered.find(candidate => candidate.kind === 'view' && candidate.view === next)
    disposeViewMount?.()
    disposeViewMount = undefined
    viewHost.replaceChildren()
    view = next
    if (item !== undefined) disposeViewMount = item.mountView?.(viewHost)
  }

  /**
   * 切到抽屉里的视图：展开抽屉，并把主面板选择交还出去 —— 中心栏回到会话，图标列里
   * 只有当前这块亮着。
   */
  const openView = (next: string): void => {
    if (disposed || !knownView(next)) return
    setView(next)
    options.layout.selectPanel?.(null)
    expand()
    render()
  }

  /**
   * 工作区图标：抽屉里的工作区浏览器。
   *
   * 从中心栏页面（插件/设备/任务看板…）回来时交还主面板选择并展开抽屉；从别的抽屉
   * 视图回来时换回浏览器；已经在工作区时按 VS Code 的语义收起抽屉。
   */
  const activateWorkspace = (): void => {
    const fromPanel = panelSelected()
    const fromView = view !== WORKSPACE_VIEW
    options.layout.selectPanel?.(null)
    setView(WORKSPACE_VIEW)
    if (!expanded()) expand()
    else if (!fromPanel && !fromView) options.layout.toggleSidebar()
    render()
  }

  /**
   * 镜像图标：点击原行（行为与选中态的唯一事实来源），再收起抽屉 —— 原行打开的是中心栏
   * 页面，抽屉留着只会挡住内容。先撤下抽屉里的自定义视图，避免两块同时亮。
   */
  const activateMirrored = (row: HTMLElement): void => {
    setView(WORKSPACE_VIEW)
    row.click()
    collapse()
    render()
  }

  /** 注册条目的点击：视图条目切视图，动作条目执行动作。 */
  const activateItem = (item: ActivityBarItem): void => {
    if (item.kind === 'view' && item.view !== undefined) {
      openView(item.view)
      return
    }
    item.activate?.()
  }

  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(`[${ITEM_ATTRIBUTE}]`) : null
    if (target === null || !strip.contains(target)) return
    const key = target.getAttribute(ITEM_ATTRIBUTE)
    if (key === null) return
    live.get(key)?.activate()
  }
  strip.addEventListener('click', onClick)

  const rootObserver = new MutationObserver((records) => {
    if (root === undefined || !root.isConnected || frame === undefined || !frame.isConnected) {
      tryPlace()
      return
    }
    if (strip.parentElement !== frame) place()
    // 自己写图标条引起的变更不再触发重画：只有外壳/其它插件的改动才需要重画，
    // 否则「重画 → 写 DOM → 观察者 → 重画」会变成微任务空转。
    if (records.some(record => !strip.contains(record.target))) schedule()
  })
  const frameObserver = new MutationObserver(() => { schedule() })
  // 整棵外壳被重建时，根观察者随旧树一起消失，只有 body 级观察者能发现新树。
  const waitObserver = new MutationObserver(() => {
    if (frame !== undefined && frame.isConnected && strip.parentElement === frame) return
    tryPlace()
  })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const disposeLocale = options.locale === undefined ? undefined : options.locale.subscribe(schedule)

  const handle: ActivityBarHandle = {
    register: (item: ActivityBarItem): (() => void) => {
      if (disposed || registered.includes(item)) return () => {}
      if (registered.some(candidate => candidate.id === item.id)) {
        throw new Error(`activity bar: item "${item.id}" is already registered`)
      }
      registered.push(item)
      const disposeActive = item.active?.subscribe(schedule)
      if (disposeActive !== undefined) activeDisposers.set(item, disposeActive)
      render()
      return () => {
        const index = registered.indexOf(item)
        if (index < 0) return
        registered.splice(index, 1)
        activeDisposers.get(item)?.()
        activeDisposers.delete(item)
        if (item.kind === 'view' && item.view !== undefined && item.view === view) {
          openView(WORKSPACE_VIEW)
          return
        }
        render()
      }
    },
    openView,
    activeView: () => view,
    refresh: () => { render() },
    dispose: () => {
      if (disposed) return
      disposed = true
      disposeViewMount?.()
      disposeViewMount = undefined
      for (const dispose of activeDisposers.values()) dispose()
      activeDisposers.clear()
      registered.length = 0
      disposeLocale?.()
      strip.removeEventListener('click', onClick)
      rootObserver.disconnect()
      frameObserver.disconnect()
      waitObserver.disconnect()
      strip.remove()
      viewHost.remove()
      frame?.removeAttribute(HOST_ATTRIBUTE)
      frame?.removeAttribute(WIDE_ATTRIBUTE)
      frame?.removeAttribute(RAIL_ATTRIBUTE)
      frame?.removeAttribute(VIEW_ATTRIBUTE)
    },
  }

  tryPlace()
  return handle
}
