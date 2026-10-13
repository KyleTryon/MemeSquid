import { getPointDistance, type ViewportPoint } from './canvasViewport';
import type { LineElement } from './types';

export interface DrawStroke {
  line: LineElement;
  zoom: number;
  pointer: ViewportPoint;
  filteredPoint: ViewportPoint;
}

export const createDrawStroke = (
  line: Omit<LineElement, 'points'>,
  point: ViewportPoint,
  zoom: number,
): DrawStroke => ({
  line: { ...line, points: [point.x, point.y] },
  zoom,
  pointer: point,
  filteredPoint: point,
});

const sampleDrawSegment = (
  line: LineElement,
  distance: number,
  zoom: number,
  pointAt: (progress: number) => ViewportPoint,
  includeEndpoint: boolean,
): LineElement => {
  const points: number[] = [];
  let lastX = line.points.at(-2);
  let lastY = line.points.at(-1);
  // Subdivide sparse movements so fast turns remain curved. Cap work for large jumps.
  const steps = Math.min(512, Math.ceil((distance * zoom) / 2));
  for (let step = 1; step <= steps; step += 1) {
    const next = pointAt(step / steps);
    if (
      (!includeEndpoint || step < steps) &&
      lastX !== undefined &&
      lastY !== undefined &&
      Math.hypot(next.x - lastX, next.y - lastY) * zoom < 0.5
    ) {
      continue;
    }
    points.push(next.x, next.y);
    lastX = next.x;
    lastY = next.y;
  }
  return points.length === 0 ? line : { ...line, points: [...line.points, ...points] };
};

export const appendDrawPoint = (stroke: DrawStroke, point: ViewportPoint): DrawStroke => {
  const distance = getPointDistance(stroke.pointer, point);
  if (distance === 0) return stroke;

  const { line, zoom, pointer, filteredPoint } = stroke;
  if (line.smoothing === 0) {
    return {
      ...stroke,
      line: { ...line, points: [...line.points, point.x, point.y] },
      pointer: point,
      filteredPoint: point,
    };
  }

  // A spatial low-pass filter has the same response regardless of event frequency.
  // Measurements are screen pixels so zooming does not change the brush's feel.
  // The upper range deliberately provides strong stabilization, while the quadratic
  // response keeps lower settings responsive (50% = 20px, 100% = 80px).
  const radius = (line.smoothing / 100) ** 2 * (80 / zoom);
  const direction = { x: (point.x - pointer.x) / distance, y: (point.y - pointer.y) / distance };
  const filterAt = (travel: number): ViewportPoint => {
    const decay = Math.exp(-travel / radius);
    return {
      x:
        pointer.x +
        direction.x * (travel - radius) +
        (filteredPoint.x - pointer.x + direction.x * radius) * decay,
      y:
        pointer.y +
        direction.y * (travel - radius) +
        (filteredPoint.y - pointer.y + direction.y * radius) * decay,
    };
  };

  return {
    ...stroke,
    line: sampleDrawSegment(
      line,
      distance,
      zoom,
      (progress) => filterAt(distance * progress),
      false,
    ),
    pointer: point,
    filteredPoint: filterAt(distance),
  };
};

export const finishDrawStroke = (stroke: DrawStroke, point: ViewportPoint): LineElement => {
  const { line, zoom } = appendDrawPoint(stroke, point);
  // Preserve the release position, including tiny strokes and the filter's trailing end.
  if (line.points.at(-2) === point.x && line.points.at(-1) === point.y) return line;
  const start = { x: line.points.at(-2) ?? point.x, y: line.points.at(-1) ?? point.y };
  // Sample the settling tail too: a single long segment makes curve interpolation
  // overshoot when strong smoothing leaves the tip far behind the pointer.
  return sampleDrawSegment(
    line,
    getPointDistance(start, point),
    zoom,
    (progress) => ({
      x: progress === 1 ? point.x : start.x + (point.x - start.x) * progress,
      y: progress === 1 ? point.y : start.y + (point.y - start.y) * progress,
    }),
    true,
  );
};
