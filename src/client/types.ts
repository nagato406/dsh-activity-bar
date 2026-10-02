/**
 * 活动栏的公开类型面。
 *
 * 活动栏自己不知道任何业务：它把侧栏里已有的入口行镜像成图标，并让别的插件通过
 * `ctx.activityBar` 注册自己的条目（图标 + 左侧视图）。类型只描述这一层。
 */

/**
 * 活动栏里的一条条目。
 *
 * 两种条目：`view` 切换左侧视图（`view` 字段即视图 id），`action` 只执行一个动作
 * （例如打开中心栏面板）。两者都不接收 React 节点 —— 图标是内联 SVG 字符串，视图
 * 内容由 `mountView` 自己往给定容器里画。
 */
export interface ActivityBarItem {
  /** 稳定 id，全局唯一；重复注册抛错。 */
  id: string
  /** 文案（随语言变化）：可见提示、无障碍名称与悬浮 title。 */
  label: () => string
  /**
   * 内联 SVG 标记（`stroke="currentColor"`，18px 视觉尺寸）。省略时若该条目在
   * 侧栏里有对应行，引擎会克隆那一行的图标；两者都没有则用兜底字形。
   */
  icon?: string
  /** 注册条目之间的升序位置；省略按 1000 参与排序，同值保持注册顺序。镜像行始终在前。 */
  order?: number
  /** `view` = 切换左侧视图；`action` = 只执行动作。 */
  kind: 'view' | 'action'
  /** `kind: 'view'` 时的视图 id（不能是内建的 `workspace`）。 */
  view?: string
  /**
   * `kind: 'view'` 时的视图内容：往容器里画自己的界面，返回清理函数。
   * 引擎保证同一时刻只挂载一个视图，切换或销毁时调用清理函数。
   */
  mountView?: (container: HTMLElement) => () => void
  /** `kind: 'action'` 时的动作。 */
  activate?: () => void
  /** 选中态来源；通知时活动栏重画高亮。省略时 `view` 条目按当前视图判断。 */
  active?: {
    subscribe(listener: () => void): () => void
    isActive(): boolean
  }
}

/**
 * 活动栏服务（`ctx.activityBar`）。
 *
 * 服务由活动栏插件提供；未安装活动栏时该服务不存在，调用方应当用
 * `ctx.inject(['activityBar'], …)` 等待，或 `ctx.get('activityBar')` 探测。
 */
export interface ActivityBarService {
  /** 注册一条条目；返回注销器（注销时若它正是当前视图，则退回工作区视图）。 */
  register(item: ActivityBarItem): () => void
  /** 切换左侧视图（未知视图 id 退回工作区视图）。 */
  openView(view: string): void
  /** 当前左侧视图 id。 */
  activeView(): string
  /** 让活动栏重画一次（条目的选中态来自引擎看不见的外部状态时使用）。 */
  refresh(): void
}
