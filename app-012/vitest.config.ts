import { defineConfig } from 'vitest/config';

// 排期模块全部是纯逻辑，跑在 node 环境即可。
// 注意：仓库锁定的 jsdom 30 依赖 undici 8（需更新版本 Node 内置 API），
// 在当前 Node 20.20 下无法初始化，因此这里不用 jsdom；
// store.test.ts 自行注入内存版 localStorage 垫片。
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
