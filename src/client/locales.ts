/**
 * 文案字典：`zh` 是 key 的来源，`en` 必须完整对照。
 *
 * 只放产品可见文本（标签、按钮、状态、提示、无障碍名）。
 */
export const NS = 'activity-bar'

/** 中文文案（key 的来源）。 */
export const zh = {
  bar: '活动栏',
  workspace: '工作区',
} as const

/** 本命名空间全部 key 的联合类型；注册处与组件 props 都用它做约束。 */
export type ActivityBarKey = keyof typeof zh

/** 英文文案。 */
export const en: Record<ActivityBarKey, string> = {
  bar: 'Activity bar',
  workspace: 'Workspace',
}
