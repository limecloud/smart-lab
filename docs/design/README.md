# 写实孪生视图与动画素材

使用用户指定的 `https://img.aishenji.top/v1`，通过 imagegen CLI 分别调用 `gpt-image-2.6-flare` 和 `gpt-image-2.6-sunburst`。两种模型各生成一张实验室环境和一张复合移动机器人图，共四张原始素材。密钥没有写入项目。

## 素材与来源

| 内容 | 交付文件 | 提示词 / 后处理 |
| --- | --- | --- |
| Flare 实验室 | [PNG](../../public/assets/twin/lab-flare.png) | [实验室提示词](laboratory-prompt.txt) |
| Sunburst 实验室 | [PNG](../../public/assets/twin/lab-sunburst.png) | 同上 |
| Flare 机器人 | [透明 PNG](../../public/assets/twin/robot-flare.png) | [机器人提示词](robot-prompt.txt)，品红背景抠图、去色溢、裁透明边缘 |
| Sunburst 机器人 | [透明 PNG](../../public/assets/twin/robot-sunburst.png) | 同上 |
| 仿真演示 | [GIF](../../public/assets/twin/lab-simulation.gif) / [WebP](../../public/assets/twin/lab-simulation.webp) | 后端调度器采样、Pillow 逐帧合成 |
| 动画封面 | [JPG](../../public/assets/twin/lab-simulation-poster.jpg) | 取动画中间帧 |

[素材记录](assets.json) 保留图片尺寸、帧数、文件摘要与生成方式。模型实际返回环境图 1672×941、机器人原图 1254×1254；未将提示词中的目标尺寸误报为输出尺寸。

## 实时三维与图片参考

默认“融合孪生”为可旋转、平移、缩放的 Three.js 场景。设备具有真实三维几何，仪器和底盘正面使用生成图中裁取、透视校正的纹理，机械臂使用关节层级动画；环境反射、阴影、设备选择、路径与机器人位置均保留。当前是简化模型与生成纹理的组合，不能等同于实物建模或摄影测量重建，见[真实性与三维资产路线](photorealism.md)。

可选“写实参考”使用固定相机图片，按实时 SSE 数据叠加透明机器人、路径、设备热点和任务状态。Flare 和 Sunburst 可切换，导航地面和设备锚点分别配准；参数集中在 [twinProjection.ts](../../src/twinProjection.ts)。该模式采用二维投影，不能提供自由视角的三维遮挡与碰撞计算。两种模式均为仿真状态，未接入现场传感器。

`public/assets/twin/textures/` 保存两模型共十张纹理，其中准备台纹理留作来源记录，实时场景保留原生台面与试管几何。重建纹理可运行 `uv run --no-project --with pillow python "scripts/make-twin-textures.py"`。

GIF 为 **96 帧、9.6 秒、1120×630** 的离线演示，不跟随当前任务；页面会明确标注。它使用本项目调度器运行两条默认流程后采样，能展示机器人导航与任务进度，但不等同于视频模型生成或实拍。

## 重建演示动画

素材已随项目保存，启动服务不需要图像 API。修改流程或图像后可以重新生成演示：

```bash
node --import tsx "scripts/export-demo-frames.ts"
uv run --no-project --with pillow python "scripts/render-twin-preview.py"
```

合成脚本当前使用 macOS 的 PingFang 字体，回退到 Arial Unicode；其他平台需要把字体路径替换为本机可用的中文字体。脚本只采样独立引擎并写出动画文件，不调用运行中的控制服务。
