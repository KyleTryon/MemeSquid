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
  const radius = (line.smoothing / 100) * (12 / zoom);
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

  const points: number[] = [];
  let lastX = line.points.at(-2);
  let lastY = line.points.at(-1);
  let next = filteredPoint;
  // Subdivide sparse movements so fast turns remain curved. Cap work for large jumps.
  const steps = Math.min(512, Math.ceil((distance * zoom) / 2));
  for (let step = 1; step <= steps; step += 1) {
    next = filterAt((distance * step) / steps);
    if (
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

  return {
    ...stroke,
    line: points.length === 0 ? line : { ...line, points: [...line.points, ...points] },
    pointer: point,
    filteredPoint: next,
  };
};

export const finishDrawStroke = (stroke: DrawStroke, point: ViewportPoint): LineElement => {
  const { line } = appendDrawPoint(stroke, point);
  // Preserve the release position, including tiny strokes and the filter's trailing end.
  if (line.points.at(-2) === point.x && line.points.at(-1) === point.y) return line;
  return { ...line, points: [...line.points, point.x, point.y] };
};
