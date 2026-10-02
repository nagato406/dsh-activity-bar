/**
 * Host 侧装载入口 —— 运行在 DSH host 进程里。
 *
 * 本插件是纯浏览器插件：活动栏是注入进 Web GUI 侧栏的一条图标列，数据全部来自页面
 * 自身（官方 `sidebar.panellist` 行、插件注入行，以及通过 `ctx.activityBar` 注册的
 * 条目）。Host 半区因此刻意没有行为，只为 bundle 行提供一个可装载的插件。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 应用 host 半区（纯浏览器插件，空实现）。 */
export function apply(_ctx: Context): void {
  // 刻意留空：本插件没有 host 侧行为。
}
