/**
 * 本包的 vitest 配置。
 *
 * 用 `.mjs` 而不是 `.ts`：vite 加载 `.ts` 配置要先经 esbuild 编译，而 esbuild 会
 * 起一个服务子进程走管道通信 —— 在受限环境里那会被拒绝（spawn EPERM）。配置内容都是
 * 纯字面量，不需要 TS。
 *
 * `pool: 'threads'`：vitest 默认的 forks 池用 child_process + IPC 管道，同样可能被
 * 拒绝；线程池不额外开进程。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.{spec,test}.{ts,tsx}'],
    pool: 'threads',
  },
})
