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
}

export interface ImageElement {
  id: string;
  type: 'image';
  image: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LineElement {
  id: string;
  type: 'line';
  points: number[];
  color: string;
  strokeWidth: number;
}
