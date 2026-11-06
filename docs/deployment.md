# Cloudflare 部署

目标地址：<https://smart-lab.limeai.run>。这是仿真演示，未连接机器人、仪器或外部图像服务。

## 运行结构

Cloudflare Workers 提供静态前端与同源 `/api`。每个浏览器使用随机、HttpOnly、SameSite=Lax Cookie 选择独立的 SQLite Durable Object；HTTPS 下 Cookie 同时设置 Secure，有效期 30 天。不同浏览器的任务、流程与结果相互隔离，同一浏览器可刷新继续查看；清除或过期 Cookie 会进入新实验室。此会话机制不代替用户账号和生产权限系统。

Durable Object 复用本地的 `LabEngine`，通过约一秒间隔的 alarm 推进任务，将状态与墙钟时间一起持久化，通过 SSE 推送到页面。alarm 触发可能延迟，下次 alarm 或请求会按墙钟补算；这是仿真调度，不是恒定频率的机器人控制。对象唤醒会重建资源锁与剩余移动插值，继续模拟任务；没有运行任务和订阅时停止 alarm。SSE 空闲时约十五秒保活，积压的慢连接关闭后由 EventSource 重连。与此不同，本地 Node 进程重启默认暂停未完成任务。

`/api/health` 只报告 Worker 可达和仿真模式，不访问用户会话。`/api/state`、任务操作和 SSE 才访问 Durable Object。状态写入失败会返回错误，不把未持久化的操作当作成功响应。

## 本地验证

需要 Node.js 22.12+。项目固定 Wrangler 版本，无需全局安装。

```bash
npm ci
npm run cf:dev
```

默认访问 <http://localhost:8787>。Wrangler 使用本机 workerd 与独立的 `.wrangler/` 状态目录；该目录不进入 Git。本地调试不需要把图像服务密钥放入 `.env` 或 Worker Secrets。

## 发布

配置位于 [wrangler.jsonc](../wrangler.jsonc)，包含静态资产、自定义域名、Durable Object 绑定和首次 SQLite 类迁移。域名 `limeai.run` 必须位于部署账号中。

```bash
npx wrangler whoami
# 若部署机器尚未认证：npx wrangler login
npm run deploy
```

发布只上传构建产物、源码编译后的 Worker 和预生成图片；不依赖本机常驻进程或 Cloudflare Tunnel。认证信息由 Wrangler 管理，不进入仓库。后续发布保留同名 Worker、DO 类与迁移历史；不要为发布清理远端会话存储。

## 发布后验收

```bash
npm run verify:cloudflare
# 检查本机边缘运行时：
npm run verify:cloudflare -- http://localhost:8787
```

验收脚本创建独立浏览器会话和两个样品的标准实验，检查网页、健康检查、同源约束、非法输入、暂停与恢复、SSE、访客隔离、机器人坐标变化、任务完成、结果回读、CSV 和纹理。任务完成的验证可能需要约 20 秒。

脚本的状态回读证明请求之间数据可用；对象实例重建与 alarm 重试语义由针对性回归测试验证。它不模拟 Cloudflare 全区域故障，也不证明真机性能。实际发布版本与线上浏览器验收见[部署记录](evidence/deployment.md)。
