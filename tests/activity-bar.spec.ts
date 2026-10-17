// @vitest-environment jsdom
/**
 * 活动栏引擎的行为规格：注入位置、镜像、选中态、宽/收起切换、视图切换与销毁。
 *
 * 规格只断言用户能看到的东西（图标条里有什么、点了会怎样、哪些属性在），不断言内部
 * 实现细节与 CSS（jsdom 不跑样式）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HOST_ATTRIBUTE,
  ITEM_ATTRIBUTE,
  RAIL_ATTRIBUTE,
  STRIP_ATTRIBUTE,
  VIEW_ATTRIBUTE,
  VIEW_HOST_ATTRIBUTE,
  WIDE_ATTRIBUTE,
  WORKSPACE_VIEW,
  mountActivityBar,
  type ActivityBarHandle,
} from '../src/client/activity-bar-core.ts'
import type { ActivityBarItem } from '../src/client/types.ts'

/** 假 CSS Module 类名表（键与真实模块一致）。 */
const CSS: Record<string, string> = { strip: 'strip', item: 'item', icon: 'icon', viewHost: 'viewHost' }

/** 文案。 */
const LABELS = { bar: () => '活动栏', workspace: () => '工作区' }

/** 让观察者与排队中的重画都跑完。 */
const flush = async (): Promise<void> => {
  await new Promise<void>(resolve => { setTimeout(resolve, 0) })
}

/** 一次挂载用到的假外壳节点。 */
interface Shell {
  frame: HTMLElement
  root: HTMLElement
  panelRow: HTMLButtonElement
  entryRow: HTMLButtonElement
  region: HTMLElement
  browser: HTMLElement
}

/**
 * 造一个与真实外壳同形的 DOM：frame > sidebarCol > [data-slot=sidebar] > root，
 * root 里依次是 logo 行、新会话按钮、插件注入的入口行、官方面板行列表、工作区区域、页脚。
 * @param options - `collapsed` 造出收起态外壳（frame 带 data-sidebar-collapsed）。
 * @returns 测试要断言的节点。
 */
function buildShell(options: { collapsed?: boolean } = {}): Shell {
  document.body.innerHTML = ''
  const frame = document.createElement('div')
  frame.className = '_frame_hash'
  if (options.collapsed === true) frame.setAttribute('data-sidebar-collapsed', '')
  const column = document.createElement('div')
  column.className = '_sidebarCol_hash'
  const slot = document.createElement('div')
  slot.setAttribute('data-slot', 'sidebar')
  const root = document.createElement('div')
  root.className = '_root_hash'
  const logoRow = document.createElement('div')
  logoRow.className = '_logoRow_hash'
  const newSession = document.createElement('button')
  newSession.className = '_newSession_hash'

  const entryRow = document.createElement('button')
  entryRow.setAttribute('data-dsh-taskboard-entry', '')
  entryRow.setAttribute('data-dsh-part', 'sidebar-entry')
  entryRow.setAttribute('data-dsh-plugin', 'task-board')
  entryRow.setAttribute('aria-label', '任务看板')
  entryRow.innerHTML = '<span class="entryIcon"><svg viewBox="0 0 16 16"><rect width="8" height="8"/></svg></span><span class="entryLabel">任务看板</span>'

  const nav = document.createElement('nav')
  nav.className = '_panelList_hash'
  // 插件注入行就落在面板列表里（共享 core 的注入点），所以它同时命中两条选择器。
  nav.append(entryRow)
  const panelRow = document.createElement('button')
  panelRow.className = '_panelRow_hash'
  panelRow.setAttribute('aria-label', '插件')
  panelRow.innerHTML = '<span class="panelGlyph"><svg viewBox="0 0 16 16"><circle r="4"/></svg></span><span class="panelTitle">插件</span>'
  nav.append(panelRow)

  const region = document.createElement('div')
  region.className = '_regionArea_hash'
  const browser = document.createElement('div')
  browser.setAttribute('data-slot', 'sidebar.workspaces')
  browser.setAttribute('style', 'display: contents')
  region.append(browser)

  const foot = document.createElement('div')
  foot.className = '_footArea_hash'
  root.append(logoRow, newSession, nav, region, foot)
  slot.append(root)
  column.append(slot)
  frame.append(column)
  document.body.append(frame)
  return { frame, root, panelRow, entryRow, region, browser }
}

/** 挂载好的活动栏与它用到的假外壳。 */
interface Mounted {
  bar: ActivityBarHandle
  shell: Shell
  toggleSidebar: ReturnType<typeof vi.fn>
  selectPanel: ReturnType<typeof vi.fn>
  locale: { notify: () => void }
}

/**
 * 挂载活动栏。
 * @param shell - 目标外壳。
 * @param items - 挂载前预置的注册条目。
 * @param labels - 文案来源；测试可改其闭包变量再触发语言切换。
 * @returns 句柄、外壳与两个探针（侧栏开合、主面板选择）+ 语言切换。
 */
function mount(shell: Shell, items: readonly ActivityBarItem[] = [], labels = LABELS): Mounted {
  const listeners = new Set<() => void>()
  const toggleSidebar = vi.fn()
  const selectPanel = vi.fn()
  const bar = mountActivityBar({
    plugin: 'activity-bar',
    css: CSS,
    labels,
    layout: { toggleSidebar, selectPanel },
    locale: { subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
  })
  for (const item of items) bar.register(item)
  return { bar, shell, toggleSidebar, selectPanel, locale: { notify: () => { for (const listener of listeners) listener() } } }
}

/** 图标条元素。 */
const strip = (): HTMLElement | null => document.querySelector<HTMLElement>(`[${STRIP_ATTRIBUTE}]`)

/** 图标条里的条目 key（按渲染顺序）。 */
const keys = (): string[] => Array.from(strip()?.children ?? [])
  .map(child => child.getAttribute(ITEM_ATTRIBUTE) ?? '')

/** 按 key 取条目按钮。 */
const item = (key: string): HTMLButtonElement => {
  const button = strip()?.querySelector<HTMLButtonElement>(`[${ITEM_ATTRIBUTE}="${key}"]`)
  if (button === null || button === undefined) throw new Error(`activity bar item "${key}" is not rendered`)
  return button
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-windows-titlebar')
})

describe('mountActivityBar', () => {
  it('把图标条注入成 AppFrame 的子节点（与侧栏抽屉平级，不在侧栏里）', () => {
    const shell = buildShell()
    const mounted = mount(shell)
    try {
      expect(strip()?.parentElement).toBe(shell.frame)
      expect(shell.root.contains(strip())).toBe(false)
      expect(shell.frame.hasAttribute(HOST_ATTRIBUTE)).toBe(true)
      expect(shell.frame.hasAttribute(WIDE_ATTRIBUTE)).toBe(true)
      // 内建工作区 + 插件注入行 + 官方面板行，按文档顺序。
      expect(keys()).toEqual([WORKSPACE_VIEW, 'entry:task-board', 'panel:插件'])
      expect(item(WORKSPACE_VIEW).getAttribute('aria-label')).toBe('工作区')
      expect(strip()?.getAttribute('aria-label')).toBe('活动栏')
      expect(strip()?.getAttribute('data-dsh-plugin')).toBe('activity-bar')
      // 图标是从原行克隆来的（同一段标记）。
      expect(item('panel:插件').querySelector('svg')?.outerHTML)
        .toBe(shell.panelRow.querySelector('svg')?.outerHTML)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('点击镜像图标就是点击原行', () => {
    const shell = buildShell()
    const mounted = mount(shell)
    try {
      const panelClick = vi.fn()
      const entryClick = vi.fn()
      shell.panelRow.addEventListener('click', panelClick)
      shell.entryRow.addEventListener('click', entryClick)
      item('panel:插件').click()
      item('entry:task-board').click()
      expect(panelClick).toHaveBeenCalledTimes(1)
      expect(entryClick).toHaveBeenCalledTimes(1)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('同一插件注入两行时各成一个图标，各自点击自己的行', () => {
    const shell = buildShell()
    const second = document.createElement('button')
    second.setAttribute('data-dsh-ssh-entry', '')
    second.setAttribute('data-dsh-part', 'sidebar-entry')
    second.setAttribute('data-dsh-plugin', 'task-board')
    second.setAttribute('aria-label', '第二行')
    second.innerHTML = '<span class="entryIcon"><svg viewBox="0 0 16 16"><rect width="4" height="4"/></svg></span>'
    shell.entryRow.after(second)
    const mounted = mount(shell)
    try {
      expect(keys()).toEqual([WORKSPACE_VIEW, 'entry:task-board', 'entry:task-board#1', 'panel:插件'])
      const firstClick = vi.fn()
      const secondClick = vi.fn()
      shell.entryRow.addEventListener('click', firstClick)
      second.addEventListener('click', secondClick)
      item('entry:task-board').click()
      item('entry:task-board#1').click()
      expect(firstClick).toHaveBeenCalledTimes(1)
      expect(secondClick).toHaveBeenCalledTimes(1)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('镜像原行的选中态：官方行看 aria-current，注入行看 data-active', async () => {
    const shell = buildShell()
    const mounted = mount(shell)
    try {
      shell.panelRow.setAttribute('aria-current', 'page')
      shell.entryRow.dataset['active'] = 'true'
      await flush()
      expect(item('panel:插件').getAttribute('data-active')).toBe('true')
      expect(item('entry:task-board').getAttribute('data-active')).toBe('true')
      shell.panelRow.removeAttribute('aria-current')
      delete shell.entryRow.dataset['active']
      await flush()
      expect(item('panel:插件').hasAttribute('data-active')).toBe(false)
      expect(item('entry:task-board').hasAttribute('data-active')).toBe(false)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('同一个按钮被两条选择器命中时只出一个图标（皮肤给官方面板行盖了 sidebar-entry）', () => {
    const shell = buildShell()
    const family = document.createElement('button')
    family.className = '_panelRow_hash'
    family.setAttribute('data-dsh-part', 'sidebar-entry')
    family.setAttribute('aria-label', '任务看板')
    family.innerHTML = '<span class="panelGlyph"><svg data-dsh-panel-entry="task-board" viewBox="0 0 16 16"><rect width="6" height="6"/></svg></span>'
    shell.root.querySelector('nav')?.append(family)
    const mounted = mount(shell)
    try {
      expect(keys()).toEqual([WORKSPACE_VIEW, 'entry:task-board', 'panel:插件', 'panel:task-board'])
      expect(strip()?.querySelectorAll(`[${ITEM_ATTRIBUTE}]`)).toHaveLength(4)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('主面板选中时工作区图标不再高亮（图标列同时只亮一块）', async () => {
    const shell = buildShell()
    const mounted = mount(shell)
    try {
      expect(item(WORKSPACE_VIEW).getAttribute('data-active')).toBe('true')
      shell.panelRow.setAttribute('aria-current', 'page')
      await flush()
      expect(item('panel:插件').getAttribute('data-active')).toBe('true')
      expect(item(WORKSPACE_VIEW).hasAttribute('data-active')).toBe(false)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('点镜像图标打开中心栏页面后收起抽屉', () => {
    const shell = buildShell()
    const mounted = mount(shell)
    try {
      const panelClick = vi.fn()
      shell.panelRow.addEventListener('click', panelClick)
      item('panel:插件').click()
      expect(panelClick).toHaveBeenCalledTimes(1)
      expect(mounted.toggleSidebar).toHaveBeenCalledTimes(1)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('抽屉已经收着时点镜像图标不再切换', () => {
    const shell = buildShell({ collapsed: true })
    const mounted = mount(shell)
    try {
      item('panel:插件').click()
      expect(mounted.toggleSidebar).not.toHaveBeenCalled()
    } finally {
      mounted.bar.dispose()
    }
  })

  it('从中心栏页面点工作区：交还主面板选择并保持抽屉展开', () => {
    const shell = buildShell()
    const mounted = mount(shell)
    try {
      shell.panelRow.setAttribute('aria-current', 'page')
      item(WORKSPACE_VIEW).click()
      expect(mounted.selectPanel).toHaveBeenCalledWith(null)
      expect(mounted.toggleSidebar).not.toHaveBeenCalled()
    } finally {
      mounted.bar.dispose()
    }
  })

  it('从中心栏页面回来但抽屉收着时先展开', () => {
    const shell = buildShell({ collapsed: true })
    const mounted = mount(shell)
    try {
      shell.panelRow.setAttribute('aria-current', 'page')
      item(WORKSPACE_VIEW).click()
      expect(mounted.selectPanel).toHaveBeenCalledWith(null)
      expect(mounted.toggleSidebar).toHaveBeenCalledTimes(1)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('从抽屉视图切到中心栏页面：视图先撤下，抽屉收起', async () => {
    const shell = buildShell()
    const mounted = mount(shell)
    const disposeView = vi.fn()
    try {
      mounted.bar.register({
        id: 'remote',
        label: () => 'WSL',
        kind: 'view',
        view: 'remote:wsl',
        mountView: (container) => { container.append(document.createElement('div')); return disposeView },
      })
      item('remote').click()
      await flush()
      expect(mounted.bar.activeView()).toBe('remote:wsl')
      expect(mounted.selectPanel).toHaveBeenCalledWith(null)
      item('panel:插件').click()
      await flush()
      expect(disposeView).toHaveBeenCalledTimes(1)
      expect(mounted.bar.activeView()).toBe(WORKSPACE_VIEW)
      expect(shell.frame.hasAttribute(VIEW_ATTRIBUTE)).toBe(false)
      expect(mounted.toggleSidebar).toHaveBeenCalledTimes(1)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('收起侧栏时图标条留在原处（Windows 零宽收起没有外壳竖条）', async () => {
    document.documentElement.setAttribute('data-windows-titlebar', '')
    const shell = buildShell()
    const mounted = mount(shell)
    try {
      shell.frame.setAttribute('data-sidebar-collapsed', '')
      await flush()
      expect(shell.frame.hasAttribute(WIDE_ATTRIBUTE)).toBe(false)
      expect(shell.frame.hasAttribute(RAIL_ATTRIBUTE)).toBe(false)
      expect(strip()?.parentElement).toBe(shell.frame)
      shell.frame.removeAttribute('data-sidebar-collapsed')
      await flush()
      expect(shell.frame.hasAttribute(WIDE_ATTRIBUTE)).toBe(true)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('外壳自带 56px 竖条时图标条让位（浏览器收起态）', async () => {
    const shell = buildShell()
    const mounted = mount(shell)
    try {
      shell.frame.setAttribute('data-sidebar-collapsed', '')
      await flush()
      expect(shell.frame.hasAttribute(RAIL_ATTRIBUTE)).toBe(true)
      shell.frame.removeAttribute('data-sidebar-collapsed')
      await flush()
      expect(shell.frame.hasAttribute(RAIL_ATTRIBUTE)).toBe(false)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('侧栏收起时点注册的视图条目会把侧栏叫回来（视图画在侧栏里）', async () => {
    document.documentElement.setAttribute('data-windows-titlebar', '')
    const shell = buildShell()
    const mounted = mount(shell)
    try {
      mounted.bar.register({ id: 'devices', label: () => '设备', kind: 'view', view: 'remote:alpha' })
      shell.frame.setAttribute('data-sidebar-collapsed', '')
      await flush()
      item('devices').click()
      expect(mounted.toggleSidebar).toHaveBeenCalledTimes(1)
      expect(mounted.selectPanel).toHaveBeenCalledWith(null)
      expect(mounted.bar.activeView()).toBe('remote:alpha')
    } finally {
      mounted.bar.dispose()
    }
  })

  it('工作区图标已激活时按 VS Code 语义收起侧栏', () => {
    const shell = buildShell()
    const mounted = mount(shell)
    try {
      item(WORKSPACE_VIEW).click()
      expect(mounted.toggleSidebar).toHaveBeenCalledTimes(1)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('注册的视图条目：切视图、挂载内容、激活态与注销回落', async () => {
    const shell = buildShell()
    const mounted = mount(shell)
    const disposeView = vi.fn()
    const mountView = vi.fn((container: HTMLElement) => {
      const node = document.createElement('div')
      node.dataset['remote'] = 'alpha'
      container.append(node)
      return disposeView
    })
    try {
      const unregister = mounted.bar.register({
        id: 'interconnect:alpha',
        label: () => 'user@alpha',
        kind: 'view',
        view: 'remote:alpha',
        order: 1000,
        mountView,
      })
      expect(keys()).toEqual([WORKSPACE_VIEW, 'entry:task-board', 'panel:插件', 'interconnect:alpha'])
      item('interconnect:alpha').click()
      await flush()
      expect(mounted.bar.activeView()).toBe('remote:alpha')
      expect(shell.frame.getAttribute(VIEW_ATTRIBUTE)).toBe('remote:alpha')
      expect(mountView).toHaveBeenCalledTimes(1)
      const host = shell.region.querySelector<HTMLElement>(`[${VIEW_HOST_ATTRIBUTE}]`)
      expect(host?.querySelector('[data-remote="alpha"]')).not.toBeNull()
      expect(item('interconnect:alpha').getAttribute('data-active')).toBe('true')
      expect(item(WORKSPACE_VIEW).hasAttribute('data-active')).toBe(false)

      unregister()
      await flush()
      expect(disposeView).toHaveBeenCalledTimes(1)
      expect(mounted.bar.activeView()).toBe(WORKSPACE_VIEW)
      expect(shell.frame.hasAttribute(VIEW_ATTRIBUTE)).toBe(false)
      expect(host?.childElementCount).toBe(0)
      expect(keys()).toEqual([WORKSPACE_VIEW, 'entry:task-board', 'panel:插件'])
    } finally {
      mounted.bar.dispose()
    }
  })

  it('未知视图 id 保持当前视图，重复 id 抛错', () => {
    const shell = buildShell()
    const mounted = mount(shell, [{ id: 'a', label: () => 'A', kind: 'action', activate: () => {} }])
    try {
      mounted.bar.openView('nope')
      expect(mounted.bar.activeView()).toBe(WORKSPACE_VIEW)
      expect(() => mounted.bar.register({ id: 'a', label: () => 'A', kind: 'action' })).toThrow(/already registered/)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('动作条目执行自己的动作，选中态来自条目自己的来源', async () => {
    const shell = buildShell()
    const mounted = mount(shell)
    let active = false
    const listeners = new Set<() => void>()
    const activate = vi.fn()
    try {
      mounted.bar.register({
        id: 'devices',
        label: () => '设备',
        kind: 'action',
        order: 10,
        activate,
        active: {
          subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
          isActive: () => active,
        },
      })
      // 顺序规则：工作区 → 镜像行（按文档顺序）→ 注册条目（按 order）。
      expect(keys()).toEqual([WORKSPACE_VIEW, 'entry:task-board', 'panel:插件', 'devices'])
      item('devices').click()
      expect(activate).toHaveBeenCalledTimes(1)
      active = true
      for (const listener of listeners) listener()
      await flush()
      expect(item('devices').getAttribute('data-active')).toBe('true')
    } finally {
      mounted.bar.dispose()
    }
  })

  it('语言切换后重画文案', async () => {
    const shell = buildShell()
    const words = { bar: '活动栏', workspace: '工作区' }
    const mounted = mount(shell, [], { bar: () => words.bar, workspace: () => words.workspace })
    try {
      expect(item(WORKSPACE_VIEW).getAttribute('aria-label')).toBe('工作区')
      words.bar = 'Activity bar'
      words.workspace = 'Workspace'
      mounted.locale.notify()
      await flush()
      expect(item(WORKSPACE_VIEW).getAttribute('aria-label')).toBe('Workspace')
      expect(strip()?.getAttribute('aria-label')).toBe('Activity bar')
    } finally {
      mounted.bar.dispose()
    }
  })

  it('React 重渲染把图标条挤掉时自愈回 AppFrame', async () => {
    const shell = buildShell()
    const mounted = mount(shell)
    try {
      strip()?.remove()
      await flush()
      expect(strip()?.parentElement).toBe(shell.frame)
    } finally {
      mounted.bar.dispose()
    }
  })

  it('外壳整棵树重建后重新落位', async () => {
    const first = buildShell()
    const mounted = mount(first)
    try {
      buildShell()
      await flush()
      expect(strip()?.parentElement).not.toBeNull()
      expect(strip()?.parentElement).toBe(document.querySelector('[class*="frame"]'))
    } finally {
      mounted.bar.dispose()
    }
  })

  it('销毁后撤掉图标条、视图容器与外壳标记', async () => {
    const shell = buildShell()
    const mounted = mount(shell)
    strip()?.remove()
    await flush()
    mounted.bar.dispose()
    expect(strip()).toBeNull()
    expect(shell.root.querySelector(`[${VIEW_HOST_ATTRIBUTE}]`)).toBeNull()
    expect(shell.frame.hasAttribute(HOST_ATTRIBUTE)).toBe(false)
    expect(shell.frame.hasAttribute(WIDE_ATTRIBUTE)).toBe(false)
    expect(shell.frame.hasAttribute(RAIL_ATTRIBUTE)).toBe(false)
    expect(shell.frame.hasAttribute(VIEW_ATTRIBUTE)).toBe(false)
  })
})
