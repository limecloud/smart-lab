"""用已生成的写实素材和调度器采样帧合成 GIF / WebP 演示。依赖 Pillow。"""
from pathlib import Path
import json
import math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public/assets/twin"
WIDTH, HEIGHT = 1120, 630
FONT_PATH = "/System/Library/Fonts/PingFang.ttc"
FONT_FALLBACK = "/Library/Fonts/Arial Unicode.ttf"
font_path = FONT_PATH if Path(FONT_PATH).exists() else FONT_FALLBACK
font = ImageFont.truetype(font_path, 16)
small = ImageFont.truetype(font_path, 12)
title = ImageFont.truetype(font_path, 22)


def project(position):
    x, z = position
    back_t, front_t, depth = (x + 5) / 9, (x + 5) / 11, (z + 3) / 6
    back = (34 + 36 * back_t, 48 + back_t)
    front = (35 + 34 * front_t, 84 + 2 * front_t)
    return ((back[0] + (front[0] - back[0]) * depth) * WIDTH / 100,
            (back[1] + (front[1] - back[1]) * depth) * HEIGHT / 100)


def pill(draw, xy, text, color=(102, 243, 206), width=None):
    x, y = xy
    box = draw.textbbox((0, 0), text, font=small)
    w = width or box[2] - box[0] + 20
    draw.rounded_rectangle((x, y, x + w, y + 27), 6, fill=(10, 25, 34, 225), outline=(68, 99, 105, 210))
    draw.text((x + 10, y + 5), text, font=small, fill=color)


base = Image.open(ASSETS / "lab-sunburst.png").convert("RGBA").resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
sprites = [Image.open(ASSETS / f"robot-{model}.png").convert("RGBA") for model in ("flare", "sunburst")]
samples = json.loads((ROOT / "test-results/demo-frames.json").read_text())
frames = []
trails = {"robot-01": [], "robot-02": []}
for index, state in enumerate(samples):
    frame = base.copy()
    overlay = Image.new("RGBA", frame.size)
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, 0, WIDTH, 66), fill=(8, 20, 29, 240))
    draw.text((24, 13), "LimeLab  /  实验室数字孪生", font=title, fill=(229, 242, 241))
    draw.text((25, 43), "AI 写实素材 · 后端调度器采样 · 离线仿真演示", font=small, fill=(144, 170, 179))
    pill(draw, (WIDTH - 183, 20), f"SIM TIME  {state['time']:05.1f}s", width=158)
    for robot in (device for device in state["devices"] if device["kind"] == "robot"):
        point = project(robot["position"])
        trail = trails[robot["id"]]
        trail.append(point)
        if len(trail) > 2:
            draw.line(trail[-35:], fill=(23, 204, 173, 180), width=3)
        x, y = point
        rx, ry = 38, 11
        glow = int(100 + 70 * math.sin(index * .3) ** 2)
        draw.ellipse((x-rx, y-ry, x+rx, y+ry), fill=(1, 39, 36, 65), outline=(44, 230, 196, glow), width=2)
    frame = Image.alpha_composite(frame, overlay)
    robot_devices = sorted((d for d in state["devices"] if d["kind"] == "robot"), key=lambda d: project(d["position"])[1])
    for robot in robot_devices:
        x, y = project(robot["position"])
        sprite = sprites[0 if robot["id"] == "robot-01" else 1].copy()
        sprite_width = round(WIDTH * (.072 + .025 * min(1, max(0, (y / HEIGHT - .48) / .4))))
        sprite.thumbnail((sprite_width, sprite_width * 2), Image.Resampling.LANCZOS)
        frame.alpha_composite(sprite, (round(x - sprite.width / 2), round(y - sprite.height)))
        labels = ImageDraw.Draw(frame)
        pill(labels, (x - 49, y + 10), robot["id"].upper().replace("ROBOT", "AMR"), width=98)
    bottom = Image.new("RGBA", frame.size)
    draw = ImageDraw.Draw(bottom)
    draw.rectangle((0, HEIGHT - 66, WIDTH, HEIGHT), fill=(8, 20, 29, 238))
    for task_index, task in enumerate(state["tasks"]):
        x = 24 + task_index * 410
        draw.text((x, HEIGHT - 55), task["name"], font=font, fill=(224, 239, 238))
        step_index = min(task["currentStepIndex"], len(task["steps"]) - 1)
        status = "已完成" if task["status"] == "completed" else task["steps"][step_index]["name"]
        draw.text((x, HEIGHT - 30), f"{status}  ·  {round(task['progress'] * 100)}%", font=small, fill=(99, 226, 195))
    frame = Image.alpha_composite(frame, bottom).convert("RGB")
    frames.append(frame)

# 共享调色板保证固定背景的颜色稳定，降低逐帧色彩抖动。
palette = frames[len(frames) // 2].quantize(colors=256)
gif_frames = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
gif_frames[0].save(ASSETS / "lab-simulation.gif", save_all=True, append_images=gif_frames[1:], duration=100, loop=0, optimize=True, disposal=1)
frames[0].save(ASSETS / "lab-simulation.webp", save_all=True, append_images=frames[1:], duration=100, loop=0, quality=78, method=4)
frames[len(frames)//2].save(ASSETS / "lab-simulation-poster.jpg", quality=91)
print(f"已生成 {len(frames)} 帧、9.6 秒、1120×630 GIF / WebP 仿真演示")
