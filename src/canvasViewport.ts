export interface ViewportPoint {
  x: number;
  y: number;
}

export interface ViewportRectOrigin {
  left: number;
  top: number;
}

export const clampZoom = (zoom: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, zoom));

export const getPointDistance = (first: ViewportPoint, second: ViewportPoint): number =>
  Math.hypot(second.x - first.x, second.y - first.y);

export const getPointCenter = (first: ViewportPoint, second: ViewportPoint): ViewportPoint => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
});

export const getPinchZoom = (
  initialZoom: number,
  initialDistance: number,
  currentDistance: number,
  minimum: number,
  maximum: number,
): number => {
  if (initialDistance <= 0 || currentDistance <= 0) {
    return clampZoom(initialZoom, minimum, maximum);
  }

  return clampZoom(initialZoom * (currentDistance / initialDistance), minimum, maximum);
};

export const getLogicalPointAtClientPosition = (
  rect: ViewportRectOrigin,
  clientPoint: ViewportPoint,
  zoom: number,
): ViewportPoint => ({
  x: (clientPoint.x - rect.left) / zoom,
  y: (clientPoint.y - rect.top) / zoom,
});

export const getScrollDeltaForLogicalPoint = (
  rect: ViewportRectOrigin,
  clientPoint: ViewportPoint,
  logicalPoint: ViewportPoint,
  zoom: number,
): ViewportPoint => ({
  x: rect.left + logicalPoint.x * zoom - clientPoint.x,
  y: rect.top + logicalPoint.y * zoom - clientPoint.y,
});
