# Cloudflare 发布与公网验收

日期：2026-11-06。目标地址：<https://smart-lab.limeai.run>。Worker 名称：`smart-lab`。

## 发布产物

- 初次发布版本：`893613f4-e56d-471f-bd51-ca87c7dbfced`。
- 最终发布版本：`5a45aaef-cda8-424b-a471-ec71b2ef4b61`；构建脚本为 `/assets/index-BB2Bd30W.js`，样式为 `/assets/index-FSKY-5Mo.css`。
- Cloudflare 自定义域名绑定完成，Workers 静态资产与 `LABS → LabSession` Durable Object 绑定已发布，使用 SQLite 迁移 `v1`。
- 首次上传 22 项静态资产；Worker 编译产物 36.72 KiB，gzip 10.06 KiB，发布工具报告启动时间 6 ms。该数值不是浏览器帧率或真机控制性能。
- 随后修正界面“实物图”的错误表述，明确为 AI 图像材质；第二次仅上传 HTML 与更新后的前端脚本，后端代码不变。

认证由本机已有 Wrangler OAuth 提供；仓库不包含 OAuth Token、图像服务密钥或其他部署凭证。

## 实际公网验证

[验收脚本](../../scripts/verify-cloudflare.mjs)连接 HTTPS 自定义域名，创建独立 Cookie 会话，实际通过：

| 检查 | 结果 |
| --- | --- |
| 网页与 `/api/health` | 200，仿真模式 |
| 会话初始化 | 六台设备、零个任务、随机会话 Cookie |
| 跨站写入与非法设备枚举 | 分别拒绝为 403、400 |
| 标准任务创建、暂停、恢复 | 成功 |
| SSE 与主动时钟 | 在不轮询状态的阶段，收到 alarm 推进后的机器人位置 |
| 独立访客 | 另一 Cookie 会话没有本次任务 |
| 机器人移动及完整流程 | 坐标改变，四倍速下完成标准分析 |
| 结果与持久状态回读 | 两个样品产生两条关联结果，再次请求仍为已完成 |
| CSV 与材质 | CSV 包含任务 ID，五张三维纹理返回 JPEG |

Chrome 另行操作真实线上前端，确认默认三维模式、五张材质加载、鼠标旋转、启动协同演示后创建两个任务、机器人坐标改变、刷新后保留任务、五个页面可访问，页面运行错误为零。结束截图见[线上控制台](screenshots/cloudflare.png)。

## DNS 与验收边界

发布后 Cloudflare 公共 DNS（DoH 与 `1.1.1.1`）以及本机 `dig` 已返回 `104.21.16.214`、`172.67.215.243`。本机系统 `getaddrinfo` 当时仍返回 `ENOTFOUND`，普通命令行验收因此中断，不能把该次尝试列为通过。

后端完整验收与浏览器完整操作采用公共 DNS 已返回的 IP 进行单次进程内解析映射，请求 URL、HTTP Host、TLS 主机名与证书校验均保持 `smart-lab.limeai.run`。没有关闭 TLS 校验、修改系统 DNS 或修改 hosts。浏览器早期普通访问也曾加载成功，但本记录不宣称所有本机解析路径都已刷新。

收尾检查时，普通 `curl https://smart-lab.limeai.run/api/health` 已经通过本机系统解析正常访问，返回 `{"ok":true,"mode":"simulation"}`，没有使用解析映射。完整功能场景的映射方式仍按上述实际执行情况保留。

线上状态回读证明请求间持久状态可用；DO 实例重建、移动插值和 alarm 重试的语义另由 6 项针对性测试验证。未人为触发线上区域故障或宣称真实机器人、仪器、现场采集已经接入。

当前画面仍是简化几何与生成图片材质的仿真原型，发布成功不代表已达到实物级重建，详见[写实化技术分析](../design/photorealism.md)。
