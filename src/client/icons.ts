/**
 * 内建字形。
 *
 * 尺寸与线宽对齐外壳导航图标（viewBox 16、stroke 1.3、渲染 18px），这样镜像来的
 * 官方图标与自绘图标在同一列里视觉重量一致。
 */

/** 工作区：带封口的文件夹。 */
export const WORKSPACE_ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4.6A1.6 1.6 0 0 1 3.6 3h2.4l1.4 1.7h5A1.6 1.6 0 0 1 14 6.3v5.1A1.6 1.6 0 0 1 12.4 13H3.6A1.6 1.6 0 0 1 2 11.4z"/><path d="M2 6.6h12"/></svg>'

/** 兜底字形：一个空心方块，用于既没有自带图标、侧栏里也没有对应行的条目。 */
export const FALLBACK_ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2"/></svg>'
