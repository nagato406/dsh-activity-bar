/**
 * tsdown 配置。
 *
 * 走仓库自带的 client-bundle 预设（`shared/tsdown.client.ts`，从 dsh-web-ui
 * monorepo 原样取来，与 dsh-interconnect 同一份）：node 半区从 `src/index.ts`
 * 构建，浏览器半区打成由 `window.__ModuleLoader__` 加载的闭包工厂，类型由 tsc
 * 出到 `lib/types`。本包没有 host 侧额外产物，所以不传任何覆盖项。
 */
import { clientBundle } from './shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-activity-bar', ['src/index.ts'])
