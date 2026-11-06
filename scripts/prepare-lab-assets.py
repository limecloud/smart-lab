"""下载有明确许可的三维源文件和实拍 PBR/HDR 资产；无需 API 密钥。"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import urllib.request
import xml.etree.ElementTree as ET
from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "node_modules/.cache/smart-lab-assets"
PUBLIC = ROOT / "public/assets/physical"
REVISION = "98a70c569c4c1b6da467a20012f766ee1f8dc521"
BASE = f"https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/{REVISION}/franka_emika_panda"
CACHE.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)

def download(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "SmartLab-asset-builder/1.0"})
        target.write_bytes(urllib.request.urlopen(request, timeout=60).read())
    return target.read_bytes()

xml = download(BASE + "/panda.xml", CACHE / "panda.xml")
download(BASE + "/LICENSE", PUBLIC / "PANDA-LICENSE.txt")
download(BASE + "/README.md", CACHE / "panda-README.md")
root = ET.fromstring(xml)
meshes = {item.get("name", Path(item.get("file")).stem): item.get("file") for item in root.findall("./asset/mesh")}
visuals = {item.get("mesh") for item in root.findall(".//geom") if item.get("class") == "visual"}
jobs = [(BASE + "/assets/" + meshes[name], CACHE / "panda" / meshes[name]) for name in visuals]
with ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(lambda item: download(*item), jobs))

def values(item, name, default):
    return [float(value) for value in item.get(name, default).split()]

def body(item):
    joint = item.find("joint")
    return {
        "name": item.get("name"), "position": values(item, "pos", "0 0 0"),
        "quaternion": values(item, "quat", "1 0 0 0"),
        "joint": None if joint is None else {"name": joint.get("name"), "slide": joint.get("class") == "finger"},
        "meshes": [{"file": meshes[geom.get("mesh")], "material": geom.get("material", "white")} for geom in item.findall("geom") if geom.get("class") == "visual"],
        "children": [body(child) for child in item.findall("body")],
    }

(CACHE / "panda-rig.json").write_text(json.dumps(body(root.find("./worldbody/body")), indent=2))

downloads = []
for name, channels in [("studio_small_09", {"hdri": "hdr"}), ("concrete_floor_02", {"Diffuse": "jpg", "Rough": "jpg", "nor_gl": "jpg"})]:
    metadata = json.loads(download(f"https://api.polyhaven.com/files/{name}", CACHE / f"{name}.json"))
    for channel, extension in channels.items():
        source = metadata[channel]["1k"][extension]
        target = PUBLIC / f"{name}-{channel.lower()}.{extension}"
        content = download(source["url"], target)
        if hashlib.md5(content).hexdigest() != source["md5"]:
            raise RuntimeError(f"下载摘要不匹配：{target.name}")
        downloads.append({"file": str(target.relative_to(ROOT)), "source": source["url"], "license": "CC0-1.0", "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)})

license_html = download("https://polyhaven.com/license", CACHE / "polyhaven-license.html").decode()
if "CC0" not in license_html: raise RuntimeError("需要重新核验 Poly Haven 许可页面")
download("https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt", PUBLIC / "POLYHAVEN-CC0.txt")
with Image.open(PUBLIC / "concrete_floor_02-diffuse.jpg") as image:
    image = ImageEnhance.Contrast(ImageEnhance.Color(image).enhance(0)).enhance(.1)
    image = Image.blend(image, Image.new("RGB", image.size, (194, 201, 202)), .66)
    image.save(PUBLIC / "lab-floor-albedo.jpg", quality=91, optimize=True)
floor = PUBLIC / "lab-floor-albedo.jpg"
(PUBLIC / "SOURCES.json").write_text(json.dumps({
    "panda": {"repository": "https://github.com/google-deepmind/mujoco_menagerie", "revision": REVISION, "path": "franka_emika_panda", "license": "Apache-2.0", "sourceDescription": "Public Franka Panda visual meshes; converted from MJCF visual hierarchy to a web GLB. Mobile base and laboratory are independent reference designs."},
    "photographicAssets": downloads,
    "floorDerivative": {"file": str(floor.relative_to(ROOT)), "source": "concrete_floor_02-diffuse.jpg", "processing": "Desaturated, reduced contrast, and blended with a resin-floor tint. Reference design material, not a measured laboratory surface.", "sha256": hashlib.sha256(floor.read_bytes()).hexdigest()},
}, ensure_ascii=False, indent=2) + "\n")
print(f"已准备 {len(jobs)} 个机械臂网格与 {len(downloads)} 项实拍材质/光照资产")
