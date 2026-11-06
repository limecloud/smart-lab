# REA 浏览器运行证据

记录日期：2026-11-06。分析对象是本项目在 `http://127.0.0.1:4313/` 运行的本地仿真页面，**不是 HintonAI 原厂软件**。未取得原厂发布包或可确认的原厂页面，不声称反编译或恢复其代码。

本次使用已安装的 REA CLI 的 `capture-browser-scenario`，启动由 REA 管理的无头 Chrome。运行视口为 1512×982，语言为 `zh-CN`，时区为 `Asia/Shanghai`。没有操作用户使用的 4311 服务。

## 证据清单

| 记录 | Evidence ID | 场景摘要 | 实际结果 |
| --- | --- | --- | --- |
| [初次运行](rea-runtime.json) | `ev_3fd6897b13c31b6902acf5966a1e640a6e49a2ed383fc2862e3659a245f668a0` | `scenario_sha256=a0e0bb2b3b92b9ca7437dd6275723620b41641ad54e01f5d5abca909d43cf2b3` | 40.314 秒；10 个声明动作完成，第 11 个动作失败，后 2 个取消 |
| [修正场景后复验](rea-runtime-rerun.json) | `ev_1546a8b0439b00c0beba11d1a45aeb4f0517d480677b4c2140790ef1b27f3225` | `scenario_sha256=26e3098da1782a8374f2913a3372fe254a4955593b539f5a520688bfd99ce881` | 50.706 秒；13 个声明动作全部完成；含初始导航共 14 步完成 |

两个记录的 `confidence` 均为 `observed`，`authority` 均为 `controlled-replay`。原始失败证据保留不变；[当前场景文件](rea-scenario.json) 是修正后的版本。初始动作定义也完整保存在初次 Evidence 的 `parameters.actions` 中。

## 初次失败与唯一一轮复验

初次运行在 `wait-results` 使用 `.results-table tbody tr`。页面已有多个结果行，Playwright 的严格定位要求唯一元素，该选择器实际匹配 14 个元素，因而报 `strict mode violation`。错误展开中可见“REA 运行验收”的 `S001`、`S002` 两个样品行。这是场景定位器错误，不能把失败记录写成全场景通过。

仅把定位器收窄为 `.results-table tbody tr:first-child`，没有更改应用数据或检查所要求的可见状态，随后运行一次：

```bash
rea capture-browser-scenario \
  "/Users/coso/Documents/dev/ai/limecloud/limeiot/smart-lab/docs/evidence/rea-scenario.json" \
  --format json \
  > "/Users/coso/Documents/dev/ai/limecloud/limeiot/smart-lab/docs/evidence/rea-runtime-rerun.json"
```

| 步骤 | 实际操作或等待条件 | 初次运行 | 复验 |
| --- | --- | --- | --- |
| `scenario_start` | 导航到本地页面 | completed | completed |
| `wait-live-state` | 等待在线连接指示 | completed | completed |
| `set-simulation-speed` | 选择 4 倍仿真速率 | completed | completed |
| `open-create-task` | 打开新建实验 | completed | completed |
| `choose-workflow` | 选择 `workflow-standard` | completed | completed |
| `name-task` | 填入“REA 运行验收” | completed | completed |
| `set-sample-count` | 样品数量设为 2 | completed | completed |
| `create-and-run` | 创建并运行 | completed | completed |
| `wait-task-completed` | 等待任务完成标记可见 | completed | completed |
| `close-task-details` | 关闭任务详情 | completed | completed |
| `open-results` | 打开数据页面 | completed | completed |
| `wait-results` | 等待一个结果行可见 | failed：定位到多个元素 | completed |
| `return-overview` | 返回实验总览 | cancelled：前序失败 | completed |
| `wait-3d-scene` | 等待 Three.js canvas 可见 | cancelled：前序失败 | completed |

复验中以上各步的 `error` 均为 `null`；最后一步同时完成结束产物采集。

## 直接观察

- 复验记录了创建任务的 `POST /api/tasks` 返回 201、仿真配置的 `POST /api/simulation` 返回 200、状态与 SSE 请求返回 200。
- 页面中的任务完成标记、结果表第一行、返回总览后的三维 canvas 均满足声明的可见性条件。
- 最终 DOM 中可见 Three.js `r181` canvas、已加载材质计数 `data-textures="5"`、任务 100% 与 10/10 步骤的显示。
- 复验结束截图已嵌入 JSON：PNG，314071 字节，SHA-256 为 `e67a228b3fb619448bd6c4f6aa9f72d66b794102ae18e0e9b721eb399925a867`。DOM 已嵌入 JSON：27394 字节，SHA-256 为 `fae44af27a8cbac12a868e75af65c116cde7d909371369689b93cde7f57a8662`。最终 URL 也已采集。

这些观察支持“本地用户操作能创建并完成一个模拟实验，并返回可见的三维场景”。它们不单独证明模型几何精度、渲染与实拍一致、所有输入组合正确或真实仪器执行成功。结果数量与幂等的更精确断言由[自动化验证](validation.md)中的引擎/API 测试承担。

## 完整性与未知项

复验的**动作场景已完成，Evidence 整体完整性仍为 `incomplete`**，`equality_eligible=false`，`missing_sections=["events"]`。原因是采集结束时 `/api/stream` 的 EventSource 长连接还未结束，记录为 `request-unfinished`、`reason=capture-ended`；这不等于 SSE 请求失败，也不代表之后的网络活动已知。

复验保留 48 条事件，丢弃 0 条，没有截断段。初次记录则缺少 action、DOM、events、screenshot、URL；后续动作和结束产物不能由初次记录补推。

REA 自带的限制仍适用：

- 该观察没有绑定可验证的发布产物身份；不能把运行地址与某个原厂二进制或源码版本等同。
- 浏览器事件顺序是提供者接收顺序，不证明并发事件的因果关系；未获取请求发起调用栈。
- 场景禁用了请求正文、响应正文与请求头值的采集。这里的 HTTP 记录支持方法、URL 与状态码，不支持正文内容或全部后端状态断言。
- 未请求的存储、辅助功能和历史记录不能当作已检查。提供者记录浏览器进程已清理，但宿主平台和架构没有被观察。
- 未观察原厂软件、真机、现场传感器或公网部署。Cloudflare 线上验收尚未完成。

需要再次验证时应在明确版本和独立仿真状态上运行场景，保存新的 Evidence，不覆盖历史失败或把未完成的网络采集改标为完全。
