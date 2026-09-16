import type { ViewportPoint } from './canvasViewport';
import type { LineElement } from './types';

export const appendDrawPoint = (line: LineElement, point: ViewportPoint): LineElement => {
  const lastX = line.points.at(-2);
  const lastY = line.points.at(-1);
  if (lastX !== undefined && lastY !== undefined) {
    const dx = point.x - lastX;
    const dy = point.y - lastY;
    // Ignore movements under five canvas pixels to smooth the stroke.
    if (dx * dx + dy * dy < 25) return line;
  }

  return { ...line, points: [...line.points, point.x, point.y] };
};
