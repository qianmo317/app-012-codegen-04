# 中药柜抓药：戥子称重模拟 · Apothecary Weighing Game

> 类型：前端休闲模拟游戏｜难度：★★★｜建议技术栈：原生 TypeScript + Canvas 2D（或 Phaser 3）+ Vite

## 1. 一句话简介
按处方在百子柜里抓药，用戥子（小秤）把每一味药称到规定克数，抓准、抓快、不出错才能留住排队的病人。

## 2. 玩法与真实依据
中药房抓药的日常：看方 → 拉抽屉认药 → 戥子称量 → 分包 → 复核。
- 戥子读数靠手感，多一克少一克老药师一眼看得出来；
- 抽屉里药名相似（「白芍 / 赤芍」「生地 / 熟地」）极易拿错；
- 有「先煎」「后下」的药要单独包并贴标。

## 3. 核心玩法
1. **看方抓药**：左侧显示处方（3~8 味药 + 克数），右侧百子柜抽屉网格（药名在抽屉上，需辨认/记忆）。
2. **称量小游戏**：拖药到戥子托盘 → 出现指针/刻度 → 鼠标滚轮或拖砝码微调，指针进入 ±误差窗口才算合格；超差则提示重来。
3. **打包与复核**：称好后拖到药包区，全部完成进入复核阶段——系统随机抽一味，问「刚才白芍抓了 12g 还是 15g」（考察记忆）。
4. **时间压力**：门外病人排队，超时病人离开，满意度下降。

## 4. 关卡与难度曲线
- 第 1~3 关：3 味药、误差窗口 ±1.0g、无限时间（教学）。
- 第 4~8 关：5 味药、±0.5g、加入相似药名干扰项。
- 第 9 关起：加入「先煎/后下」分装要求、戥子需先归零、药柜抽屉会因抓取过多而变乱（需要整理）。
- 无尽模式：处方随机生成，逐关缩短时限。

## 5. 系统设计
```
场景：药房（主界面）→ 抓药面板 → 复核弹窗 → 结算
状态：Score / Combo / 病人满意度 / 剩余时间 / 已抓药包
```
```ts
type Prescription = { id: string; items: { herb: string; grams: number; decoct: 'normal'|'first'|'last' }[] };
type WeighResult   = { herb: string; target: number; actual: number; ok: boolean; deltaG: number };
type GameState     = { level: number; score: number; combo: number; queue: number; satisfaction: number; expired: boolean };
```

## 6. 核心机制实现
- **称量物理（伪物理即可，但要稳定）**：`pointer = clamp((load - zero) / fullScale)`；砝码加减为离散量（1g / 2g / 5g / 10g），滚轮 = 加减 0.5g 微调。
- **判定窗口**：`|actual - target| ≤ tol` 通过，`≤ 2*tol` 提示警告但计半分，超过则整味重抓（不扣命，扣时间）。
- **相似药名干扰**：抽屉药名从字形/读音相近的字典中抽（同偏旁、同音字），选错抽屉时给「拿错药」音效与红闪，但不直接结束（真实药房也会被复核拦下）。
- **分数**：`基础分(100) + 精度奖励(±窗口内线性) + 连击加成 - 超时惩罚`。

## 7. 美术与音效
- 木色药柜 + 白瓷托盘 + 黄铜戥子，俯视斜 45° 的 2.5D 视图；抽屉打开有阻尼动画。
- 药材质感用程序化绘制的小色块/颗粒（白芍偏白、熟地偏黑），不依赖商用素材。
- 音效：木抽屉抽拉、药材落盘沙沙声、戥子指针摆动、病人叹息。

## 8. 操作与适配
- 鼠标：拖拽 + 滚轮微调；键盘：`1~9` 直接选抽屉、`空格`确认、`Z`归零。
- 触摸：拖拽 + 双指微调（或「+ / -」按钮），所有点击区 ≥ 44px。

## 9. 验收标准
- 60fps 稳定；Canvas 单帧绘制调用 < 80 次。
- 关卡进度、最高分存 localStorage；重开一局不残留状态。
- 所有判定逻辑抽成纯函数（`judgeWeight`、`scoreRound`）并有单元测试。

## 10. 边界（刻意不做）
不做连连看/记忆翻牌/消除（黑名单玩法），不做经营店铺的订单系统；核心是「称重手感 + 认药」。

## 11. 容器化与构建（Docker）

本项目交付**必须能通过 Docker 构建与运行**，验收一律以容器内运行结果为准，禁止「在我机器上能跑」。

- **Dockerfile（多阶段）**
  - `builder`：`node:20-alpine` → `npm ci` → `npm run build`，产物 `dist/`
  - `runtime`：`nginx:1.27-alpine`，仅拷贝 `dist/` 与 `nginx.conf`，不含 node 与源码
- **docker-compose.yml**：服务名 `app-012`，端口 `8092:80`，`restart: unless-stopped`
- **nginx.conf**
  - SPA 回退：`try_files $uri $uri/ /index.html`
  - Canvas 贴图/音频等素材（`png/mp3/ogg`）长缓存 `immutable`
  - `index.html` 不缓存；开启 gzip
- **健康检查**：`HEALTHCHECK` 请求 `/healthz`
- **音效说明**：所有音效要么程序化合成，要么为公版素材并随镜像打包，禁止运行时拉外网资源

```bash
docker compose up -d --build
docker compose logs -f
docker compose down
```

- **验收**：`http://localhost:8092` 可玩；60fps 稳定；localStorage 存档在容器部署下正常；镜像体积 < 60MB。
