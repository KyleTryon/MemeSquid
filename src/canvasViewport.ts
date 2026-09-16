import type { CropRect } from './types';

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

// All measurements are displayed pixels, independent of canvas zoom.
export const getImageActionsPosition = (
  image: CropRect,
  toolbar: Pick<CropRect, 'width' | 'height'>,
  viewport: Pick<CropRect, 'width' | 'height'>,
): ViewportPoint => {
  const padding = 8;
  const gap = 12;
  const below = image.y + image.height + gap;
  const above = image.y - toolbar.height - gap;
  const preferredY = below + toolbar.height <= viewport.height - padding ? below : above;

  return {
    x: Math.max(
      padding,
      Math.min(
        image.x + (image.width - toolbar.width) / 2,
        viewport.width - toolbar.width - padding,
      ),
    ),
    y: Math.max(padding, Math.min(preferredY, viewport.height - toolbar.height - padding)),
  };
};
