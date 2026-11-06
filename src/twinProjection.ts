/** 固定相机生成图的画面配准点；坐标为原始16:9图像宽高的百分比。 */
export type TwinModel = 'flare' | 'sunburst';
export type Point2D = { x: number; y: number };
export interface ProjectionCalibration {
  hood: Point2D;
  analyzer: Point2D;
  prep: Point2D;
  storage: Point2D;
}

export const twinCalibration: Record<TwinModel, ProjectionCalibration> = {
  flare: { hood: { x: 34, y: 48 }, analyzer: { x: 70, y: 49 }, prep: { x: 35, y: 84 }, storage: { x: 69, y: 86 } },
  sunburst: { hood: { x: 34, y: 48 }, analyzer: { x: 70, y: 49 }, prep: { x: 35, y: 84 }, storage: { x: 69, y: 86 } },
};

const deviceAnchors: Record<TwinModel, Record<string, Point2D>> = {
  flare: { 'station-hood': { x: 17, y: 41 }, 'station-analyzer': { x: 84, y: 44 }, 'station-prep': { x: 18, y: 86 }, 'station-storage': { x: 84, y: 90 } },
  sunburst: { 'station-hood': { x: 17, y: 40 }, 'station-analyzer': { x: 84, y: 46 }, 'station-prep': { x: 18, y: 84 }, 'station-storage': { x: 85, y: 92 } },
};

export function projectDeviceAnchor(deviceId: string, position: [number, number], model: TwinModel): Point2D {
  return deviceAnchors[model][deviceId] ?? projectPosition(position, model);
}

export function projectPosition(position: [number, number], model: TwinModel): Point2D {
  const [x, z] = position;
  const { hood, analyzer, prep, storage } = twinCalibration[model];
  const backT = (x + 5) / 9;
  const frontT = (x + 5) / 11;
  const depth = (z + 3) / 6;
  const back = { x: hood.x + (analyzer.x - hood.x) * backT, y: hood.y + (analyzer.y - hood.y) * backT };
  const front = { x: prep.x + (storage.x - prep.x) * frontT, y: prep.y + (storage.y - prep.y) * frontT };
  return { x: back.x + (front.x - back.x) * depth, y: back.y + (front.y - back.y) * depth };
}

export function dockingPosition(position: [number, number]): [number, number] {
  return [position[0], position[1] < 0 ? position[1] + 1.65 : position[1] - 1.65];
}
