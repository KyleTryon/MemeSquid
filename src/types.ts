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
  fontWeight: string;
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

export interface ImageElement {
  id: string;
  type: 'image';
  image: HTMLImageElement | HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayImageElement {
  id: string;
  type: 'overlayImage';
  image: HTMLImageElement | HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  zIndex?: number;
}

export interface LineElement {
  id: string;
  type: 'line';
  points: number[];
  color: string;
  strokeWidth: number;
}
