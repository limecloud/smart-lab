"""将写实生成图中的设备正面透视校正为真实三维模型的材质贴图。"""
from pathlib import Path
from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public/assets/twin"
OUTPUT = ASSETS / "textures"
OUTPUT.mkdir(parents=True, exist_ok=True)

# 各四边形依次为左上、右上、右下、左下，单位为源图像素。
# 只提取设备正面/台面，保留三维实体侧面、轮廓、遮挡与交互。
QUADS = {
    "flare": {
        "hood": ((146, 122), (415, 143), (414, 403), (147, 383)),
        "analyzer": ((1187, 113), (1540, 137), (1541, 420), (1188, 394)),
        "storage": ((1195, 499), (1538, 524), (1539, 882), (1195, 824)),
        "prep": ((61, 624), (415, 656), (548, 579), (211, 549)),
    },
    "sunburst": {
        "hood": ((142, 132), (457, 104), (457, 358), (145, 400)),
        "analyzer": ((1182, 112), (1545, 145), (1547, 442), (1183, 398)),
        "storage": ((1223, 504), (1568, 541), (1569, 895), (1224, 841)),
        "prep": ((25, 592), (426, 642), (527, 581), (133, 531)),
    },
}
SIZES = {"hood": (960, 960), "analyzer": (1024, 840), "storage": (840, 1000), "prep": (1024, 640)}
for model, devices in QUADS.items():
    with Image.open(ASSETS / f"lab-{model}.png") as source:
        for device, (upper_left, upper_right, lower_right, lower_left) in devices.items():
            quad = tuple(coordinate for point in (upper_left, lower_left, lower_right, upper_right) for coordinate in point)
            result = source.convert("RGB").transform(SIZES[device], Image.Transform.QUAD, quad, Image.Resampling.BICUBIC)
            result = ImageEnhance.Color(result).enhance(.88)
            result.save(OUTPUT / f"{model}-{device}.jpg", quality=92, optimize=True)
    with Image.open(ASSETS / f"robot-{model}-source.png") as robot:
        # 底盘正面局部用于金属与通风细节；机械臂保持真实几何。
        robot.convert("RGB").crop((480, 790, 1040, 1100)).resize((840, 465), Image.Resampling.LANCZOS).save(OUTPUT / f"{model}-robot-front.jpg", quality=91, optimize=True)
print("已生成两模型共10张三维设备材质贴图")
