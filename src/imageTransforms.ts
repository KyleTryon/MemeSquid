import type { ImageElement } from './types';

export type TransformAxis = 'x' | 'y';

export interface TransformBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

const MINIMUM_IMAGE_SIZE = 5;
const MINIMUM_SCALE = 0.0001;

const nonZeroScale = (scale: number | undefined): number => {
  if (scale === undefined) return 1;
  return Math.abs(scale) < MINIMUM_SCALE ? 1 : scale;
};

export const constrainImageTransform = (
  previousBox: TransformBox,
  nextBox: TransformBox,
): TransformBox => {
  if (
    Math.abs(nextBox.width) < MINIMUM_IMAGE_SIZE ||
    Math.abs(nextBox.height) < MINIMUM_IMAGE_SIZE
  ) {
    return previousBox;
  }

  return nextBox;
};

export const getCenteredImageFlip = (
  image: ImageElement,
  axis: TransformAxis,
): Pick<ImageElement, 'x' | 'y'> & Required<Pick<ImageElement, 'scaleX' | 'scaleY'>> => {
  const scaleX = nonZeroScale(image.scaleX);
  const scaleY = nonZeroScale(image.scaleY);
  const rotationDegrees = image.rotation ?? 0;
  const rotation = (rotationDegrees * Math.PI) / 180;
  const localDeltaX = axis === 'x' ? image.width * scaleX : 0;
  const localDeltaY = axis === 'y' ? image.height * scaleY : 0;

  return {
    x: image.x + localDeltaX * Math.cos(rotation) - localDeltaY * Math.sin(rotation),
    y: image.y + localDeltaX * Math.sin(rotation) + localDeltaY * Math.cos(rotation),
    scaleX: axis === 'x' ? -scaleX : scaleX,
    scaleY: axis === 'y' ? -scaleY : scaleY,
  };
};
