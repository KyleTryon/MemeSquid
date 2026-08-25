import type { CropRect, ImageElement } from './types';

export interface Size {
  width: number;
  height: number;
}

const DEFAULT_MINIMUM_CROP_SIZE = 1;

export const getImageSourceSize = (image: ImageElement['image']): Size =>
  image instanceof HTMLImageElement
    ? { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }
    : { width: image.width, height: image.height };

export const getFullCrop = (size: Size): CropRect => ({
  x: 0,
  y: 0,
  width: size.width,
  height: size.height,
});

export const clampCropRect = (
  crop: CropRect,
  bounds: Size,
  minimumSize: number = DEFAULT_MINIMUM_CROP_SIZE,
): CropRect => {
  const safeMinimumWidth = Math.min(Math.max(1, minimumSize), bounds.width);
  const safeMinimumHeight = Math.min(Math.max(1, minimumSize), bounds.height);
  const left = Math.min(crop.x, crop.x + crop.width);
  const top = Math.min(crop.y, crop.y + crop.height);
  const requestedWidth = Math.abs(crop.width);
  const requestedHeight = Math.abs(crop.height);
  const x = Math.min(Math.max(0, left), Math.max(0, bounds.width - safeMinimumWidth));
  const y = Math.min(Math.max(0, top), Math.max(0, bounds.height - safeMinimumHeight));

  return {
    x,
    y,
    width: Math.min(Math.max(safeMinimumWidth, requestedWidth), bounds.width - x),
    height: Math.min(Math.max(safeMinimumHeight, requestedHeight), bounds.height - y),
  };
};

export const applyImageCrop = (image: ImageElement, requestedCrop: CropRect): ImageElement => {
  const crop = clampCropRect(requestedCrop, getImageSourceSize(image.image));
  const currentCrop = image.crop;
  const pixelsToLocalX = image.width / currentCrop.width;
  const pixelsToLocalY = image.height / currentCrop.height;
  const localDeltaX = (crop.x - currentCrop.x) * pixelsToLocalX;
  const localDeltaY = (crop.y - currentCrop.y) * pixelsToLocalY;
  const rotation = ((image.rotation ?? 0) * Math.PI) / 180;
  const scaledDeltaX = localDeltaX * (image.scaleX ?? 1);
  const scaledDeltaY = localDeltaY * (image.scaleY ?? 1);

  return {
    ...image,
    x: image.x + scaledDeltaX * Math.cos(rotation) - scaledDeltaY * Math.sin(rotation),
    y: image.y + scaledDeltaX * Math.sin(rotation) + scaledDeltaY * Math.cos(rotation),
    width: crop.width * pixelsToLocalX,
    height: crop.height * pixelsToLocalY,
    crop,
  };
};

export const roundCropRect = (crop: CropRect): CropRect => ({
  x: Math.round(crop.x),
  y: Math.round(crop.y),
  width: Math.round(crop.width),
  height: Math.round(crop.height),
});

export const areCropRectsEqual = (first: CropRect, second: CropRect): boolean =>
  first.x === second.x &&
  first.y === second.y &&
  first.width === second.width &&
  first.height === second.height;
