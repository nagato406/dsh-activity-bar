/**
 * 浏览器半区入口。
 *
 * 挂载点：**注入**到官方侧栏里的一条图标列（见 activity-bar-core.ts 的模块注释）。
 * 本插件同时提供 `ctx.activityBar` 服务，别的插件（如 dsh-interconnect 的每台设备一个
 * 图标）通过它注册条目；活动栏未安装时该服务不存在，注册方应自行降级。
 *
 * 失败策略：注入问题只记日志、不抛异常 —— web shell 在插件 apply 抛错时会让整个启动
 * 失败，外部插件不该有能力把 GUI 拖下水。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 仅类型：拉入 ctx.locale 的 Context 合并，以及 LocaleNamespaceMap 的合并点。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { mountActivityBar } from './activity-bar-core.ts'
import type { ActivityBarItem, ActivityBarService } from './types.ts'
import { NS, en, zh, type ActivityBarKey } from './locales.ts'
import css from './activity-bar.module.css'

// `@deepseek-ai/dsh-client-ui-layout` 只做信息性声明（dsh.client.inject），运行时服务
// 确实存在：它由官方 ui-layout 提供，与 `slots` 同源。这里只补本插件用到的两个方法，
// 不照抄官方品牌类型。`selectPanel(null)` 把中心栏的主面板选择交还会话视图 —— 图标列
// 靠它保证「当前页面」只有一块亮着（与 dsh-interconnect 用的是同一个方法）。
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 官方布局服务（本插件只用侧栏开合与主面板选择）。 */
    layout: {
      /** 收起/展开左侧栏。 */
      toggleSidebar(): void
      /** 选中某个主面板；传 null 回到会话视图。 */
      selectPanel(panelId: string | null): void
    }
    /** 本插件提供的活动栏注册表。 */
    activityBar: ActivityBarService
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 本插件的界面文案。 */
    'activity-bar': ActivityBarKey
  }
}

/**
 * 依赖的客户端服务：`locale` 提供文案，`layout` 提供侧栏开合。
 *
 * 必须导出 inject：不声明就直接读 `ctx.locale` / `ctx.layout`，cordis 会抛
 * `cannot get property "…" without inject`，表现是整个 GUI 起不来。
 */
export const inject = ['locale', 'layout']

/**
 * 挂载活动栏并对外提供注册表。
 * @param ctx - 客户端根上下文，携带 locale 与 layout。
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-activity-bar: dictionaries')
  } catch (error) {
    console.warn('[dsh-activity-bar] locale dictionaries failed to register:', error)
  }

  const t = ctx.locale.bind(NS)

  ctx.effect(() => {
    const bar = mountActivityBar({
      plugin: 'activity-bar',
      css,
      labels: {
        bar: () => t('bar'),
        workspace: () => t('workspace'),
      },
      layout: ctx.layout,
      locale: ctx.locale,
    })
    const disposeService = ctx.provide('activityBar', {
      register: (item: ActivityBarItem) => bar.register(item),
      openView: (view: string) => { bar.openView(view) },
      activeView: () => bar.activeView(),
      refresh: () => { bar.refresh() },
    })
    return () => {
      // provide() 的注销器异步结算；销毁是同步的 fire-and-forget。
      void disposeService()
      bar.dispose()
    }
  }, 'dsh-activity-bar: strip + registry')
}
