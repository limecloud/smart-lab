# 来源台账

访问日期均为 **2026-11-06**。本次实际读取原页或官方仓库原文；搜索结果仅用于发现材料。正文中的事实与参考设计分开，以下资料不用于证明 HintonAI 的内部实现或真机性能。

| ID | 来源与组织 | URL | 版本/发布日期 | 实际读取范围与用途 |
| --- | --- | --- | --- | --- |
| S01 | 用户提供的直播截图 | 用户会话中的本地参考图 | 截图未标注产品版本；本地文件名含时间戳，不作为产品发布日期 | 可见标题、八个标签、仪器与两台复合移动机器人；只能支持视觉内容 |
| S02 | Standards / SiLA Rapid Integration | <https://sila-standard.com/standards/> | 页面介绍 SiLA 2 v1.1；页面未标注整体发布日期 | HTTP/2、Protocol Buffers、gRPC、Feature/Command/Property、读板机协作示例 |
| S03 | Motion Planning / MoveIt Documentation | <https://moveit.picknik.ai/main/doc/concepts/motion_planning.html> | Rolling 文档；页面未标注发布日期 | 规划接口、碰撞检查、目标位姿、关节约束、轨迹时间参数化 |
| S04 | RMF Demos / Open-RMF 官方仓库 | <https://github.com/open-rmf/rmf_demos>；实际原文：<https://raw.githubusercontent.com/open-rmf/rmf_demos/main/README.md> | main 分支读取快照；README 未标注统一发布日期 | 异构车队、交通与资源冲突、任务分配、电池任务、API/Web 可视化示例 |
| S05 | PyLabRobot 官方 README | <https://github.com/PyLabRobot/pylabrobot>；实际原文：<https://raw.githubusercontent.com/PyLabRobot/pylabrobot/main/README.md> | main 分支读取快照；README 引用 2023 年论文 | 硬件无关接口、支持设备范围、Python async/await、板读取与液体操作示例、浏览器 Visualizer |
| S06 | Nav2 官方文档与仓库 README | <https://docs.nav2.org/rolling/>；<https://raw.githubusercontent.com/ros-navigation/navigation2/main/README.md> | Rolling 文档及 main 分支读取快照；页面未标注发布日期 | 文档 Overview 正文：感知、规划、控制、定位、避障，行为树编排模块化服务；README 确认项目和文档入口 |
| S07 | Open-RMF 官方介绍 | <https://www.open-rmf.org/> | 页面未标注发布日期；治理部分提到 2024 年以来 OSRA 管理 | 项目定位：异构车队、门、电梯与楼宇基础设施之间的互操作 |
| S08 | RMF Web 官方 README | <https://github.com/open-rmf/rmf-web>；实际原文：<https://raw.githubusercontent.com/open-rmf/rmf-web/main/README.md> | main 分支读取快照；README 未标注统一发布日期 | Web 界面、独立 API 服务、仪表盘、车队适配器状态入口；未运行容器和 ROS 系统 |

## 关键原文与支持范围

### S02：SiLA 的接口与跨设备流程

> “SiLA 2 runs over HTTP/2 and uses Protocol Buffers to serialize payload data.”

> “Each Feature exposes Commands that can be called (with Parameters) and Properties that can be read or registered to.”

正文还明确其采用 gRPC 的线格式，并用 LIMS、板搬运器与读板机的顺序调用说明协作。这支持能力建模和设备完成后推进工作流的通用方案。不能据此确认截图中的任何仪器支持 SiLA，也不能推断端到端兼容性已验证。

### S03：机械臂规划与轨迹

> “Collisions are checked for by default (including self-collisions and attached objects).”

> “the result coming out of move_group is a trajectory and not just a path.”

文档解释目标关节/末端位姿与速度、加速度约束。这支持把机械臂运动交给有约束的运动规划和控制系统；不支持把任何浏览器动画视为已规划、已标定的真实动作。

### S04：多机器人与 Web 状态

> “Open-RMF also handles task allocation and conflict resolution among its participants”

> “the fleetadapter will update rmf-web api-server with the latest task and robot states.”

README 提供多个场景，任务调度章节描述 Dispatcher、BidNotice、BidProposal 和 DispatchRequest；电池充电任务可注入机器人日程。这里只将其作为已公开的开源设计参考，未运行这些 ROS 演示。

### S05：仪器适配范围

> “a hardware agnostic, pure Python library for liquid handling robots, plate readers, pumps, scales, heater shakers, and other lab automation equipment.”

> “a browser-based Visualizer which can visualize the state of the deck during a run”

官方 README 列出当前支持硬件与示例。结论限于“存在统一接口与可视化路线”；硬件无关不等于支持所有仪器，文档也不等于本次已用真机验证。

### S07：Open-RMF 定位

> “sharing and interoperability between multiple fleets of robots and physical infrastructure, like doors, elevators and building management systems.”

支持多车与基础设施协作的职责划分。不支持声称该项目已被截图中的厂商使用。

### S06：Nav2 导航职责

> “It provides perception, planning, control, localization, visualization, behaviors”

> “Nav2 uses behavior trees to create customized and intelligent navigation behavior via orchestrating many independent modular servers.”

实际读取的是官方首页 Overview 正文。该页还说明模块通过 ROS action/server 或 service 协作。这支持导航服务与上层实验流程分工的设计；页面上的部署数量等推广数字未作为本研究的独立统计事实使用。

### S08：独立 Web 界面

> “a web-based interface for users to visualize and control all aspects of Open-RMF deployments.”

README 分别说明 API 服务、仪表盘与 fleet adapter 的状态上报配置。这是公开参考项目的说明，未将其解释为截图原厂的前端栈，也未按文档执行安装或全局环境修改。

## 检索边界

检索过 “HintonAI”“辛顿人工智能”“辛顿 人工智能 实验室 机器人”“智能实验室 辛顿”等关键词。当前环境下 Bing 未提供可确认的目标结果，百度要求安全验证，Google 与 DuckDuckGo 请求不可达。没有绕过验证、登录或访问限制。

对若干直觉域名的 DNS/HTTP 检查未建立可确认的厂商身份；可解析或名称相似也不等于官网。未把这些候选域名写作原厂来源。原厂检索属于有界负面结果，并不代表互联网上不存在相关资料。

官方文档有重定向和版本目录：`docs.nav2.org/` 返回指向 `rolling/` 的跳转页，猜测的 `rolling/about/index.html` 为 404；PyLabRobot 根页没有可用正文，读取了官方 README。上述失败页面不用于支持技术结论。

## 维护方式

官方 main 与 Rolling 文档会变化。后续真机选型时，应记录选定发行版、驱动版本与设备固件，并重新核对相关接口。新增性能或市场结论需要独立数据来源，不用宣传页覆盖实测记录。
