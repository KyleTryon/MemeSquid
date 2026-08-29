export interface TextElement {
  id: string;
  type: 'text';
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  fontFamily: string;
  fontWeight: 'normal' | 'bold';
  allCaps: boolean;
  align: string;
  width?: number;
  rotation?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  zIndex?: number;
}

export type CanvasFill = { type: 'transparent' } | { type: 'solid'; color: string };

export interface CanvasState {
  width: number;
  height: number;
  fill: CanvasFill;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BaseImageElement {
  id: string;
  image: HTMLImageElement | HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
  crop: CropRect;
  scaleX?: number;
  scaleY?: number;
  bgRemoved?: boolean;
  originalSrc?: string;
}

export interface ImageElement extends BaseImageElement {
  type: 'image';
  rotation?: number;
  zIndex?: number;
}

export interface LineElement {
  id: string;
  type: 'line';
  points: number[];
  color: string;
  strokeWidth: number;
}
