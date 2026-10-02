/**
 * 活动栏引擎（纯 DOM，无 React 树）。
 *
 * 目标形态是 VS Code 的活动栏：侧栏最左一条窄图标列，点图标切换左侧视图。官方侧栏
 * 没有外部插件可注册的槽（`sidebar` 是 single 且被 ui-sidebar 独占，内层席位同样是
 * single），所以这条列是**注入**进去的，与 dsh-web-ui 家族的侧栏行、dsh-interconnect
 * 的设备行同一套做法：只插入自己的节点，绝不移动或包裹 React 拥有的节点；用
 * MutationObserver 自愈，React 重渲染把节点挤掉时在同一帧（绘制前的微任务）补回。
 *
 * 图标从哪来：官方 `sidebar.panellist` 行（React 渲染）与插件注入的入口行
 * （`data-dsh-part="sidebar-entry"`）都会被镜像成图标，按文档顺序排列 —— 于是
 * 「设备 / 插件 / 任务看板」那排行原样变成图标列，且以后任何新入口行自动跟上。
 * 点击镜像图标 = 点击原行（`row.click()`），原行的行为与选中态是唯一事实来源。
 *
 * 宽态才有活动栏：侧栏收起成 56px 竖条时，那条竖条本身就是外壳的图标列（官方行与
 * 注入行都还在），此时活动栏隐藏、官方行恢复显示。切换靠侧栏根上的
 * `data-dsh-activity-bar-wide` 属性，纯 CSS 生效。
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

/** 侧栏根上的宽态标记：本属性在时活动栏可见、官方行让位（纯 CSS）。 */
export const WIDE_ATTRIBUTE = 'data-dsh-activity-bar-wide'
/** 图标条自身的标记属性。 */
export const STRIP_ATTRIBUTE = 'data-dsh-activity-bar'
/** 侧栏根上的当前视图标记，值即视图 id；自定义视图激活时它隐藏官方浏览器。 */
export const VIEW_ATTRIBUTE = 'data-dsh-activity-bar-view'
/** 自定义视图容器的标记属性。 */
export const VIEW_HOST_ATTRIBUTE = 'data-dsh-activity-bar-view-host'
/** 每个活动栏按钮上的条目 id。 */
export const ITEM_ATTRIBUTE = 'data-dsh-activity-bar-item'
/** 内建视图 id：外壳自带的工作区浏览器。 */
export const WORKSPACE_VIEW = 'workspace'
/** 注册条目的默认排序位（镜像行占 0..999）。 */
const DEFAULT_ITEM_ORDER = 1000

/** 活动栏驱动的外壳布局面（`ctx.layout` 的最小子集）。 */
export interface ActivityBarLayoutFace {
  /** 展开/收起左侧栏。 */
  toggleSidebar(): void
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
  let wide = true
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

  /** 镜像一条侧栏入口行：官方行与插件注入行都走这里。 */
  const mirror = (row: HTMLElement, index: number): RenderEntry => {
    const injected = row.getAttribute('data-dsh-part') === 'sidebar-entry'
    const label = row.getAttribute('aria-label') ?? row.textContent?.trim() ?? ''
    const plugin = row.getAttribute('data-dsh-plugin')
    return {
      key: injected ? `entry:${plugin ?? index}` : `panel:${label === '' ? String(index) : label}`,
      label,
      icon: row.querySelector('svg')?.outerHTML ?? FALLBACK_ICON,
      active: injected ? row.dataset['active'] === 'true' : row.getAttribute('aria-current') === 'page',
      activate: () => { row.click() },
    }
  }

  /** 收集需要镜像的行：插件注入行 + 官方面板行，按文档顺序；重复 key 追加序号。 */
  const mirrors = (sidebarRootElement: HTMLElement): RenderEntry[] => {
    const rows: HTMLElement[] = [
      ...sidebarRootElement.querySelectorAll<HTMLElement>(ENTRY_ROW_SELECTOR),
      ...sidebarRootElement.querySelectorAll<HTMLElement>(PANEL_ROW_SELECTOR),
    ]
    const used = new Set<string>()
    return rows.sort(documentOrder).map((row, index) => {
      const entry = mirror(row, index)
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

  /** 侧栏根上的视图标记：自定义视图激活时隐藏官方浏览器。 */
  const syncViewAttribute = (): void => {
    if (root === undefined) return
    if (view === WORKSPACE_VIEW) root.removeAttribute(VIEW_ATTRIBUTE)
    else root.setAttribute(VIEW_ATTRIBUTE, view)
  }

  /** 宽态同步：收起态交给外壳自己的 56px 图标列，活动栏让位。 */
  const syncWide = (): void => {
    if (root === undefined) return
    wide = frame?.hasAttribute('data-sidebar-collapsed') !== true
    if (wide) root.setAttribute(WIDE_ATTRIBUTE, '')
    else root.removeAttribute(WIDE_ATTRIBUTE)
  }

  /** 重画：图标条内容 + 宽态 + 视图标记。 */
  const render = (): void => {
    if (disposed || rendering) return
    const current = root
    if (current === undefined) return
    rendering = true
    try {
      const barLabel = options.labels.bar()
      if (strip.getAttribute('aria-label') !== barLabel) strip.setAttribute('aria-label', barLabel)
      syncWide()
      syncViewAttribute()
      const entries: RenderEntry[] = [
        {
          key: WORKSPACE_VIEW,
          label: options.labels.workspace(),
          icon: WORKSPACE_ICON,
          active: view === WORKSPACE_VIEW,
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

  /** 把图标条与视图容器放回侧栏（React 重渲染后自愈）。 */
  const place = (sidebarRootElement: HTMLElement): void => {
    if (strip.parentElement !== sidebarRootElement || sidebarRootElement.firstElementChild !== strip) {
      sidebarRootElement.insertBefore(strip, sidebarRootElement.firstElementChild)
    }
    const host = sidebarRootElement.querySelector<HTMLElement>(REGION_SELECTOR) ?? sidebarRootElement
    if (viewHost.parentElement !== host) host.append(viewHost)
  }

  /** 找到侧栏并落位；外壳尚未渲染时留待观察者。 */
  const tryPlace = (): void => {
    if (disposed) return
    if (root !== undefined && root.isConnected) {
      if (!root.contains(strip)) place(root)
      render()
      return
    }
    column = sidebarColumn()
    if (column === undefined) return
    const next = sidebarRoot(column)
    if (next === undefined) return
    root = next
    frame = column.parentElement ?? undefined
    place(root)
    frameObserver.disconnect()
    if (frame !== undefined) frameObserver.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
    rootObserver.disconnect()
    rootObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-active', 'aria-current'] })
    render()
  }

  /** 切到某个视图：先卸下上一个自定义视图，再挂新的；未知视图 id 保持现状。 */
  const openView = (next: string): void => {
    if (disposed || next === view) return
    const item = next === WORKSPACE_VIEW
      ? undefined
      : registered.find(candidate => candidate.kind === 'view' && candidate.view === next)
    if (next !== WORKSPACE_VIEW && item === undefined) return
    disposeViewMount?.()
    disposeViewMount = undefined
    viewHost.replaceChildren()
    view = next
    if (item !== undefined) disposeViewMount = item.mountView?.(viewHost)
    if (!wide) options.layout.toggleSidebar()
    render()
  }

  /** 工作区图标：已在该视图时按 VS Code 的语义收起侧栏。 */
  const activateWorkspace = (): void => {
    if (view !== WORKSPACE_VIEW) {
      openView(WORKSPACE_VIEW)
      return
    }
    options.layout.toggleSidebar()
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
    if (root === undefined || !root.isConnected) {
      tryPlace()
      return
    }
    if (!root.contains(strip)) place(root)
    // 自己写图标条引起的变更不再触发重画：只有外壳/其它插件的改动才需要重画，
    // 否则「重画 → 写 DOM → 观察者 → 重画」会变成微任务空转。
    if (records.some(record => !strip.contains(record.target))) schedule()
  })
  const frameObserver = new MutationObserver(() => { schedule() })
  // 整棵侧栏被重建时，根观察者随旧树一起消失，只有 body 级观察者能发现新树。
  const waitObserver = new MutationObserver(() => {
    if (root !== undefined && root.isConnected && root.contains(strip)) return
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
      root?.removeAttribute(WIDE_ATTRIBUTE)
      root?.removeAttribute(VIEW_ATTRIBUTE)
    },
  }

  tryPlace()
  return handle
}
