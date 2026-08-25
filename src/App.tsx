import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Text,
  Transformer,
  Line as KonvaLine,
  Rect,
} from 'react-konva';
import { Html } from 'react-konva-utils';
import Konva from 'konva';
import {
  Upload,
  Link as LinkIcon,
  Type,
  Download,
  Trash2,
  ClipboardPaste,
  Settings2,
  AlignLeft,
  Palette,
  Box,
  ChevronDown,
  Undo2,
  Redo2,
  PenTool,
  MousePointer2,
  HelpCircle,
  X,
  Copy,
  Image as ImageIcon,
  ImagePlus,
  Wand2,
  Loader2,
  ShieldCheck,
  Globe2,
  FlipHorizontal2,
  FlipVertical2,
  RotateCcw,
  Plus,
  LayoutPanelTop,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Smartphone,
  Share2,
  SquarePlus,
  Crop as CropIcon,
  Images as TemplateLibraryIcon,
} from 'lucide-react';
import {
  type TextElement,
  type ImageElement,
  type LineElement,
  type CanvasState,
  type CanvasFill,
  type CropRect,
} from './types';
import { constrainImageTransform, getCenteredImageFlip } from './imageTransforms';
import type { TransformAxis } from './imageTransforms';
import {
  applyImageCrop,
  areCropRectsEqual,
  clampCropRect,
  getFullCrop,
  getImageSourceSize,
  roundCropRect,
} from './cropGeometry';
import {
  clampZoom,
  getLogicalPointAtClientPosition,
  getPinchZoom,
  getPointCenter,
  getPointDistance,
  getScrollDeltaForLogicalPoint,
  type ViewportPoint,
} from './canvasViewport';
import { patchItemById, removeItemById, updateItemById } from './collectionUtils';
import type { ItemPatch } from './collectionUtils';
import { useAxisLockedDrag, useSelectedTransformer } from './konvaInteractions';
import { Canvg } from 'canvg';
import { usePwaInstall } from './usePwaInstall';
import { ColorPicker } from './ColorPicker';
import type { CatalogTemplate } from './templateCatalog/catalog';
import { useDialogFocus } from './useDialogFocus';

const TemplateLibraryDialog = React.lazy(() => import('./TemplateLibraryDialog'));

const round2 = (num: number) => Math.round(num * 100) / 100;

const getFlippedImage = (image: ImageElement, axis: TransformAxis): ImageElement => {
  const transform = getCenteredImageFlip(image, axis);
  return {
    ...image,
    ...transform,
    x: round2(transform.x),
    y: round2(transform.y),
    scaleX: round2(transform.scaleX),
    scaleY: round2(transform.scaleY),
  };
};

const toKonvaElementData = <T extends object>(element: T): Omit<T, 'zIndex' | '_itemType'> => {
  const data = { ...element };
  Reflect.deleteProperty(data, 'zIndex');
  Reflect.deleteProperty(data, '_itemType');
  return data;
};

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(',');
const isSupportedImageMimeType = (mimeType: string) =>
  IMAGE_MIME_TYPES.some((validType) => validType === mimeType);
const TRANSFORMER_ANCHOR_SIZE = window.matchMedia('(pointer: coarse)').matches ? 22 : 10;

const ALIGNMENT_OPTIONS = [
  { value: 'tl', label: 'Top left' },
  { value: 'tc', label: 'Top center' },
  { value: 'tr', label: 'Top right' },
  { value: 'ml', label: 'Middle left' },
  { value: 'mc', label: 'Center' },
  { value: 'mr', label: 'Middle right' },
  { value: 'bl', label: 'Bottom left' },
  { value: 'bc', label: 'Bottom center' },
  { value: 'br', label: 'Bottom right' },
] as const;

type AlignmentPosition = (typeof ALIGNMENT_OPTIONS)[number]['value'];
type EditorTool = 'select' | 'draw';
type CanvasSide = 'top' | 'right' | 'bottom' | 'left';
type CanvasAnchor = AlignmentPosition;
type ExpansionMode = 'blank' | 'text' | 'image';
type CanvasPointerEvent = Konva.KonvaEventObject<MouseEvent | TouchEvent>;

const getCanvasPointerPosition = (event: CanvasPointerEvent) =>
  event.target.getStage()?.getPointerPosition() ?? null;

interface EditorSnapshot {
  canvas: CanvasState | null;
  texts: TextElement[];
  lines: LineElement[];
  images: ImageElement[];
}

const areEditorSnapshotsEqual = (first: EditorSnapshot, second: EditorSnapshot): boolean => {
  const textsEqual = JSON.stringify(first.texts) === JSON.stringify(second.texts);
  const canvasEqual = JSON.stringify(first.canvas) === JSON.stringify(second.canvas);
  const linesEqual = JSON.stringify(first.lines) === JSON.stringify(second.lines);
  const imagesEqual =
    JSON.stringify(first.images.map((image) => ({ ...image, image: null }))) ===
    JSON.stringify(second.images.map((image) => ({ ...image, image: null })));

  return textsEqual && canvasEqual && linesEqual && imagesEqual;
};

interface ExpansionDraft {
  side: CanvasSide;
  mode: ExpansionMode;
  size: number;
  fill: CanvasFill;
}

interface CanvasPinchGesture {
  focalPoint: ViewportPoint;
  initialDistance: number;
  initialZoom: number;
}

type CropSession =
  { kind: 'image'; targetId: string; draft: CropRect } | { kind: 'canvas'; draft: CropRect };

interface ImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ImageLoadMode = 'start-project' | 'add-layer';

type ImageGeometry = Pick<ImageElement, 'x' | 'y' | 'width' | 'height'>;
type ImageNodeData = Pick<
  ImageElement,
  'id' | 'image' | 'x' | 'y' | 'width' | 'height' | 'scaleX' | 'scaleY' | 'rotation'
>;

const getImageNodeData = (image: ImageElement): ImageNodeData => ({
  id: image.id,
  image: image.image,
  x: image.x,
  y: image.y,
  width: image.width,
  height: image.height,
  scaleX: image.scaleX,
  scaleY: image.scaleY,
  rotation: image.rotation,
});

const createImageElement = (
  image: ImageElement['image'],
  geometry: ImageGeometry,
): ImageElement => ({
  id: `image-${crypto.randomUUID()}`,
  type: 'image',
  image,
  ...geometry,
  crop: getFullCrop(getImageSourceSize(image)),
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  zIndex: Date.now(),
});

const CANVAS_ID = 'canvas';
const MIN_CANVAS_SIZE = 64;
const MAX_CANVAS_SIZE = 8192;
const MIN_CANVAS_ZOOM = 0.05;
const MAX_CANVAS_ZOOM = 4;
const ZOOM_LEVELS = [0.05, 0.1, 0.125, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

const getTouchPoint = (touch: Touch): ViewportPoint => ({
  x: touch.clientX,
  y: touch.clientY,
});

const createTextElement = (
  text: string,
  x: number,
  y: number,
  width?: number,
  fontSize: number = 40,
  style?: Partial<
    Pick<
      TextElement,
      | 'fill'
      | 'stroke'
      | 'strokeWidth'
      | 'fontFamily'
      | 'fontWeight'
      | 'align'
      | 'shadowColor'
      | 'shadowBlur'
      | 'shadowOffsetX'
      | 'shadowOffsetY'
      | 'shadowOpacity'
    >
  >,
): TextElement => ({
  id: `text-${crypto.randomUUID()}`,
  type: 'text',
  text,
  x,
  y,
  width,
  fontSize,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  fontFamily: 'Impact, sans-serif',
  fontWeight: 'bold',
  align: 'center',
  rotation: 0,
  shadowColor: '#000000',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowOpacity: 1,
  zIndex: Date.now(),
  ...style,
});

const getTextStyle = (
  text: TextElement,
): Pick<
  TextElement,
  | 'fill'
  | 'stroke'
  | 'strokeWidth'
  | 'fontFamily'
  | 'fontWeight'
  | 'align'
  | 'shadowColor'
  | 'shadowBlur'
  | 'shadowOffsetX'
  | 'shadowOffsetY'
  | 'shadowOpacity'
> => ({
  fill: text.fill,
  stroke: text.stroke,
  strokeWidth: text.strokeWidth,
  fontFamily: text.fontFamily,
  fontWeight: text.fontWeight,
  align: text.align,
  shadowColor: text.shadowColor,
  shadowBlur: text.shadowBlur,
  shadowOffsetX: text.shadowOffsetX,
  shadowOffsetY: text.shadowOffsetY,
  shadowOpacity: text.shadowOpacity,
});

type BackgroundRemovalState =
  | { status: 'idle' }
  | { status: 'warning'; targetId: string }
  | { status: 'downloading'; targetId: string; progress: number }
  | { status: 'processing'; targetId: string };

interface PendingBackgroundRemoval {
  id: string;
  imageUrl: string;
  originalUrl: string;
}

type BackgroundRemovalWorkerResponse =
  | { type: 'PROGRESS'; data: { status: string; loaded: number; total: number } }
  | { type: 'INIT_DONE' }
  | {
      type: 'RESULT';
      data: {
        id: string;
        maskData: Uint8Array | Float32Array;
        width: number;
        height: number;
        channels: number;
      };
    }
  | { type: 'ERROR'; data: string };

interface EditorThemeColors {
  accent: string;
  canvasDim: string;
  onAccent: string;
}

let cachedEditorThemeColors: EditorThemeColors | null = null;

const getEditorThemeColors = (): EditorThemeColors => {
  if (cachedEditorThemeColors) return cachedEditorThemeColors;

  const styles = getComputedStyle(document.documentElement);
  const readToken = (token: '--color-accent-hover' | '--color-canvas-dim' | '--color-on-accent') =>
    styles.getPropertyValue(token).trim();

  cachedEditorThemeColors = {
    accent: readToken('--color-accent-hover'),
    canvasDim: readToken('--color-canvas-dim'),
    onAccent: readToken('--color-on-accent'),
  };
  return cachedEditorThemeColors;
};

const SquidMark = ({ className = '' }: { className?: string }) => (
  <svg
    aria-hidden="true"
    className={className}
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M11 25.5C11 15.3 16.5 8 24 8s13 7.3 13 17.5V29H11v-3.5Z" fill="currentColor" />
    <path
      d="M15 27v4.5c0 3.6-2 5.5-5 5.5M21 27v7c0 3-1.5 5-4 6M27 27v7c0 3 1.5 5 4 6M33 27v4.5c0 3.6 2 5.5 5 5.5"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <circle cx="19" cy="21" r="2.25" fill="var(--color-background)" />
    <circle cx="29" cy="21" r="2.25" fill="var(--color-background)" />
    <path
      d="M20 25.5c1.2 1 2.5 1.5 4 1.5s2.8-.5 4-1.5"
      stroke="var(--color-background)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="34.5" cy="13.5" r="3.5" fill="var(--color-brand-detail)" />
  </svg>
);

const CanvasAlignmentControl = ({
  onAlign,
}: {
  onAlign: (position: AlignmentPosition) => void;
}) => (
  <div
    className="grid grid-cols-3 gap-2 w-fit mx-auto mt-3"
    role="group"
    aria-label="Align to canvas"
  >
    {ALIGNMENT_OPTIONS.map(({ value, label }) => (
      <button
        key={value}
        type="button"
        onClick={() => onAlign(value)}
        className="flex h-11 w-11 md:h-8 md:w-8 items-center justify-center rounded-xl border border-border bg-canvas/50 text-content-subtle hover:border-accent hover:bg-accent/10 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-colors"
        aria-label={label}
        title={label}
      >
        <span className="h-2 w-2 rounded-full bg-current" />
      </button>
    ))}
  </div>
);

const App = () => {
  const [canvas, setCanvas] = useState<CanvasState | null>(null);
  const [images, setImages] = useState<ImageElement[]>([]);
  const [texts, setTexts] = useState<TextElement[]>([]);
  const [lines, setLines] = useState<LineElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasResizeAnchor, setCanvasResizeAnchor] = useState<CanvasAnchor>('tl');
  const [expansionDraft, setExpansionDraft] = useState<ExpansionDraft | null>(null);
  const [cropSession, setCropSession] = useState<CropSession | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [isFitZoom, setIsFitZoom] = useState(true);
  const [isZoomHudVisible, setIsZoomHudVisible] = useState(false);

  const [tool, setTool] = useState<EditorTool>('select');
  const [drawColor, setDrawColor] = useState('#ff0000');
  const [drawWidth, setDrawWidth] = useState(5);
  const isDrawing = useRef(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isTemplateLibraryOpen, setIsTemplateLibraryOpen] = useState(false);
  const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(null);
  const [isMobilePropsOpen, setIsMobilePropsOpen] = useState(false);
  const [isMobileAddOpen, setIsMobileAddOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const { canInstall, dismissInstallHelp, install, installMode, isAppleMobile, isInstallHelpOpen } =
    usePwaInstall();
  const addImageInputRef = useRef<HTMLInputElement | null>(null);
  const canvasAreaRef = useRef<HTMLElement | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const exportMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const expansionSideRef = useRef<CanvasSide | null>(null);
  const pendingImagePlacementRef = useRef<ImagePlacement | null>(null);
  const brushCursorRef = useRef<HTMLDivElement | null>(null);
  const activeDrawLineIdRef = useRef<string | null>(null);
  const canvasPinchGestureRef = useRef<CanvasPinchGesture | null>(null);
  const suppressSingleTouchRef = useRef(false);
  const gestureFrameRef = useRef<number | null>(null);
  const zoomHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeAbout = useCallback(() => setIsAboutOpen(false), []);
  const closeMobileAdd = useCallback(() => setIsMobileAddOpen(false), []);
  const closeMobileProps = useCallback(() => setIsMobilePropsOpen(false), []);
  const closeTemplateLibrary = useCallback(() => {
    if (!loadingTemplateId) setIsTemplateLibraryOpen(false);
  }, [loadingTemplateId]);
  const cancelExpansion = useCallback(() => {
    const side = expansionSideRef.current;
    setExpansionDraft(null);
    window.requestAnimationFrame(() => {
      if (side) document.querySelector<HTMLElement>(`[data-canvas-edge="${side}"]`)?.focus();
    });
  }, []);
  const aboutDialogRef = useDialogFocus(isAboutOpen, closeAbout);
  const installHelpDialogRef = useDialogFocus(isInstallHelpOpen, dismissInstallHelp);
  const mobileAddDialogRef = useDialogFocus(isMobileAddOpen, closeMobileAdd);
  const mobilePropsDialogRef = useDialogFocus<HTMLElement>(isMobilePropsOpen, closeMobileProps);

  const showZoomHud = useCallback(() => {
    if (zoomHudTimerRef.current) clearTimeout(zoomHudTimerRef.current);
    setIsZoomHudVisible(true);
    zoomHudTimerRef.current = setTimeout(() => {
      setIsZoomHudVisible(false);
      zoomHudTimerRef.current = null;
    }, 700);
  }, []);

  useEffect(() => {
    const previousHitOnDragEnabled = Konva.hitOnDragEnabled;
    Konva.hitOnDragEnabled = true;
    return () => {
      Konva.hitOnDragEnabled = previousHitOnDragEnabled;
    };
  }, []);

  useEffect(() => {
    if (!isExportMenuOpen) return;

    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsExportMenuOpen(false);
        exportMenuButtonRef.current?.focus();
        return;
      }

      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const activeElement = document.activeElement;
      if (
        activeElement !== exportMenuButtonRef.current &&
        !(activeElement instanceof Node && exportMenuRef.current?.contains(activeElement))
      )
        return;
      const menuItems = Array.from(
        exportMenuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
      );
      if (menuItems.length === 0) return;

      const activeIndex = menuItems.findIndex((item) => item === document.activeElement);
      let nextIndex = 0;
      if (event.key === 'End') nextIndex = menuItems.length - 1;
      else if (event.key === 'ArrowUp')
        nextIndex = activeIndex <= 0 ? menuItems.length - 1 : activeIndex - 1;
      else if (event.key === 'ArrowDown')
        nextIndex = activeIndex >= menuItems.length - 1 ? 0 : activeIndex + 1;

      event.preventDefault();
      menuItems[nextIndex].focus();
    };

    document.addEventListener('keydown', handleMenuKeyDown);
    return () => document.removeEventListener('keydown', handleMenuKeyDown);
  }, [isExportMenuOpen]);

  // --- Background Removal State ---
  const [bgRemovalState, setBgRemovalState] = useState<BackgroundRemovalState>({ status: 'idle' });
  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef(false);
  const pendingBgRemovalRef = useRef<PendingBackgroundRemoval | null>(null);

  // --- History State ---
  const [past, setPast] = useState<EditorSnapshot[]>([]);
  const [future, setFuture] = useState<EditorSnapshot[]>([]);
  const [hasPendingHistoryChange, setHasPendingHistoryChange] = useState(false);
  const isHistoryAction = useRef(false);
  const lastSaved = useRef<EditorSnapshot>({ canvas, texts, lines, images });

  const stageRef = useRef<Konva.Stage | null>(null);

  // --- Image Handling Logic ---

  const handleImageLoad = useCallback(
    async (
      src: string,
      isSvg: boolean,
      mode: ImageLoadMode,
      placement: ImagePlacement | null = null,
    ) => {
      let finalImage: HTMLImageElement | HTMLCanvasElement;
      let imgWidth: number;
      let imgHeight: number;

      if (isSvg) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('The browser could not create an image canvas.');
        const v = await Canvg.from(ctx, src);
        await v.render();
        imgWidth = canvas.width || 300;
        imgHeight = canvas.height || 300;
        finalImage = canvas;
      } else {
        const img = new window.Image();
        img.crossOrigin = 'Anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('The selected image could not be loaded.'));
          img.src = src;
        });
        imgWidth = img.width;
        imgHeight = img.height;
        finalImage = img;
      }

      if (mode === 'start-project' || !canvas) {
        const newImage = createImageElement(finalImage, {
          x: 0,
          y: 0,
          width: imgWidth,
          height: imgHeight,
        });
        const nextCanvas: CanvasState = {
          width: imgWidth,
          height: imgHeight,
          fill: { type: 'transparent' },
        };
        const nextSnapshot: EditorSnapshot = {
          canvas: nextCanvas,
          images: [newImage],
          lines: [],
          texts: [],
        };
        isHistoryAction.current = true;
        lastSaved.current = nextSnapshot;
        setPast([]);
        setFuture([]);
        setHasPendingHistoryChange(false);
        setCanvas(nextCanvas);
        setImages(nextSnapshot.images);
        setTexts([]);
        setLines([]);
        setCropSession(null);
        setExpansionDraft(null);
        setCanvasResizeAnchor('tl');
        setCanvasZoom(1);
        setIsFitZoom(true);
        setIsMobilePropsOpen(false);
        pendingBgRemovalRef.current = null;
        setBgRemovalState({ status: 'idle' });
        setSelectedId(newImage.id);
      } else {
        const target = placement ?? {
          x: 0,
          y: 0,
          width: canvas.width,
          height: canvas.height,
        };
        const ratio = placement
          ? Math.min(target.width / imgWidth, target.height / imgHeight)
          : Math.min(
              1,
              300 / imgWidth,
              (canvas.width * 0.5) / imgWidth,
              (canvas.height * 0.5) / imgHeight,
            );
        const width = imgWidth * ratio;
        const height = imgHeight * ratio;
        const newImage = createImageElement(finalImage, {
          x: target.x + (target.width - width) / 2,
          y: target.y + (target.height - height) / 2,
          width,
          height,
        });
        setImages((previous) => [...previous, newImage]);
        setSelectedId(newImage.id);
      }

      setTool('select');
    },
    [canvas],
  );

  const loadImageFile = useCallback(
    (file: File) => {
      const placement = pendingImagePlacementRef.current;
      pendingImagePlacementRef.current = null;
      if (!isSupportedImageMimeType(file.type)) return;

      const isSvg = file.type === 'image/svg+xml';
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result;
        if (typeof result === 'string') {
          const mode: ImageLoadMode = canvas ? 'add-layer' : 'start-project';
          void handleImageLoad(result, isSvg, mode, placement).catch((error: Error) => {
            console.error('Failed to load image', error);
            setAnnouncement('The selected image could not be loaded.');
          });
        }
      };

      if (isSvg) {
        reader.readAsText(file);
      } else {
        reader.readAsDataURL(file);
      }
    },
    [canvas, handleImageLoad],
  );

  const startWithTemplate = useCallback(
    async (template: CatalogTemplate) => {
      if (
        canvas &&
        !window.confirm(
          `Start a new meme with “${template.title}”? Your current canvas will be replaced.`,
        )
      ) {
        return;
      }

      setLoadingTemplateId(template.id);
      try {
        await handleImageLoad(template.sourceUrl, false, 'start-project');
        setIsTemplateLibraryOpen(false);
        setAnnouncement(`Started a new meme with ${template.title}.`);
      } catch (error) {
        console.error('Failed to load template', error);
        setAnnouncement(`${template.title} could not be loaded.`);
      } finally {
        setLoadingTemplateId(null);
      }
    },
    [canvas, handleImageLoad],
  );

  const createBlankCanvas = useCallback(() => {
    if (
      canvas &&
      !window.confirm('Start a new blank meme? Your current canvas will be replaced.')
    ) {
      return;
    }

    const nextCanvas: CanvasState = {
      width: 1080,
      height: 1080,
      fill: { type: 'solid', color: '#ffffff' },
    };
    const nextSnapshot: EditorSnapshot = {
      canvas: nextCanvas,
      images: [],
      lines: [],
      texts: [],
    };
    isHistoryAction.current = true;
    lastSaved.current = nextSnapshot;
    setPast([]);
    setFuture([]);
    setHasPendingHistoryChange(false);
    setCanvas(nextCanvas);
    setImages([]);
    setTexts([]);
    setLines([]);
    setSelectedId(CANVAS_ID);
    setTool('select');
    setCropSession(null);
    setExpansionDraft(null);
    setCanvasResizeAnchor('tl');
    setCanvasZoom(1);
    setIsFitZoom(true);
    setIsMobilePropsOpen(false);
    setIsMobileAddOpen(false);
    pendingBgRemovalRef.current = null;
    setBgRemovalState({ status: 'idle' });
  }, [canvas]);

  const onFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) loadImageFile(file);
      e.target.value = '';
    },
    [loadImageFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) loadImageFile(file);
    },
    [loadImageFile],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (isTemplateLibraryOpen) return;
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (isSupportedImageMimeType(items[i].type)) {
            const blob = items[i].getAsFile();
            if (blob) loadImageFile(blob);
          }
        }
      }
    },
    [isTemplateLibraryOpen, loadImageFile],
  );

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  useEffect(() => {
    const input = addImageInputRef.current;
    if (!input) return;

    const clearPendingImagePlacement = () => {
      pendingImagePlacementRef.current = null;
    };
    input.addEventListener('cancel', clearPendingImagePlacement);
    return () => input.removeEventListener('cancel', clearPendingImagePlacement);
  }, []);

  useEffect(() => {
    const canvasArea = canvasAreaRef.current;
    if (!canvasArea || !canvas) return;

    const updateFitZoom = () => {
      const horizontalPadding = window.innerWidth < 768 ? 88 : 96;
      const verticalPadding = window.innerWidth < 768 ? 40 : 96;
      const availableWidth = Math.max(canvasArea.clientWidth - horizontalPadding, MIN_CANVAS_SIZE);
      const availableHeight = Math.max(canvasArea.clientHeight - verticalPadding, MIN_CANVAS_SIZE);
      const nextFitZoom = Math.min(
        1,
        availableWidth / canvas.width,
        availableHeight / canvas.height,
      );
      setFitZoom(nextFitZoom);
      if (isFitZoom) {
        setCanvasZoom(nextFitZoom);
        canvasArea.scrollTo({ left: 0, top: 0 });
      }
    };

    updateFitZoom();
    const observer = new ResizeObserver(updateFitZoom);
    observer.observe(canvasArea);
    return () => observer.disconnect();
  }, [canvas, isFitZoom]);

  const setManualCanvasZoomAtClientPoint = useCallback(
    (requestedZoom: number, clientPoint: ViewportPoint) => {
      if (!canvas) return;

      const zoom = clampZoom(requestedZoom, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM);
      const canvasArea = canvasAreaRef.current;
      const canvasViewport = canvasViewportRef.current;
      const logicalPoint = canvasViewport
        ? getLogicalPointAtClientPosition(
            canvasViewport.getBoundingClientRect(),
            clientPoint,
            canvasZoom,
          )
        : { x: canvas.width / 2, y: canvas.height / 2 };

      setIsFitZoom(false);
      setCanvasZoom(zoom);
      showZoomHud();

      if (gestureFrameRef.current !== null) {
        window.cancelAnimationFrame(gestureFrameRef.current);
      }
      gestureFrameRef.current = window.requestAnimationFrame(() => {
        gestureFrameRef.current = null;
        if (!canvasArea || !canvasViewport) return;
        if (zoom <= fitZoom) {
          canvasArea.scrollTo({ left: 0, top: 0 });
          return;
        }

        const delta = getScrollDeltaForLogicalPoint(
          canvasViewport.getBoundingClientRect(),
          clientPoint,
          logicalPoint,
          zoom,
        );
        canvasArea.scrollBy({ left: delta.x, top: delta.y });
      });
    },
    [canvas, canvasZoom, fitZoom, showZoomHud],
  );

  const setManualCanvasZoom = useCallback(
    (requestedZoom: number) => {
      const canvasArea = canvasAreaRef.current;
      if (!canvasArea) return;

      const rect = canvasArea.getBoundingClientRect();
      setManualCanvasZoomAtClientPoint(requestedZoom, {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    },
    [setManualCanvasZoomAtClientPoint],
  );

  const zoomCanvasIn = useCallback(() => {
    const nextZoom = ZOOM_LEVELS.find((level) => level > canvasZoom + 0.001) ?? MAX_CANVAS_ZOOM;
    setManualCanvasZoom(nextZoom);
  }, [canvasZoom, setManualCanvasZoom]);

  const zoomCanvasOut = useCallback(() => {
    const nextZoom =
      [...ZOOM_LEVELS].reverse().find((level) => level < canvasZoom - 0.001) ?? MIN_CANVAS_ZOOM;
    setManualCanvasZoom(nextZoom);
  }, [canvasZoom, setManualCanvasZoom]);

  const fitCanvasToViewport = useCallback(() => {
    setIsFitZoom(true);
    setCanvasZoom(fitZoom);
    canvasAreaRef.current?.scrollTo({ left: 0, top: 0 });
    showZoomHud();
  }, [fitZoom, showZoomHud]);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      workerReadyRef.current = false;
      pendingBgRemovalRef.current = null;
      if (gestureFrameRef.current !== null) {
        window.cancelAnimationFrame(gestureFrameRef.current);
      }
      if (zoomHudTimerRef.current) clearTimeout(zoomHudTimerRef.current);
    },
    [],
  );

  // --- Background Removal Logic ---
  const applyMask = useCallback(
    async (
      originalImageUrl: string,
      maskData: Uint8Array | Float32Array,
      maskWidth: number,
      maskHeight: number,
      channels: number,
    ) => {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Could not create an image canvas context.'));

          ctx.drawImage(img, 0, 0);

          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = maskWidth;
          maskCanvas.height = maskHeight;
          const maskCtx = maskCanvas.getContext('2d');
          if (!maskCtx) return reject(new Error('Could not create a mask canvas context.'));

          const maskImageData = maskCtx.createImageData(maskWidth, maskHeight);
          const isFloat = maskData instanceof Float32Array;

          for (let i = 0; i < maskWidth * maskHeight; i++) {
            let alpha = 255;
            if (channels === 1) {
              alpha = maskData[i];
            } else if (channels === 4) {
              alpha = maskData[i * 4 + 3];
            } else if (channels === 3) {
              alpha = maskData[i * 3]; // Use R channel
            }

            if (isFloat) {
              alpha = Math.round(alpha * 255);
            }

            maskImageData.data[i * 4] = 0;
            maskImageData.data[i * 4 + 1] = 0;
            maskImageData.data[i * 4 + 2] = 0;
            maskImageData.data[i * 4 + 3] = alpha;
          }
          maskCtx.putImageData(maskImageData, 0, 0);

          ctx.globalCompositeOperation = 'destination-in';
          ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);

          const finalImg = new Image();
          finalImg.onload = () => resolve(finalImg);
          finalImg.onerror = reject;
          finalImg.src = canvas.toDataURL('image/png');
        };
        img.onerror = reject;
        img.src = originalImageUrl;
      });
    },
    [],
  );

  const initWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;

    const worker = new Worker(new URL('./bgRemovalWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<BackgroundRemovalWorkerResponse>) => {
      const message = event.data;

      if (message.type === 'PROGRESS') {
        if (message.data.status === 'progress' && message.data.total > 0) {
          const progress = Math.round((message.data.loaded / message.data.total) * 100);
          setBgRemovalState((current) =>
            current.status === 'downloading' ? { ...current, progress } : current,
          );
        }
        return;
      }

      if (message.type === 'INIT_DONE') {
        workerReadyRef.current = true;
        const pending = pendingBgRemovalRef.current;
        if (!pending) {
          setBgRemovalState({ status: 'idle' });
          return;
        }

        setBgRemovalState({ status: 'processing', targetId: pending.id });
        worker.postMessage({
          type: 'REMOVE_BG',
          data: { imageUrl: pending.imageUrl, id: pending.id },
        });
        return;
      }

      if (message.type === 'RESULT') {
        const { id, maskData, width, height, channels } = message.data;
        const pending = pendingBgRemovalRef.current;
        const originalUrl = pending?.id === id ? pending.originalUrl : null;

        if (!originalUrl) {
          setBgRemovalState((current) =>
            'targetId' in current && current.targetId === id ? { status: 'idle' } : current,
          );
          return;
        }

        void applyMask(originalUrl, maskData, width, height, channels)
          .then((newImage) => {
            setImages((currentImages) =>
              patchItemById(currentImages, id, {
                image: newImage,
                bgRemoved: true,
                originalSrc: originalUrl,
              }),
            );
          })
          .catch((error) => {
            console.error('Failed to apply background mask', error);
            alert('Background removal failed while applying the generated mask.');
          })
          .finally(() => {
            if (pendingBgRemovalRef.current?.id === id) pendingBgRemovalRef.current = null;
            setBgRemovalState((current) =>
              'targetId' in current && current.targetId === id ? { status: 'idle' } : current,
            );
          });
        return;
      }

      pendingBgRemovalRef.current = null;
      setBgRemovalState({ status: 'idle' });
      console.error('Background removal worker error:', message.data);
      alert(`Background removal failed: ${message.data}`);
    };

    workerRef.current = worker;
    return worker;
  }, [applyMask]);

  const startBackgroundRemoval = useCallback(
    (targetId: string) => {
      const targetImage = images.find((image) => image.id === targetId);
      if (!targetImage || targetImage.bgRemoved) return;
      if (bgRemovalState.status === 'downloading' || bgRemovalState.status === 'processing') return;

      const originalCanvas = document.createElement('canvas');
      originalCanvas.width = targetImage.image.width;
      originalCanvas.height = targetImage.image.height;
      const originalContext = originalCanvas.getContext('2d');
      if (!originalContext) return;
      originalContext.drawImage(targetImage.image, 0, 0);
      const originalUrl = originalCanvas.toDataURL('image/png');

      const processingCanvas = document.createElement('canvas');
      processingCanvas.width = targetImage.image.width;
      processingCanvas.height = targetImage.image.height;
      const processingContext = processingCanvas.getContext('2d');
      if (!processingContext) return;
      processingContext.fillStyle = '#ffffff';
      processingContext.fillRect(0, 0, processingCanvas.width, processingCanvas.height);
      processingContext.drawImage(targetImage.image, 0, 0);

      const pending = {
        id: targetId,
        imageUrl: processingCanvas.toDataURL('image/jpeg', 0.9),
        originalUrl,
      } satisfies PendingBackgroundRemoval;
      pendingBgRemovalRef.current = pending;

      const worker = initWorker();
      if (workerReadyRef.current) {
        setBgRemovalState({ status: 'processing', targetId });
        worker.postMessage({
          type: 'REMOVE_BG',
          data: { imageUrl: pending.imageUrl, id: targetId },
        });
        return;
      }

      setBgRemovalState({ status: 'downloading', targetId, progress: 0 });
      worker.postMessage({ type: 'INIT' });
    },
    [bgRemovalState.status, images, initWorker],
  );

  const requestBackgroundRemoval = useCallback(
    (targetId: string) => {
      if (bgRemovalState.status === 'downloading' || bgRemovalState.status === 'processing') return;

      if (localStorage.getItem('bg-model-accepted')) {
        startBackgroundRemoval(targetId);
      } else {
        setBgRemovalState({ status: 'warning', targetId });
      }
    },
    [bgRemovalState.status, startBackgroundRemoval],
  );

  const acceptModelDownload = useCallback(() => {
    if (bgRemovalState.status !== 'warning') return;
    const targetId = bgRemovalState.targetId;
    localStorage.setItem('bg-model-accepted', 'true');
    startBackgroundRemoval(targetId);
  }, [bgRemovalState, startBackgroundRemoval]);

  const cancelModelDownload = useCallback(() => {
    pendingBgRemovalRef.current = null;
    setBgRemovalState({ status: 'idle' });
  }, []);
  const modelDownloadDialogRef = useDialogFocus(
    bgRemovalState.status === 'warning',
    cancelModelDownload,
  );

  // --- History Logic ---
  useEffect(() => {
    const currentSnapshot = { canvas, texts, lines, images } satisfies EditorSnapshot;

    if (isHistoryAction.current) {
      isHistoryAction.current = false;
      lastSaved.current = currentSnapshot;
      setHasPendingHistoryChange(false);
      return;
    }

    const hasChanges = !areEditorSnapshotsEqual(lastSaved.current, currentSnapshot);
    setHasPendingHistoryChange(hasChanges);
    if (!hasChanges) return;
    setFuture((current) => (current.length > 0 ? [] : current));

    const timeout = setTimeout(() => {
      if (!areEditorSnapshotsEqual(lastSaved.current, currentSnapshot)) {
        setPast((p) => [...p, lastSaved.current].slice(-50));
        lastSaved.current = currentSnapshot;
      }
      setHasPendingHistoryChange(false);
    }, 400);

    return () => clearTimeout(timeout);
  }, [canvas, texts, lines, images]);

  const undo = useCallback(() => {
    const currentSnapshot = { canvas, texts, lines, images } satisfies EditorSnapshot;
    if (!areEditorSnapshotsEqual(lastSaved.current, currentSnapshot)) {
      const previous = lastSaved.current;
      setFuture((current) => [currentSnapshot, ...current]);
      isHistoryAction.current = true;
      lastSaved.current = previous;
      setHasPendingHistoryChange(false);
      setTexts(previous.texts);
      setCanvas(previous.canvas);
      setLines(previous.lines);
      setImages(previous.images);
      return;
    }

    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1];
      const newPast = p.slice(0, -1);

      setFuture((f) => [{ canvas, texts, lines, images }, ...f]);
      isHistoryAction.current = true;
      lastSaved.current = previous;
      setHasPendingHistoryChange(false);
      setTexts(previous.texts);
      setCanvas(previous.canvas);
      setLines(previous.lines);
      setImages(previous.images);

      return newPast;
    });
  }, [canvas, texts, lines, images]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      const newFuture = f.slice(1);

      setPast((p) => [...p, { canvas, texts, lines, images }]);
      isHistoryAction.current = true;
      lastSaved.current = next;
      setHasPendingHistoryChange(false);
      setTexts(next.texts);
      setCanvas(next.canvas);
      setLines(next.lines);
      setImages(next.images);

      return newFuture;
    });
  }, [canvas, texts, lines, images]);

  const deleteElement = useCallback((id: string) => {
    setTexts((currentTexts) => removeItemById(currentTexts, id));
    setImages((currentImages) => removeItemById(currentImages, id));
    setSelectedId((currentId) => (currentId === id ? null : currentId));
    setCropSession((current) =>
      current?.kind === 'image' && current.targetId === id ? null : current,
    );

    if (pendingBgRemovalRef.current?.id === id) pendingBgRemovalRef.current = null;
    setBgRemovalState((current) =>
      'targetId' in current && current.targetId === id ? { status: 'idle' } : current,
    );
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedId) deleteElement(selectedId);
  }, [deleteElement, selectedId]);

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (cropSession) return;
      if (e.key === 'Escape' && expansionDraft) {
        e.preventDefault();
        cancelExpansion();
        return;
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        zoomCanvasIn();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        zoomCanvasOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        fitCanvasToViewport();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    undo,
    redo,
    deleteSelected,
    cropSession,
    expansionDraft,
    cancelExpansion,
    zoomCanvasIn,
    zoomCanvasOut,
    fitCanvasToViewport,
  ]);

  // --- Editor Logic ---

  const lastText = texts[texts.length - 1];

  const addText = useCallback(() => {
    const newText = createTextElement(
      'TOP TEXT',
      50,
      50,
      undefined,
      lastText?.fontSize ?? 40,
      lastText ? getTextStyle(lastText) : undefined,
    );
    setTexts((prev) => [...prev, newText]);
    setSelectedId(newText.id);
  }, [lastText]);

  const updateText = useCallback((id: string, attrs: ItemPatch<TextElement>) => {
    setTexts((currentTexts) => patchItemById(currentTexts, id, attrs));
  }, []);

  const updateImage = useCallback((id: string, attrs: ItemPatch<ImageElement>) => {
    setImages((currentImages) => patchItemById(currentImages, id, attrs));
  }, []);

  const flipImage = useCallback((id: string, axis: TransformAxis) => {
    setImages((currentImages) =>
      updateItemById(currentImages, id, (image) => getFlippedImage(image, axis)),
    );
  }, []);

  const restoreImageBackground = useCallback(
    (id: string) => {
      const targetImage = images.find((image) => image.id === id);
      if (!targetImage?.originalSrc) return;

      const restoredImage = new window.Image();
      restoredImage.onload = () => {
        updateImage(id, {
          image: restoredImage,
          bgRemoved: false,
          originalSrc: undefined,
        });
      };
      restoredImage.onerror = () => alert('The original image could not be restored.');
      restoredImage.src = targetImage.originalSrc;
    },
    [images, updateImage],
  );

  const shiftContent = useCallback((deltaX: number, deltaY: number) => {
    if (deltaX === 0 && deltaY === 0) return;

    setImages((current) =>
      current.map((image) => ({
        ...image,
        x: round2(image.x + deltaX),
        y: round2(image.y + deltaY),
      })),
    );
    setTexts((current) =>
      current.map((text) => ({
        ...text,
        x: round2(text.x + deltaX),
        y: round2(text.y + deltaY),
      })),
    );
    setLines((current) =>
      current.map((line) => ({
        ...line,
        points: line.points.map((point, index) =>
          round2(point + (index % 2 === 0 ? deltaX : deltaY)),
        ),
      })),
    );
  }, []);

  const cancelCrop = useCallback(() => {
    setCropSession(null);
    setAnnouncement('Crop canceled.');
  }, []);

  const selectCanvas = useCallback(() => {
    if (!canvas || cropSession) return;

    setTool('select');
    setSelectedId(CANVAS_ID);
    setExpansionDraft(null);
    setAnnouncement('Canvas selected.');
  }, [canvas, cropSession]);

  const beginImageCrop = useCallback(
    (id: string) => {
      const image = images.find((candidate) => candidate.id === id);
      if (!image) return;

      setTool('select');
      setSelectedId(id);
      setExpansionDraft(null);
      setIsMobilePropsOpen(false);
      setCropSession({ kind: 'image', targetId: id, draft: { ...image.crop } });
      setAnnouncement('Image crop mode. Adjust the crop frame, then apply or cancel.');
    },
    [images],
  );

  const beginCanvasCrop = useCallback(() => {
    if (!canvas) return;

    setTool('select');
    setSelectedId(CANVAS_ID);
    setExpansionDraft(null);
    setIsMobilePropsOpen(false);
    setCropSession({
      kind: 'canvas',
      draft: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    });
    setAnnouncement('Canvas crop mode. Adjust the crop frame, then apply or cancel.');
  }, [canvas]);

  const updateImageCropDraft = useCallback((crop: CropRect) => {
    setCropSession((current) =>
      current?.kind === 'image' ? { ...current, draft: crop } : current,
    );
  }, []);

  const updateCanvasCropDraft = useCallback((crop: CropRect) => {
    setCropSession((current) =>
      current?.kind === 'canvas' ? { ...current, draft: crop } : current,
    );
  }, []);

  const resetCrop = useCallback(() => {
    setCropSession((current) => {
      if (!current) return current;
      if (current.kind === 'canvas') {
        return canvas
          ? { ...current, draft: { x: 0, y: 0, width: canvas.width, height: canvas.height } }
          : null;
      }

      const image = images.find((candidate) => candidate.id === current.targetId);
      return image ? { ...current, draft: getFullCrop(getImageSourceSize(image.image)) } : null;
    });
  }, [canvas, images]);

  const checkpointEditorHistory = useCallback(() => {
    setPast((current) => [...current, { canvas, texts, lines, images }].slice(-50));
    setFuture([]);
    setHasPendingHistoryChange(false);
    isHistoryAction.current = true;
  }, [canvas, images, lines, texts]);

  const applyCrop = useCallback(() => {
    if (!cropSession) return;

    if (cropSession.kind === 'image') {
      const image = images.find((candidate) => candidate.id === cropSession.targetId);
      if (!image) {
        setCropSession(null);
        return;
      }
      const cropped = applyImageCrop(image, cropSession.draft);
      const nextImage = {
        ...cropped,
        x: round2(cropped.x),
        y: round2(cropped.y),
        width: round2(cropped.width),
        height: round2(cropped.height),
        crop: roundCropRect(cropped.crop),
      };
      if (!areCropRectsEqual(image.crop, nextImage.crop)) {
        checkpointEditorHistory();
        setImages((currentImages) =>
          updateItemById(currentImages, cropSession.targetId, () => nextImage),
        );
      }
      setCropSession(null);
      setAnnouncement(
        areCropRectsEqual(image.crop, nextImage.crop)
          ? 'Image crop unchanged.'
          : 'Image crop applied.',
      );
      return;
    }

    if (!canvas) return;
    const crop = roundCropRect(clampCropRect(cropSession.draft, canvas, MIN_CANVAS_SIZE));
    const unchanged = areCropRectsEqual(crop, {
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
    });
    if (unchanged) {
      setCropSession(null);
      setAnnouncement('Canvas crop unchanged.');
      return;
    }
    checkpointEditorHistory();
    shiftContent(-crop.x, -crop.y);
    setCanvas({ ...canvas, width: crop.width, height: crop.height });
    setCropSession(null);
    setSelectedId(CANVAS_ID);
    setAnnouncement(`Canvas cropped to ${crop.width} by ${crop.height} pixels.`);
  }, [canvas, checkpointEditorHistory, cropSession, images, shiftContent]);

  useEffect(() => {
    if (!cropSession) return;

    const handleCropKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelCrop();
      } else if (
        event.key === 'Enter' &&
        !(event.target instanceof HTMLButtonElement) &&
        !(event.target instanceof HTMLInputElement)
      ) {
        event.preventDefault();
        applyCrop();
      }
    };

    window.addEventListener('keydown', handleCropKeyDown);
    return () => window.removeEventListener('keydown', handleCropKeyDown);
  }, [applyCrop, cancelCrop, cropSession]);

  const resizeCanvasTo = useCallback(
    (requestedWidth: number, requestedHeight: number, anchor: CanvasAnchor) => {
      if (!canvas) return;

      const width = Math.min(
        MAX_CANVAS_SIZE,
        Math.max(MIN_CANVAS_SIZE, Math.round(requestedWidth)),
      );
      const height = Math.min(
        MAX_CANVAS_SIZE,
        Math.max(MIN_CANVAS_SIZE, Math.round(requestedHeight)),
      );
      const widthDelta = width - canvas.width;
      const heightDelta = height - canvas.height;
      const horizontalAnchor = anchor.at(-1);
      const verticalAnchor = anchor.at(0);
      const deltaX =
        horizontalAnchor === 'r' ? widthDelta : horizontalAnchor === 'c' ? widthDelta / 2 : 0;
      const deltaY =
        verticalAnchor === 'b' ? heightDelta : verticalAnchor === 'm' ? heightDelta / 2 : 0;

      shiftContent(deltaX, deltaY);
      setCanvas({ ...canvas, width, height });
    },
    [canvas, shiftContent],
  );

  const updateCanvasFill = useCallback((fill: CanvasFill) => {
    setCanvas((current) => (current ? { ...current, fill } : current));
  }, []);

  const openExpansion = useCallback(
    (side: CanvasSide) => {
      if (!canvas) return;
      const perpendicularSize = side === 'left' || side === 'right' ? canvas.width : canvas.height;
      const maxAddition =
        side === 'left' || side === 'right'
          ? MAX_CANVAS_SIZE - canvas.width
          : MAX_CANVAS_SIZE - canvas.height;
      if (maxAddition < 1) return;
      expansionSideRef.current = side;
      setExpansionDraft({
        side,
        mode: 'blank',
        size: Math.max(1, Math.min(maxAddition, Math.round(perpendicularSize * 0.25))),
        fill:
          canvas.fill.type === 'transparent' ? { type: 'solid', color: '#ffffff' } : canvas.fill,
      });
    },
    [canvas],
  );

  const setExpansionMode = useCallback(
    (mode: ExpansionMode) => {
      setExpansionDraft((current) => {
        if (!current || !canvas) return current;
        const perpendicularSize =
          current.side === 'left' || current.side === 'right' ? canvas.width : canvas.height;
        const maxAddition =
          current.side === 'left' || current.side === 'right'
            ? MAX_CANVAS_SIZE - canvas.width
            : MAX_CANVAS_SIZE - canvas.height;
        return {
          ...current,
          mode,
          size: mode === 'image' ? Math.min(maxAddition, perpendicularSize) : current.size,
        };
      });
    },
    [canvas],
  );

  const applyExpansion = useCallback(() => {
    if (!canvas || !expansionDraft) return;

    const { side, mode, fill } = expansionDraft;
    const maxAddition =
      side === 'left' || side === 'right'
        ? MAX_CANVAS_SIZE - canvas.width
        : MAX_CANVAS_SIZE - canvas.height;
    if (maxAddition < 1) {
      setExpansionDraft(null);
      return;
    }
    const size = Math.max(1, Math.min(maxAddition, Math.round(expansionDraft.size)));
    const shiftsLeft = side === 'left' ? size : 0;
    const shiftsDown = side === 'top' ? size : 0;
    const nextCanvas = {
      ...canvas,
      width: canvas.width + (side === 'left' || side === 'right' ? size : 0),
      height: canvas.height + (side === 'top' || side === 'bottom' ? size : 0),
      fill,
    };

    shiftContent(shiftsLeft, shiftsDown);
    setCanvas(nextCanvas);

    const placement: ImagePlacement =
      side === 'top'
        ? { x: 0, y: 0, width: canvas.width, height: size }
        : side === 'bottom'
          ? { x: 0, y: canvas.height, width: canvas.width, height: size }
          : side === 'left'
            ? { x: 0, y: 0, width: size, height: canvas.height }
            : { x: canvas.width, y: 0, width: size, height: canvas.height };

    if (mode === 'text') {
      const horizontal = side === 'top' || side === 'bottom';
      const padding = Math.min(40, size * 0.1);
      const textWidth = Math.max(40, placement.width - padding * 2);
      const fontSize = Math.max(
        18,
        Math.min(64, (horizontal ? placement.height : placement.width) * 0.28),
      );
      const text = createTextElement(
        'YOUR TEXT',
        placement.x + padding,
        placement.y + Math.max(padding, (placement.height - fontSize) / 2),
        textWidth,
        lastText?.fontSize ?? fontSize,
        lastText ? getTextStyle(lastText) : undefined,
      );
      setTexts((current) => [...current, text]);
      setSelectedId(text.id);
    } else if (mode === 'image') {
      pendingImagePlacementRef.current = placement;
      addImageInputRef.current?.click();
      setSelectedId(CANVAS_ID);
    } else {
      setSelectedId(CANVAS_ID);
    }

    setExpansionDraft(null);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('.keyboard-layer-controls [aria-pressed="true"]')
        ?.focus();
    });
  }, [canvas, expansionDraft, lastText, shiftContent]);

  const alignElementToCanvas = useCallback(
    (pos: AlignmentPosition) => {
      if (!canvas || !selectedId || selectedId === CANVAS_ID || !stageRef.current) return;
      const node = stageRef.current.findOne(`#${selectedId}`);
      if (node) {
        const isText = selectedId.startsWith('text-');
        const updates: { x?: number; y?: number; align?: string } = {};
        const padding = 20;
        const bounds = node.getClientRect({ relativeTo: stageRef.current });
        const canvasW = canvas.width;
        const canvasH = canvas.height;

        // X alignment
        if (pos.endsWith('l')) {
          updates.x = round2(node.x() + padding - bounds.x);
          if (isText) updates.align = 'left';
        } else if (pos.endsWith('c')) {
          updates.x = round2(node.x() + canvasW / 2 - (bounds.x + bounds.width / 2));
          if (isText) updates.align = 'center';
        } else if (pos.endsWith('r')) {
          updates.x = round2(node.x() + canvasW - padding - (bounds.x + bounds.width));
          if (isText) updates.align = 'right';
        }

        // Y alignment
        if (pos.startsWith('t')) {
          updates.y = round2(node.y() + padding - bounds.y);
        } else if (pos.startsWith('m')) {
          updates.y = round2(node.y() + canvasH / 2 - (bounds.y + bounds.height / 2));
        } else if (pos.startsWith('b')) {
          updates.y = round2(node.y() + canvasH - padding - (bounds.y + bounds.height));
        }

        if (isText) {
          updateText(selectedId, updates);
        } else {
          updateImage(selectedId, updates);
        }
      }
    },
    [canvas, selectedId, updateText, updateImage],
  );

  const handleRotationChange = useCallback(
    (newRotation: number) => {
      if (!stageRef.current || !selectedId) return;
      const node = stageRef.current.findOne(`#${selectedId}`);
      if (node) {
        const w = node.width();
        const h = node.height();

        const center = node.getTransform().point({ x: w / 2, y: h / 2 });

        const oldRotation = node.rotation();
        node.rotation(newRotation);

        const newCenter = node.getTransform().point({ x: w / 2, y: h / 2 });
        node.rotation(oldRotation);

        const dx = center.x - newCenter.x;
        const dy = center.y - newCenter.y;

        const updates = {
          rotation: newRotation,
          x: round2(node.x() + dx),
          y: round2(node.y() + dy),
        };

        if (selectedId.startsWith('text-')) {
          updateText(selectedId, updates);
        } else {
          updateImage(selectedId, updates);
        }
      }
    },
    [selectedId, updateText, updateImage],
  );

  const updateBrushCursor = (event: CanvasPointerEvent) => {
    const cursor = brushCursorRef.current;
    if (!cursor || !(event.evt instanceof MouseEvent)) return;

    const point = getCanvasPointerPosition(event);
    if (!point) return;

    cursor.style.opacity = '1';
    cursor.style.transform =
      `translate3d(${point.x * canvasZoom}px, ${point.y * canvasZoom}px, 0) ` +
      'translate(-50%, -50%)';
  };

  const hideBrushCursor = () => {
    if (brushCursorRef.current) brushCursorRef.current.style.opacity = '0';
  };

  const handleMouseDown = (event: CanvasPointerEvent) => {
    if (cropSession) return;
    if (tool === 'select') {
      const stage = event.target.getStage();
      const clickedOnEmpty = event.target === stage;
      const targetId = event.target.id() || null;
      const clickedOnCanvas = targetId === CANVAS_ID;
      const isSelectable = targetId?.startsWith('text-') || targetId?.startsWith('image-');
      const isTransformer = event.target.getParent()?.className === 'Transformer';

      if (clickedOnCanvas || clickedOnEmpty) {
        setSelectedId(CANVAS_ID);
        setExpansionDraft(null);
      } else if (!isSelectable && !isTransformer) {
        setSelectedId(null);
      } else if (isSelectable) {
        const id = targetId;
        if (!id) return;
        setSelectedId(id);
        setExpansionDraft(null);

        // Bring to front
        if (id.startsWith('text-')) {
          setTexts((currentTexts) => patchItemById(currentTexts, id, { zIndex: Date.now() }));
        } else if (id.startsWith('image-')) {
          setImages((currentImages) => patchItemById(currentImages, id, { zIndex: Date.now() }));
        }
      }
      return;
    }

    if (tool === 'draw') {
      isDrawing.current = true;
      const pos = getCanvasPointerPosition(event);
      if (!pos) return;
      const lineId = `line-${crypto.randomUUID()}`;
      activeDrawLineIdRef.current = lineId;
      setLines((prev) => [
        ...prev,
        {
          id: lineId,
          type: 'line',
          points: [pos.x, pos.y],
          color: drawColor,
          strokeWidth: drawWidth,
        },
      ]);
    }
  };

  const handleMouseMove = (event: CanvasPointerEvent) => {
    updateBrushCursor(event);
    if (tool !== 'draw' || !isDrawing.current) return;

    const point = getCanvasPointerPosition(event);
    if (!point) return;

    setLines((prev) => {
      const newLines = [...prev];
      const lastLine = { ...newLines[newLines.length - 1] };

      const pts = lastLine.points;
      const lastX = pts[pts.length - 2];
      const lastY = pts[pts.length - 1];

      // Smoothing: only add point if distance is greater than 5px
      const dx = point.x - lastX;
      const dy = point.y - lastY;
      if (dx * dx + dy * dy >= 25) {
        lastLine.points = lastLine.points.concat([point.x, point.y]);
        newLines.splice(newLines.length - 1, 1, lastLine);
        return newLines;
      }
      return prev;
    });
  };

  const handleMouseUp = () => {
    if (tool === 'draw' && isDrawing.current) {
      isDrawing.current = false;
      activeDrawLineIdRef.current = null;
      // Force history save immediately on mouse up for drawing
      setPast((p) => [...p, lastSaved.current].slice(-50));
      setFuture([]);
      lastSaved.current = { canvas, texts, lines, images };
      setHasPendingHistoryChange(false);
    }
  };

  const handleMouseLeave = () => {
    hideBrushCursor();
    handleMouseUp();
  };

  const cancelActiveCanvasInteraction = () => {
    const activeLineId = activeDrawLineIdRef.current;
    if (activeLineId) {
      setLines((currentLines) => removeItemById(currentLines, activeLineId));
      activeDrawLineIdRef.current = null;
    }
    isDrawing.current = false;

    stageRef.current
      ?.find((node: Konva.Node) => node.isDragging())
      .forEach((node) => node.stopDrag());
  };

  const handleCanvasTouchStart = (event: Konva.KonvaEventObject<TouchEvent>) => {
    const touches = event.evt.touches;
    if (touches.length < 2) {
      if (!suppressSingleTouchRef.current) handleMouseDown(event);
      return;
    }

    event.evt.preventDefault();
    suppressSingleTouchRef.current = true;
    cancelActiveCanvasInteraction();
    if (canvasPinchGestureRef.current) return;

    const canvasViewport = canvasViewportRef.current;
    if (!canvasViewport) return;

    const firstPoint = getTouchPoint(touches[0]);
    const secondPoint = getTouchPoint(touches[1]);
    const center = getPointCenter(firstPoint, secondPoint);
    const initialDistance = getPointDistance(firstPoint, secondPoint);
    if (initialDistance <= 0) return;

    canvasPinchGestureRef.current = {
      focalPoint: getLogicalPointAtClientPosition(
        canvasViewport.getBoundingClientRect(),
        center,
        canvasZoom,
      ),
      initialDistance,
      initialZoom: canvasZoom,
    };
    showZoomHud();
  };

  const handleCanvasTouchMove = (event: Konva.KonvaEventObject<TouchEvent>) => {
    const gesture = canvasPinchGestureRef.current;
    const touches = event.evt.touches;
    if (!gesture) {
      if (!suppressSingleTouchRef.current) handleMouseMove(event);
      return;
    }
    if (touches.length < 2) return;

    event.evt.preventDefault();
    const firstPoint = getTouchPoint(touches[0]);
    const secondPoint = getTouchPoint(touches[1]);
    const center = getPointCenter(firstPoint, secondPoint);
    const zoom = getPinchZoom(
      gesture.initialZoom,
      gesture.initialDistance,
      getPointDistance(firstPoint, secondPoint),
      MIN_CANVAS_ZOOM,
      MAX_CANVAS_ZOOM,
    );

    setIsFitZoom(false);
    setCanvasZoom(zoom);
    showZoomHud();

    if (gestureFrameRef.current !== null) {
      window.cancelAnimationFrame(gestureFrameRef.current);
    }
    gestureFrameRef.current = window.requestAnimationFrame(() => {
      gestureFrameRef.current = null;
      const canvasArea = canvasAreaRef.current;
      const canvasViewport = canvasViewportRef.current;
      if (!canvasArea || !canvasViewport) return;
      if (zoom <= fitZoom) {
        canvasArea.scrollTo({ left: 0, top: 0 });
        return;
      }

      const delta = getScrollDeltaForLogicalPoint(
        canvasViewport.getBoundingClientRect(),
        center,
        gesture.focalPoint,
        zoom,
      );
      canvasArea.scrollBy({ left: delta.x, top: delta.y });
    });
  };

  const handleCanvasTouchEnd = (event: Konva.KonvaEventObject<TouchEvent>) => {
    if (canvasPinchGestureRef.current) {
      event.evt.preventDefault();
      if (event.evt.touches.length < 2) canvasPinchGestureRef.current = null;
      if (event.evt.touches.length === 0) suppressSingleTouchRef.current = false;
      showZoomHud();
      return;
    }

    if (suppressSingleTouchRef.current) {
      if (event.evt.touches.length === 0) suppressSingleTouchRef.current = false;
      return;
    }
    handleMouseUp();
  };

  const handleCanvasDoubleTap = (event: Konva.KonvaEventObject<TouchEvent>) => {
    if (tool !== 'select' || cropSession) return;

    event.evt.preventDefault();
    if (!isFitZoom && Math.abs(canvasZoom - fitZoom) > 0.005) {
      fitCanvasToViewport();
      return;
    }

    const touch = event.evt.changedTouches[0];
    if (!touch) return;
    setManualCanvasZoomAtClientPoint(fitZoom >= 1 ? 2 : 1, getTouchPoint(touch));
  };

  const exportMeme = useCallback(
    (format: 'png' | 'jpeg' | 'webp' | 'clipboard') => {
      setSelectedId(null);
      setIsExportMenuOpen(false);
      const runExport = async () => {
        const stage = stageRef.current;
        if (stage) {
          const createExportUri = (mimeType: string) => {
            if (mimeType !== 'image/jpeg' || canvas?.fill.type !== 'transparent') {
              return stage.toDataURL({ mimeType, pixelRatio: 2 });
            }

            const renderedCanvas = stage.toCanvas({ pixelRatio: 2 });
            const flattenedCanvas = document.createElement('canvas');
            flattenedCanvas.width = renderedCanvas.width;
            flattenedCanvas.height = renderedCanvas.height;
            const context = flattenedCanvas.getContext('2d');
            if (!context) return '';
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, flattenedCanvas.width, flattenedCanvas.height);
            context.drawImage(renderedCanvas, 0, 0);
            return flattenedCanvas.toDataURL(mimeType);
          };

          if (format === 'clipboard') {
            try {
              const uri = createExportUri('image/png');
              const res = await fetch(uri);
              const blob = await res.blob();
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              setAnnouncement('Meme copied to the clipboard.');
            } catch (err) {
              console.error('Failed to copy', err);
              setAnnouncement('The meme could not be copied to the clipboard.');
            }
          } else {
            const mimeType = `image/${format}`;
            const uri = createExportUri(mimeType);
            const link = document.createElement('a');
            link.download = `memesquid-${new Date().toISOString().slice(0, 10)}.${format}`;
            link.href = uri;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setAnnouncement(`${format.toUpperCase()} download started.`);
          }
        }
      };
      setTimeout(() => {
        void runExport();
      }, 100);
    },
    [canvas],
  );

  const selectedText = texts.find((t) => t.id === selectedId);
  const selectedImage = images.find((i) => i.id === selectedId);
  const isCanvasScrollable = Boolean(canvas && canvasZoom > fitZoom + 0.001);

  const allElements = [
    ...images.map((i) => ({ ...i, _itemType: 'image' as const })),
    ...texts.map((t) => ({ ...t, _itemType: 'text' as const })),
  ].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const canvasDescription = canvas
    ? `Meme canvas, ${canvas.width} by ${canvas.height} pixels. ${images.length} ${images.length === 1 ? 'image' : 'images'}, ${texts.length} text ${texts.length === 1 ? 'element' : 'elements'}, and ${lines.length} drawn ${lines.length === 1 ? 'line' : 'lines'}.${texts.length > 0 ? ` Text content: ${texts.map((text) => text.text || 'empty text').join('; ')}.` : ''}`
    : 'No meme canvas has been created yet.';

  return (
    <div className="flex flex-col h-dvh bg-background text-content-strong font-sans selection:bg-accent selection:text-on-accent">
      <a
        href="#editor-workspace"
        className="sr-only z-[100] rounded-lg bg-accent-hover px-4 py-2 font-bold text-on-accent focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to meme editor
      </a>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {/* Header */}
      <header className="safe-header relative z-[100] flex min-h-14 items-center justify-between border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur-xl md:min-h-0 md:px-5 md:py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent">
            <SquidMark className="h-8 w-8 md:h-9 md:w-9" />
          </div>
          <div className="min-w-0">
            <h1
              className={`${canvas ? 'hidden min-[430px]:block' : 'block'} text-lg font-black leading-none tracking-[-0.045em] text-content-strong md:block md:text-xl`}
            >
              meme<span className="text-accent">squid</span>
              <span className="hidden sm:inline text-content-subtle">.com</span>
            </h1>
            <p className="hidden md:block mt-1 text-[9px] font-bold uppercase tracking-[0.24em] text-content-subtle">
              Free online meme editor
            </p>
          </div>
        </div>

        {!canvas && (
          <button
            type="button"
            onClick={() => setIsAboutOpen(true)}
            aria-label="About MemeSquid"
            className="flex h-11 w-11 items-center justify-center rounded-full text-content-muted transition-colors hover:bg-surface hover:text-content-strong md:hidden"
          >
            <HelpCircle size={21} />
          </button>
        )}

        <div className={`${canvas ? 'flex' : 'hidden md:flex'} items-center gap-1 md:gap-4`}>
          <div className="flex items-center gap-1 md:gap-2 border-r border-border pr-2 md:pr-6">
            <button
              type="button"
              onClick={undo}
              disabled={Boolean(cropSession) || (past.length === 0 && !hasPendingHistoryChange)}
              aria-label="Undo last change"
              className="flex h-11 w-11 items-center justify-center text-content-muted hover:text-content-strong disabled:opacity-30 disabled:hover:text-content-muted transition-colors rounded-xl hover:bg-surface"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={18} className="w-4 h-4 md:w-[18px] md:h-[18px]" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={Boolean(cropSession) || future.length === 0}
              aria-label="Redo last change"
              className="flex h-11 w-11 items-center justify-center text-content-muted hover:text-content-strong disabled:opacity-30 disabled:hover:text-content-muted transition-colors rounded-xl hover:bg-surface"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={18} className="w-4 h-4 md:w-[18px] md:h-[18px]" />
            </button>
          </div>
          <div className="relative z-50">
            <div className="flex items-stretch h-11">
              <button
                type="button"
                onClick={() => exportMeme('png')}
                disabled={!canvas || Boolean(cropSession)}
                aria-label="Export meme as PNG"
                className="flex min-w-11 items-center justify-center gap-1 md:gap-2 bg-accent text-on-accent font-extrabold px-3 md:px-4 rounded-l-xl hover:bg-accent-hover transition-colors text-xs md:text-sm border-r border-accent-strong h-full disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Share2 size={16} className="h-4 w-4 md:hidden" />
                <Download size={16} className="hidden h-4 w-4 md:block" />{' '}
                <span className="hidden sm:inline">Export meme</span>
              </button>
              <button
                ref={exportMenuButtonRef}
                type="button"
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setIsExportMenuOpen(true);
                    window.requestAnimationFrame(() =>
                      exportMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(),
                    );
                  }
                }}
                disabled={!canvas || Boolean(cropSession)}
                aria-label="Choose export format"
                aria-expanded={isExportMenuOpen}
                aria-controls={isExportMenuOpen ? 'export-menu' : undefined}
                className="bg-accent text-on-accent w-10 md:w-11 rounded-r-xl hover:bg-accent-hover transition-colors flex items-center justify-center h-full disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronDown size={16} className="w-4 h-4" />
              </button>
            </div>

            {isExportMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-[105]"
                  onClick={() => setIsExportMenuOpen(false)}
                  aria-hidden="true"
                />
                <div
                  ref={exportMenuRef}
                  id="export-menu"
                  role="group"
                  aria-label="Export options"
                  onBlur={(event) => {
                    if (
                      !(event.relatedTarget instanceof Node) ||
                      !event.currentTarget.contains(event.relatedTarget)
                    ) {
                      setIsExportMenuOpen(false);
                    }
                  }}
                  className="absolute right-0 top-full mt-2 w-48 bg-surface border border-border rounded-xl shadow-xl overflow-hidden z-[110] py-1"
                >
                  <button
                    type="button"
                    onClick={() => exportMeme('clipboard')}
                    className="w-full min-h-11 text-left px-4 py-3 text-sm text-content hover:bg-surface-hover hover:text-content-strong flex items-center gap-2"
                  >
                    <Copy size={14} /> Copy to Clipboard
                  </button>
                  <div role="separator" className="h-px bg-surface-hover my-1" />
                  <button
                    type="button"
                    onClick={() => exportMeme('png')}
                    className="w-full min-h-11 text-left px-4 py-3 text-sm text-content hover:bg-surface-hover hover:text-content-strong flex items-center gap-2"
                  >
                    <ImageIcon size={14} /> Download as PNG
                  </button>
                  <button
                    type="button"
                    onClick={() => exportMeme('jpeg')}
                    className="w-full min-h-11 text-left px-4 py-3 text-sm text-content hover:bg-surface-hover hover:text-content-strong flex items-center gap-2"
                  >
                    <ImageIcon size={14} /> Download as JPG
                  </button>
                  <button
                    type="button"
                    onClick={() => exportMeme('webp')}
                    className="w-full min-h-11 text-left px-4 py-3 text-sm text-content hover:bg-surface-hover hover:text-content-strong flex items-center gap-2"
                  >
                    <ImageIcon size={14} /> Download as WEBP
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex flex-col md:flex-row flex-1 overflow-hidden relative">
        {/* Toolbar */}
        <aside
          role="group"
          aria-label="Editor tools"
          className={`${canvas ? 'grid' : 'hidden'} mobile-toolbar z-20 order-2 w-full shrink-0 grid-cols-5 border-t border-border bg-background/90 backdrop-blur-xl md:order-1 md:flex md:h-auto md:w-16 md:flex-col md:items-center md:justify-start md:border-r md:border-t-0 md:bg-background/95 md:px-0 md:py-4`}
        >
          <div className="contents md:flex md:flex-col md:items-center md:gap-4">
            <button
              type="button"
              onClick={() => {
                setTool('select');
                setIsMobilePropsOpen(false);
              }}
              disabled={Boolean(cropSession)}
              aria-label="Select tool"
              aria-pressed={tool === 'select'}
              className={`mobile-tab-item order-1 md:order-1 md:flex md:h-12 md:w-12 md:items-center md:justify-center md:rounded-xl md:transition-colors ${tool === 'select' && !isMobilePropsOpen ? 'text-accent md:bg-accent md:text-on-accent' : 'text-content-muted md:bg-surface md:text-content-strong md:hover:bg-surface-hover'}`}
              title="Select Tool"
            >
              <MousePointer2 size={20} className="md:w-6 md:h-6" />
              <span className="md:hidden">Select</span>
            </button>
            <button
              type="button"
              onClick={selectCanvas}
              disabled={!canvas || Boolean(cropSession)}
              aria-label="Canvas settings"
              aria-pressed={tool === 'select' && selectedId === CANVAS_ID}
              className={`hidden h-11 w-11 items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-40 md:order-2 md:flex md:h-12 md:w-12 ${tool === 'select' && selectedId === CANVAS_ID ? 'bg-accent text-on-accent' : 'bg-surface text-content-strong hover:bg-surface-hover'}`}
              title="Canvas settings"
            >
              <LayoutPanelTop size={20} className="md:h-6 md:w-6" />
            </button>
            <button
              type="button"
              onClick={() => {
                setTool('draw');
                setIsMobilePropsOpen(true);
              }}
              disabled={Boolean(cropSession)}
              aria-label="Draw tool"
              aria-pressed={tool === 'draw'}
              className={`mobile-tab-item order-4 md:order-3 md:flex md:h-12 md:w-12 md:items-center md:justify-center md:rounded-xl md:transition-colors ${tool === 'draw' ? 'text-accent md:bg-accent md:text-on-accent' : 'text-content-muted md:bg-surface md:text-content-strong md:hover:bg-surface-hover'}`}
              title="Draw Tool"
            >
              <PenTool size={20} className="md:w-6 md:h-6" />
              <span className="md:hidden">Draw</span>
            </button>
            <div
              className="hidden md:order-4 md:my-2 md:block md:h-px md:w-8 md:bg-surface"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={() => setIsMobileAddOpen(true)}
              disabled={Boolean(cropSession)}
              aria-label="Add to meme"
              aria-expanded={isMobileAddOpen}
              className="mobile-only-tab mobile-tab-item order-2 text-content-muted md:hidden"
            >
              <Plus size={21} />
              <span>Add</span>
            </button>
            <button
              type="button"
              onClick={() => {
                addText();
                setTool('select');
                setIsMobilePropsOpen(true);
              }}
              disabled={Boolean(cropSession)}
              aria-label="Add text"
              className="mobile-tab-item order-3 text-content-muted md:order-6 md:flex md:h-12 md:w-12 md:items-center md:justify-center md:rounded-xl md:bg-surface md:text-content-strong md:transition-colors md:hover:bg-accent md:hover:text-on-accent"
              title="Add Text"
            >
              <Type size={20} className="md:w-6 md:h-6" />
              <span className="md:hidden">Text</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!selectedId) selectCanvas();
                setTool('select');
                setIsMobilePropsOpen(true);
              }}
              disabled={Boolean(cropSession)}
              aria-label="Adjust selection"
              aria-expanded={isMobilePropsOpen}
              aria-controls="meme-controls"
              className={`mobile-only-tab mobile-tab-item order-5 md:hidden ${isMobilePropsOpen && tool === 'select' ? 'text-accent' : 'text-content-muted'}`}
            >
              <Settings2 size={21} />
              <span>Adjust</span>
            </button>

            <button
              type="button"
              onClick={() => setIsTemplateLibraryOpen(true)}
              disabled={Boolean(cropSession)}
              aria-label="Browse meme templates"
              className="hidden h-12 w-12 items-center justify-center rounded-xl bg-surface transition-colors hover:bg-accent hover:text-on-accent disabled:cursor-not-allowed disabled:opacity-40 md:order-5 md:flex"
              title="Templates"
            >
              <TemplateLibraryIcon size={24} />
            </button>
            <button
              type="button"
              onClick={() => {
                pendingImagePlacementRef.current = null;
                addImageInputRef.current?.click();
              }}
              disabled={Boolean(cropSession)}
              className="hidden h-12 w-12 items-center justify-center rounded-xl bg-surface transition-colors hover:bg-accent hover:text-on-accent disabled:cursor-not-allowed disabled:opacity-40 md:order-7 md:flex"
              title="Add Image"
              aria-label="Add image"
            >
              <ImagePlus size={24} />
            </button>
            <input
              ref={addImageInputRef}
              type="file"
              className="hidden"
              onChange={onFileUpload}
              accept={IMAGE_ACCEPT}
            />
          </div>

          <div className="hidden md:block mt-auto p-3 text-content-subtle text-[10px] text-center">
            <button
              type="button"
              onClick={() => setIsAboutOpen(true)}
              aria-label="About MemeSquid"
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-surface transition-colors hover:bg-accent hover:text-on-accent"
              title="About"
            >
              <HelpCircle size={20} />
            </button>
          </div>
        </aside>

        {/* Canvas Area */}
        <section
          id="editor-workspace"
          ref={canvasAreaRef}
          tabIndex={-1}
          aria-labelledby="editor-workspace-title"
          className={`relative order-1 flex flex-1 overflow-auto bg-canvas md:order-2 md:p-8 ${canvas ? 'p-3' : 'items-start justify-center p-0 md:items-center'} ${isCanvasScrollable ? 'items-start justify-start' : canvas ? 'items-center justify-center' : ''}`}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) selectCanvas();
          }}
        >
          <h2 id="editor-workspace-title" className="sr-only">
            Meme editor workspace
          </h2>
          {!canvas ? (
            <div className="group flex min-h-full w-full max-w-2xl flex-col items-center justify-center bg-background transition-colors md:min-h-96 md:rounded-2xl md:border md:border-border">
              <div className="flex w-full flex-col items-center justify-center px-4 py-5 text-center sm:px-6 md:py-10">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.1em] text-accent-hover sm:mb-5 sm:text-[10px] sm:tracking-[0.12em]">
                  <ShieldCheck size={13} /> Local · Offline · Open source
                </div>
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-[1.1rem] bg-accent text-on-accent sm:mb-5 sm:h-16 sm:w-16 sm:rounded-2xl">
                  <Upload size={26} strokeWidth={2.5} />
                </div>
                <h2 className="text-[1.75rem] font-black tracking-[-0.045em] text-content-strong sm:text-3xl md:text-4xl">
                  Meme Editor.
                </h2>
                <p className="mt-2 max-w-md text-[13px] leading-relaxed text-content-muted sm:mt-3 sm:text-sm md:text-base">
                  Remove backgrounds, combine images, add captions, and draw directly in your
                  browser.
                </p>
                <div className="mt-5 flex w-full max-w-sm flex-col items-stretch justify-center gap-2.5 sm:mt-6 md:max-w-none md:flex-row md:flex-wrap md:items-center md:gap-3">
                  <button
                    type="button"
                    onClick={() => setIsTemplateLibraryOpen(true)}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[0.9rem] bg-accent px-5 py-3 text-sm font-extrabold text-on-accent transition-colors hover:bg-accent-hover md:min-h-11 md:rounded-xl"
                  >
                    <TemplateLibraryIcon size={17} /> Browse templates
                  </button>
                  <label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-[0.9rem] bg-content-strong px-5 py-3 text-sm font-extrabold text-on-accent transition-colors hover:bg-content md:min-h-11 md:rounded-xl">
                    <ImageIcon size={17} /> Choose an image
                    <input
                      type="file"
                      className="hidden"
                      onChange={onFileUpload}
                      accept={IMAGE_ACCEPT}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={createBlankCanvas}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[0.9rem] border border-border bg-surface px-5 py-3 text-sm font-bold text-content-strong transition-colors hover:border-accent hover:text-accent-hover md:min-h-11 md:rounded-xl"
                  >
                    <LayoutPanelTop size={17} /> Start blank
                  </button>
                </div>
                <div className="mt-4 hidden flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] font-semibold text-content-subtle min-[375px]:flex sm:mt-6">
                  <span className="flex items-center gap-1.5">
                    <Wand2 size={14} /> One-click background removal
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ClipboardPaste size={14} /> Paste from clipboard
                  </span>
                  <span className="hidden md:inline">PNG · JPG · WEBP · SVG</span>
                </div>
                {canInstall && (
                  <button
                    type="button"
                    onClick={() => void install()}
                    className="mt-4 flex w-full max-w-sm items-center gap-3 rounded-2xl border border-border bg-surface/80 p-3 text-left transition-colors hover:border-border-strong hover:bg-surface md:mt-6"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent">
                      {installMode === 'ios-instructions' ? (
                        <Share2 size={21} />
                      ) : (
                        <Smartphone size={21} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-extrabold text-content-strong">
                        {installMode === 'ios-instructions'
                          ? 'Add to Home Screen'
                          : 'Install MemeSquid'}
                      </span>
                      <span className="mt-0.5 block text-xs text-content-muted">
                        {installMode === 'ios-instructions'
                          ? 'Open like an app and keep editing offline.'
                          : 'Launch faster and work offline.'}
                      </span>
                    </span>
                    <ChevronDown size={18} className="-rotate-90 text-content-subtle" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div
              ref={canvasViewportRef}
              role="region"
              aria-label="Meme canvas editor"
              aria-describedby="canvas-description"
              className="relative touch-none leading-[0]"
              style={{ width: canvas.width * canvasZoom, height: canvas.height * canvasZoom }}
            >
              <p id="canvas-description" className="sr-only">
                {canvasDescription}
              </p>
              <div className="keyboard-layer-controls" role="group" aria-label="Canvas layers">
                <span className="text-xs font-bold text-content">Select layer</span>
                <button
                  type="button"
                  onClick={() => setSelectedId(CANVAS_ID)}
                  aria-pressed={selectedId === CANVAS_ID}
                >
                  Canvas
                </button>
                {allElements.map((element, index) => (
                  <button
                    key={`keyboard-${element.id}`}
                    type="button"
                    onClick={() => setSelectedId(element.id)}
                    aria-pressed={selectedId === element.id}
                  >
                    {element._itemType === 'text'
                      ? `Text: ${element.text || 'empty text'}`
                      : `Image ${allElements.slice(0, index + 1).filter((item) => item._itemType === 'image').length}`}
                  </button>
                ))}
              </div>
              <div
                className={`relative h-full w-full overflow-hidden shadow-xl shadow-overlay/40 ${canvas.fill.type === 'transparent' ? 'canvas-transparency-grid' : ''}`}
              >
                <Stage
                  width={canvas.width}
                  height={canvas.height}
                  ref={stageRef}
                  style={{
                    cursor: tool === 'draw' ? 'none' : undefined,
                    transform: `scale(${canvasZoom})`,
                    transformOrigin: 'top left',
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseEnter={updateBrushCursor}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                  onTouchStart={handleCanvasTouchStart}
                  onTouchMove={handleCanvasTouchMove}
                  onTouchEnd={handleCanvasTouchEnd}
                  onTouchCancel={handleCanvasTouchEnd}
                  onDblTap={handleCanvasDoubleTap}
                >
                  <Layer>
                    <Rect
                      id={CANVAS_ID}
                      width={canvas.width}
                      height={canvas.height}
                      fill={canvas.fill.type === 'solid' ? canvas.fill.color : 'rgba(0,0,0,0)'}
                    />
                    {allElements.map((element) =>
                      element._itemType === 'image' ? (
                        <ImageElementItem
                          key={element.id}
                          data={toKonvaElementData(element)}
                          isSelected={element.id === selectedId && tool === 'select'}
                          onSelect={(id: string) => {
                            if (tool === 'select') setSelectedId(id);
                          }}
                          onChange={updateImage}
                          tool={tool}
                          onFlip={flipImage}
                          onRemoveBackground={requestBackgroundRemoval}
                          onRestoreBackground={restoreImageBackground}
                          onDelete={deleteElement}
                          backgroundRemovalState={bgRemovalState}
                          cropDraft={
                            cropSession?.kind === 'image' && cropSession.targetId === element.id
                              ? cropSession.draft
                              : null
                          }
                          onBeginCrop={beginImageCrop}
                          onCropDraftChange={updateImageCropDraft}
                          onApplyCrop={applyCrop}
                          onCancelCrop={cancelCrop}
                          onResetCrop={resetCrop}
                        />
                      ) : (
                        <TextElementItem
                          key={element.id}
                          data={toKonvaElementData(element)}
                          isSelected={element.id === selectedId && tool === 'select'}
                          onSelect={(id: string) => {
                            if (tool === 'select') setSelectedId(id);
                          }}
                          onChange={updateText}
                          tool={tool}
                        />
                      ),
                    )}
                    {lines.map((line) => (
                      <KonvaLine
                        key={line.id}
                        points={line.points}
                        stroke={line.color}
                        strokeWidth={line.strokeWidth}
                        tension={0.6}
                        lineCap="round"
                        lineJoin="round"
                        globalCompositeOperation="source-over"
                        listening={false}
                      />
                    ))}
                    {cropSession?.kind === 'canvas' && (
                      <CanvasCropOverlay
                        canvas={canvas}
                        draft={cropSession.draft}
                        onChange={updateCanvasCropDraft}
                      />
                    )}
                  </Layer>
                </Stage>
                {tool === 'draw' && (
                  <div
                    ref={brushCursorRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 top-0 z-10 box-border overflow-hidden rounded-full border border-white opacity-0 shadow-[0_0_0_1px_rgba(0,0,0,0.85)] will-change-transform"
                    style={{
                      width: drawWidth * canvasZoom,
                      height: drawWidth * canvasZoom,
                    }}
                  >
                    <div
                      className="h-full w-full opacity-20"
                      style={{ backgroundColor: drawColor }}
                    />
                  </div>
                )}
              </div>
              {selectedId === CANVAS_ID && tool === 'select' && !expansionDraft && !cropSession && (
                <CanvasEdgeControls canvas={canvas} onAdd={openExpansion} />
              )}
              {cropSession?.kind === 'canvas' && (
                <CropControlBar
                  ariaLabel="Canvas crop controls"
                  label={`${Math.round(cropSession.draft.width)} × ${Math.round(cropSession.draft.height)}`}
                  onApply={applyCrop}
                  onCancel={cancelCrop}
                  onReset={resetCrop}
                  className="absolute left-1/2 top-3 z-30 -translate-x-1/2"
                />
              )}
              {expansionDraft && (
                <CanvasExpansionPreview
                  canvas={canvas}
                  zoom={canvasZoom}
                  draft={expansionDraft}
                  onChange={setExpansionDraft}
                  onModeChange={setExpansionMode}
                  onApply={applyExpansion}
                  onCancel={cancelExpansion}
                />
              )}
            </div>
          )}
        </section>

        {canvas && !isMobilePropsOpen && (
          <>
            <output
              className={`pointer-events-none absolute bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-20 -translate-x-1/2 rounded-full bg-background/90 px-3 py-2 text-xs font-extrabold tabular-nums text-content-strong shadow-xl backdrop-blur-md transition-opacity md:hidden ${isZoomHudVisible ? 'opacity-100' : 'opacity-0'}`}
              aria-label={`Canvas zoom ${Math.round(canvasZoom * 100)} percent`}
              aria-live="polite"
            >
              {Math.round(canvasZoom * 100)}%
            </output>
            {!isFitZoom && (
              <button
                type="button"
                onClick={fitCanvasToViewport}
                className="absolute bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 z-20 flex min-h-11 items-center gap-2 rounded-full border border-border bg-background/90 px-3 text-xs font-extrabold text-content-strong shadow-xl backdrop-blur-md md:hidden"
                aria-label="Fit canvas to viewport"
              >
                <Maximize2 size={17} /> Fit
              </button>
            )}
            <div className="pointer-events-none absolute bottom-4 right-[21rem] z-20 hidden md:block">
              <CanvasZoomControls
                zoom={canvasZoom}
                isFit={isFitZoom}
                onZoomIn={zoomCanvasIn}
                onZoomOut={zoomCanvasOut}
                onFit={fitCanvasToViewport}
              />
            </div>
          </>
        )}

        {/* Mobile Overlay */}
        {isMobilePropsOpen && (
          <div
            className="fixed inset-0 z-40 bg-overlay/55 backdrop-blur-[2px] md:hidden"
            onClick={closeMobileProps}
            aria-hidden="true"
          />
        )}

        {/* Properties Panel */}
        <aside
          ref={mobilePropsDialogRef}
          id="meme-controls"
          aria-labelledby="meme-controls-title"
          tabIndex={-1}
          className={`properties-panel fixed inset-x-0 bottom-0 z-50 order-3 flex max-h-[85dvh] w-full flex-col rounded-t-[1.75rem] border-t border-border bg-background shadow-2xl shadow-overlay/60 transition-[transform,visibility] duration-300 md:static md:max-h-none md:w-80 md:rounded-none md:border-l md:border-t-0 md:shadow-none ${isMobilePropsOpen ? 'visible translate-y-0 pointer-events-auto' : 'invisible translate-y-full pointer-events-none md:visible md:translate-y-0 md:pointer-events-auto'}`}
        >
          <div
            className="flex h-5 shrink-0 items-center justify-center md:hidden"
            aria-hidden="true"
          >
            <span className="h-1 w-9 rounded-full bg-border-emphasis" />
          </div>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 pb-3 pt-1 md:p-4">
            <div className="flex items-center gap-2">
              <Settings2 size={18} className="text-accent" />
              <h2
                id="meme-controls-title"
                className="text-sm font-bold uppercase tracking-widest text-content"
              >
                Meme controls
              </h2>
            </div>
            <button
              aria-label="Close meme controls"
              className="md:hidden flex h-11 w-11 items-center justify-center rounded-xl text-content-muted hover:bg-surface hover:text-content-strong"
              onClick={closeMobileProps}
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {canvas && (
              <MobileCanvasZoomSettings
                zoom={canvasZoom}
                isFit={isFitZoom}
                onZoomChange={setManualCanvasZoom}
                onFit={fitCanvasToViewport}
              />
            )}
            {tool === 'draw' ? (
              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-content-muted mb-2">
                    <PenTool size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">
                      Draw Settings
                    </h3>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="brush-color"
                        className="text-[10px] font-medium text-content-subtle uppercase"
                      >
                        Brush Color
                      </label>
                      <ColorPicker
                        id="brush-color"
                        value={drawColor}
                        onChange={setDrawColor}
                        ariaLabel="Brush color"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label
                          htmlFor="brush-size"
                          className="text-[10px] font-medium text-content-subtle uppercase"
                        >
                          Brush Size
                        </label>
                        <output htmlFor="brush-size" className="text-[10px] text-content-muted">
                          {drawWidth}px
                        </output>
                      </div>
                      <div className="flex items-center gap-4">
                        <input
                          id="brush-size"
                          type="range"
                          min="1"
                          max="50"
                          step="1"
                          value={drawWidth}
                          onChange={(e) => setDrawWidth(Number(e.target.value))}
                          className="flex-1 accent-accent"
                        />
                        <div className="w-10 h-10 flex items-center justify-center bg-canvas/50 rounded-xl border border-border">
                          <div
                            className="rounded-full bg-accent"
                            style={{
                              width: `${Math.min(drawWidth, 38)}px`,
                              height: `${Math.min(drawWidth, 38)}px`,
                              backgroundColor: drawColor,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : selectedId === CANVAS_ID && canvas && cropSession?.kind === 'canvas' ? (
              <div className="space-y-4 rounded-2xl border border-accent/30 bg-accent/10 p-4 text-sm leading-relaxed text-content-secondary">
                <div className="flex items-center gap-2 font-bold text-accent-hover">
                  <CropIcon size={17} /> Canvas crop active
                </div>
                <p>
                  Drag the crop frame and its handles on the canvas. Apply keeps cropped-away layers
                  available outside the new boundary.
                </p>
                <p className="text-xs text-content-subtle">
                  The add-space controls return after you apply or cancel.
                </p>
              </div>
            ) : selectedId === CANVAS_ID && canvas ? (
              <CanvasProperties
                canvas={canvas}
                anchor={canvasResizeAnchor}
                onAnchorChange={setCanvasResizeAnchor}
                onResize={resizeCanvasTo}
                onFillChange={updateCanvasFill}
                onExpand={openExpansion}
                onCrop={beginCanvasCrop}
              />
            ) : cropSession?.kind === 'image' ? (
              <div className="space-y-4 rounded-2xl border border-accent/30 bg-accent/10 p-4 text-sm leading-relaxed text-content-secondary">
                <div className="flex items-center gap-2 font-bold text-accent-hover">
                  <CropIcon size={17} /> Image crop active
                </div>
                <p>
                  Drag the crop frame or use its handles. The dimmed source remains available until
                  you apply.
                </p>
                <p className="text-xs text-content-subtle">
                  Press Enter to apply or Escape to cancel.
                </p>
              </div>
            ) : selectedText ? (
              <div className="space-y-8">
                {/* Content Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-content-muted mb-2">
                    <AlignLeft size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Content</h3>
                  </div>
                  <textarea
                    id="text-content"
                    aria-label="Meme text content"
                    value={selectedText.text}
                    onChange={(e) => updateText(selectedText.id, { text: e.target.value })}
                    className="w-full bg-canvas/50 rounded-xl border border-border p-3 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-colors resize-none"
                    rows={3}
                  />
                </div>

                {/* Typography Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-content-muted mb-2">
                    <Type size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Typography</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5 col-span-2">
                      <label
                        htmlFor="text-font-family"
                        className="text-[10px] font-medium text-content-subtle uppercase"
                      >
                        Font Family
                      </label>
                      <div className="relative">
                        <select
                          id="text-font-family"
                          value={selectedText.fontFamily}
                          onChange={(e) =>
                            updateText(selectedText.id, { fontFamily: e.target.value })
                          }
                          className="w-full bg-canvas/50 rounded-xl border border-border p-2 text-sm focus:border-accent outline-none transition-colors appearance-none pr-8"
                        >
                          <option value="Impact, sans-serif">Impact</option>
                          <option value="Arial, sans-serif">Arial</option>
                          <option value='"Comic Sans MS", Comic Sans, cursive'>Comic Sans</option>
                          <option value='"Times New Roman", Times, serif'>Times New Roman</option>
                          <option value='"Courier New", Courier, monospace'>Courier New</option>
                          <option value="Verdana, sans-serif">Verdana</option>
                          <option value="Georgia, serif">Georgia</option>
                          <option value='"Trebuchet MS", sans-serif'>Trebuchet MS</option>
                        </select>
                        <ChevronDown
                          size={14}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-content-subtle pointer-events-none"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="text-font-size"
                        className="text-[10px] font-medium text-content-subtle uppercase"
                      >
                        Size
                      </label>
                      <input
                        id="text-font-size"
                        aria-label="Text size in pixels"
                        type="number"
                        step="1"
                        value={Math.round(selectedText.fontSize)}
                        onChange={(e) =>
                          updateText(selectedText.id, { fontSize: Number(e.target.value) })
                        }
                        className="w-full bg-canvas/50 rounded-xl border border-border p-2 text-sm focus:border-accent outline-none transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="text-stroke-width"
                        className="text-[10px] font-medium text-content-subtle uppercase"
                      >
                        Stroke
                      </label>
                      <input
                        id="text-stroke-width"
                        aria-label="Text outline width in pixels"
                        type="number"
                        step="1"
                        value={Math.round(selectedText.strokeWidth)}
                        onChange={(e) =>
                          updateText(selectedText.id, { strokeWidth: Number(e.target.value) })
                        }
                        className="w-full bg-canvas/50 rounded-xl border border-border p-2 text-sm focus:border-accent outline-none transition-colors"
                      />
                    </div>
                  </div>
                </div>

                {/* Appearance Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-content-muted mb-2">
                    <Palette size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Colors</h3>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="text-fill-color"
                        className="text-[10px] font-medium text-content-subtle uppercase"
                      >
                        Fill
                      </label>
                      <ColorPicker
                        id="text-fill-color"
                        value={selectedText.fill}
                        onChange={(fill) => updateText(selectedText.id, { fill })}
                        ariaLabel="Text fill color"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="text-outline-color"
                        className="text-[10px] font-medium text-content-subtle uppercase"
                      >
                        Outline
                      </label>
                      <ColorPicker
                        id="text-outline-color"
                        value={selectedText.stroke}
                        onChange={(stroke) => updateText(selectedText.id, { stroke })}
                        ariaLabel="Text outline color"
                      />
                    </div>
                  </div>
                </div>

                {/* Shadow Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-content-muted mb-2">
                    <Box size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Shadow</h3>
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label
                          htmlFor="text-shadow-color"
                          className="text-[10px] font-medium text-content-subtle uppercase"
                        >
                          Color
                        </label>
                        <ColorPicker
                          id="text-shadow-color"
                          value={selectedText.shadowColor || '#000000'}
                          onChange={(shadowColor) => updateText(selectedText.id, { shadowColor })}
                          ariaLabel="Text shadow color"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <label
                              htmlFor="text-shadow-blur"
                              className="text-[10px] font-medium text-content-subtle uppercase"
                            >
                              Blur
                            </label>
                            <output
                              htmlFor="text-shadow-blur"
                              className="text-[10px] text-content-muted"
                            >
                              {round2(selectedText.shadowBlur || 0)}
                            </output>
                          </div>
                          <input
                            id="text-shadow-blur"
                            type="range"
                            min="0"
                            max="50"
                            step="1"
                            value={selectedText.shadowBlur || 0}
                            onChange={(e) =>
                              updateText(selectedText.id, { shadowBlur: Number(e.target.value) })
                            }
                            className="w-full accent-accent"
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <label
                              htmlFor="text-shadow-opacity"
                              className="text-[10px] font-medium text-content-subtle uppercase"
                            >
                              Opacity
                            </label>
                            <output
                              htmlFor="text-shadow-opacity"
                              className="text-[10px] text-content-muted"
                            >
                              {round2(selectedText.shadowOpacity ?? 1)}
                            </output>
                          </div>
                          <input
                            id="text-shadow-opacity"
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={selectedText.shadowOpacity ?? 1}
                            onChange={(e) =>
                              updateText(selectedText.id, { shadowOpacity: Number(e.target.value) })
                            }
                            className="w-full accent-accent"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label
                          htmlFor="text-shadow-offset-x"
                          className="text-[10px] font-medium text-content-subtle uppercase"
                        >
                          Offset X
                        </label>
                        <input
                          id="text-shadow-offset-x"
                          type="number"
                          step="1"
                          value={Math.round(selectedText.shadowOffsetX || 0)}
                          onChange={(e) =>
                            updateText(selectedText.id, { shadowOffsetX: Number(e.target.value) })
                          }
                          className="w-full bg-canvas/50 rounded-xl border border-border p-2 text-sm focus:border-accent outline-none transition-colors"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label
                          htmlFor="text-shadow-offset-y"
                          className="text-[10px] font-medium text-content-subtle uppercase"
                        >
                          Offset Y
                        </label>
                        <input
                          id="text-shadow-offset-y"
                          type="number"
                          step="1"
                          value={Math.round(selectedText.shadowOffsetY || 0)}
                          onChange={(e) =>
                            updateText(selectedText.id, { shadowOffsetY: Number(e.target.value) })
                          }
                          className="w-full bg-canvas/50 rounded-xl border border-border p-2 text-sm focus:border-accent outline-none transition-colors"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Layout Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-content-muted mb-2">
                    <Box size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Layout</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="text-position-x"
                        className="text-[10px] font-medium text-content-subtle uppercase"
                      >
                        Position X
                      </label>
                      <input
                        id="text-position-x"
                        type="number"
                        step="1"
                        value={Math.round(selectedText.x)}
                        onChange={(e) => updateText(selectedText.id, { x: Number(e.target.value) })}
                        className="w-full bg-canvas/50 rounded-xl border border-border p-2 text-sm focus:border-accent outline-none transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="text-position-y"
                        className="text-[10px] font-medium text-content-subtle uppercase"
                      >
                        Position Y
                      </label>
                      <input
                        id="text-position-y"
                        type="number"
                        step="1"
                        value={Math.round(-selectedText.y)}
                        onChange={(e) =>
                          updateText(selectedText.id, { y: -Number(e.target.value) })
                        }
                        className="w-full bg-canvas/50 rounded-xl border border-border p-2 text-sm focus:border-accent outline-none transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <p className="text-[10px] font-medium text-content-subtle uppercase">
                        Align to Canvas
                      </p>
                      <CanvasAlignmentControl onAlign={alignElementToCanvas} />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <div className="flex justify-between">
                        <label
                          htmlFor="text-rotation"
                          className="text-[10px] font-medium text-content-subtle uppercase"
                        >
                          Rotation
                        </label>
                        <output htmlFor="text-rotation" className="text-[10px] text-content-muted">
                          {round2(selectedText.rotation || 0)}°
                        </output>
                      </div>
                      <input
                        id="text-rotation"
                        aria-valuetext={`${round2(selectedText.rotation || 0)} degrees`}
                        type="range"
                        min="-180"
                        max="180"
                        step="1"
                        value={selectedText.rotation || 0}
                        onChange={(e) => handleRotationChange(Number(e.target.value))}
                        className="w-full accent-accent"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                  <button
                    onClick={deleteSelected}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-danger-strong/10 text-danger border border-danger-strong/20 hover:bg-danger-strong/20 hover:border-danger-strong/30 transition-colors font-medium text-sm"
                  >
                    <Trash2 size={16} /> Delete Element
                  </button>
                </div>
              </div>
            ) : selectedImage ? (
              <div className="space-y-8">
                {/* Layout Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-content-muted mb-2">
                    <Box size={14} />
                    <h3 className="text-xs font-semibold uppercase tracking-wider">Layout</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="image-position-x"
                        className="text-[10px] font-medium text-content-subtle uppercase"
                      >
                        Position X
                      </label>
                      <input
                        id="image-position-x"
                        type="number"
                        step="1"
                        value={Math.round(selectedImage.x)}
                        onChange={(e) =>
                          updateImage(selectedImage.id, { x: Number(e.target.value) })
                        }
                        className="w-full bg-canvas/50 rounded-xl border border-border p-2 text-sm focus:border-accent outline-none transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="image-position-y"
                        className="text-[10px] font-medium text-content-subtle uppercase"
                      >
                        Position Y
                      </label>
                      <input
                        id="image-position-y"
                        type="number"
                        step="1"
                        value={Math.round(selectedImage.y)}
                        onChange={(e) =>
                          updateImage(selectedImage.id, { y: Number(e.target.value) })
                        }
                        className="w-full bg-canvas/50 rounded-xl border border-border p-2 text-sm focus:border-accent outline-none transition-colors"
                      />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <p className="text-[10px] font-medium text-content-subtle uppercase">
                        Align to Canvas
                      </p>
                      <CanvasAlignmentControl onAlign={alignElementToCanvas} />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <div className="flex justify-between">
                        <label
                          htmlFor="image-rotation"
                          className="text-[10px] font-medium text-content-subtle uppercase"
                        >
                          Rotation
                        </label>
                        <output htmlFor="image-rotation" className="text-[10px] text-content-muted">
                          {round2(selectedImage.rotation || 0)}°
                        </output>
                      </div>
                      <input
                        id="image-rotation"
                        aria-valuetext={`${round2(selectedImage.rotation || 0)} degrees`}
                        type="range"
                        min="-180"
                        max="180"
                        step="1"
                        value={selectedImage.rotation || 0}
                        onChange={(e) => handleRotationChange(Number(e.target.value))}
                        className="w-full accent-accent"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-border/50">
                  <button
                    onClick={deleteSelected}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-danger-strong/10 text-danger border border-danger-strong/20 hover:bg-danger-strong/20 hover:border-danger-strong/30 transition-colors font-medium text-sm"
                  >
                    <Trash2 size={16} /> Delete Element
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-content-subtle space-y-4 opacity-50">
                <Settings2 size={48} strokeWidth={1} />
                <p className="text-sm text-center">
                  Select an element on the canvas
                  <br />
                  to edit its properties
                </p>
              </div>
            )}
          </div>
        </aside>
      </main>

      {isMobileAddOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <button
            type="button"
            className="absolute inset-0 h-full w-full bg-overlay/60 backdrop-blur-[2px]"
            onClick={closeMobileAdd}
            aria-label="Close add menu"
            tabIndex={-1}
          />
          <div
            ref={mobileAddDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-add-title"
            tabIndex={-1}
            className="mobile-sheet absolute inset-x-0 bottom-0 rounded-t-[1.75rem] border-t border-border bg-background px-4 pb-4 shadow-2xl shadow-overlay/60"
          >
            <div className="flex h-6 items-center justify-center" aria-hidden="true">
              <span className="h-1 w-9 rounded-full bg-border-emphasis" />
            </div>
            <div className="flex items-center justify-between pb-3">
              <div>
                <h2 id="mobile-add-title" className="text-lg font-black text-content-strong">
                  Add to your meme
                </h2>
                <p className="text-xs text-content-muted">Choose what you want to add.</p>
              </div>
              <button
                type="button"
                onClick={closeMobileAdd}
                aria-label="Close add menu"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-content-muted"
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-hidden rounded-2xl bg-surface">
              <button
                type="button"
                data-dialog-initial-focus
                onClick={() => {
                  closeMobileAdd();
                  setIsTemplateLibraryOpen(true);
                }}
                className="mobile-sheet-action"
              >
                <span className="mobile-sheet-action-icon bg-accent/15 text-accent-hover">
                  <TemplateLibraryIcon size={21} />
                </span>
                <span>
                  <strong>Browse templates</strong>
                  <small>Start from a popular meme format</small>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  closeMobileAdd();
                  window.requestAnimationFrame(() => {
                    pendingImagePlacementRef.current = null;
                    addImageInputRef.current?.click();
                  });
                }}
                className="mobile-sheet-action border-t border-border"
              >
                <span className="mobile-sheet-action-icon bg-content-strong text-on-accent">
                  <ImagePlus size={21} />
                </span>
                <span>
                  <strong>Choose a photo</strong>
                  <small>Add an image from this device</small>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  closeMobileAdd();
                  createBlankCanvas();
                }}
                className="mobile-sheet-action border-t border-border"
              >
                <span className="mobile-sheet-action-icon bg-background text-content-secondary">
                  <LayoutPanelTop size={21} />
                </span>
                <span>
                  <strong>New blank canvas</strong>
                  <small>Replace this project with a clean canvas</small>
                </span>
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {canInstall && (
                <button
                  type="button"
                  onClick={() => {
                    closeMobileAdd();
                    void install();
                  }}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-surface px-3 text-xs font-bold text-content-secondary"
                >
                  {installMode === 'ios-instructions' ? (
                    <Share2 size={17} />
                  ) : (
                    <Smartphone size={17} />
                  )}
                  {installMode === 'ios-instructions' ? 'Add to Home' : 'Install app'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  closeMobileAdd();
                  setIsAboutOpen(true);
                }}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-xl bg-surface px-3 text-xs font-bold text-content-secondary ${canInstall ? '' : 'col-span-2'}`}
              >
                <HelpCircle size={17} /> About MemeSquid
              </button>
            </div>
          </div>
        </div>
      )}

      {isTemplateLibraryOpen && (
        <React.Suspense
          fallback={
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay/80 p-4"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-background px-5 py-4 font-bold text-content-strong shadow-xl">
                <Loader2 size={20} className="animate-spin text-accent" /> Loading templates…
              </div>
            </div>
          }
        >
          <TemplateLibraryDialog
            isOpen
            loadingTemplateId={loadingTemplateId}
            onClose={closeTemplateLibrary}
            onSelect={(template) => void startWithTemplate(template)}
          />
        </React.Suspense>
      )}

      {/* About Modal */}
      {isAboutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 p-4">
          <div
            ref={aboutDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            aria-describedby="about-description"
            tabIndex={-1}
            className="bg-background border border-border rounded-2xl p-6 max-w-md w-full shadow-xl relative overflow-hidden"
          >
            <button
              type="button"
              onClick={closeAbout}
              aria-label="Close About MemeSquid"
              className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center rounded-xl text-content-subtle hover:bg-surface hover:text-content-strong transition-colors"
            >
              <X size={20} />
            </button>
            <div className="relative flex items-center gap-3 mb-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-on-accent">
                <SquidMark className="h-10 w-10" />
              </div>
              <div>
                <h2
                  id="about-title"
                  className="text-2xl font-black tracking-tight text-content-strong"
                >
                  MemeSquid
                </h2>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
                  Free online meme editor
                </p>
              </div>
            </div>
            <div className="relative space-y-4 text-content-secondary text-sm leading-relaxed">
              <p id="about-description">
                MemeSquid is a free browser-based editor for creating memes and reaction images.
                Remove backgrounds, combine images, add text, and export in a few clicks.
              </p>
              <p>
                Your images stay on your device. MemeSquid runs locally, works offline after initial
                setup, and is open source.
              </p>
              {canInstall && (
                <button
                  type="button"
                  onClick={() => {
                    closeAbout();
                    void install();
                  }}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 font-extrabold text-on-accent transition-colors hover:bg-accent-hover"
                >
                  {installMode === 'ios-instructions' ? (
                    <Share2 size={18} />
                  ) : (
                    <Smartphone size={18} />
                  )}
                  {installMode === 'ios-instructions'
                    ? 'Add MemeSquid to Home Screen'
                    : 'Install MemeSquid'}
                </button>
              )}
              <p className="text-content-subtle">
                Vibe coded with{' '}
                <a
                  href="https://aistudio.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  Google AI Studio
                </a>{' '}
                and Gemini.
              </p>
              <div className="pt-4 border-t border-border space-y-3">
                <a
                  href="https://memesquid.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-content-muted hover:text-accent transition-colors"
                >
                  <Globe2 size={16} /> memesquid.com
                </a>
                <a
                  href="https://github.com/KyleTryon/Gemini-Meme-Generator"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-content-muted hover:text-accent transition-colors"
                >
                  <LinkIcon size={16} /> GitHub Repository
                </a>
                <a
                  href="https://x.com/TechSquidTV"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-content-muted hover:text-accent transition-colors"
                >
                  <LinkIcon size={16} /> @TechSquidTV
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {isInstallHelpOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-overlay/70 backdrop-blur-[2px] md:items-center md:p-4">
          <div
            ref={installHelpDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-help-title"
            aria-describedby="install-help-description"
            tabIndex={-1}
            className="mobile-sheet relative w-full max-w-sm rounded-t-[1.75rem] border-t border-border bg-background px-5 pb-5 pt-7 shadow-2xl md:rounded-2xl md:border md:p-6"
          >
            <div
              className="absolute inset-x-0 top-2 flex justify-center md:hidden"
              aria-hidden="true"
            >
              <span className="h-1 w-9 rounded-full bg-border-emphasis" />
            </div>
            <button
              type="button"
              onClick={dismissInstallHelp}
              aria-label="Close install instructions"
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-surface text-content-subtle transition-colors hover:text-content-strong md:right-2 md:top-2 md:h-11 md:w-11 md:rounded-xl md:bg-transparent md:hover:bg-surface"
            >
              <X size={20} />
            </button>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[0.9rem] bg-accent text-on-accent shadow-lg shadow-accent/10 md:mb-5 md:rounded-2xl">
              {isAppleMobile ? <Share2 size={23} /> : <Smartphone size={24} />}
            </div>
            <h2 id="install-help-title" className="pr-10 text-xl font-black text-content-strong">
              {isAppleMobile ? 'Add to Home Screen' : 'Install MemeSquid'}
            </h2>
            <div id="install-help-description">
              {isAppleMobile ? (
                <ol className="mt-5 overflow-hidden rounded-2xl bg-surface text-sm leading-relaxed text-content-secondary">
                  <li className="flex gap-3 p-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-hover">
                      <Share2 size={18} />
                    </span>
                    <span>
                      Tap the <strong className="text-content-strong">Share</strong> button in
                      Safari.
                    </span>
                  </li>
                  <li className="flex gap-3 border-t border-border p-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-hover">
                      <SquarePlus size={18} />
                    </span>
                    <span>
                      Choose <strong className="text-content-strong">Add to Home Screen</strong>,
                      then tap Add.
                    </span>
                  </li>
                </ol>
              ) : (
                <p className="mt-4 text-sm leading-relaxed text-content-secondary">
                  Open your browser menu and choose{' '}
                  <strong className="text-content-strong">Install app</strong> or{' '}
                  <strong className="text-content-strong">Add to Home screen</strong>.
                </p>
              )}
              <p className="mt-5 rounded-xl bg-canvas p-3 text-xs leading-relaxed text-content-muted">
                Once installed, MemeSquid opens like a regular app and its core editor works
                offline.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Background Removal Warning Modal */}
      {bgRemovalState.status === 'warning' && (
        <div className="fixed inset-0 bg-overlay/80 z-50 flex items-center justify-center p-4">
          <div
            ref={modelDownloadDialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="model-download-title"
            aria-describedby="model-download-description"
            tabIndex={-1}
            className="bg-background border border-border rounded-2xl p-6 max-w-md w-full shadow-xl relative"
          >
            <button
              type="button"
              onClick={cancelModelDownload}
              aria-label="Cancel AI model download"
              className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center rounded-xl text-content-muted hover:bg-surface hover:text-content-strong transition-colors"
            >
              <X size={20} />
            </button>
            <div className="flex items-center gap-3 mb-4 text-accent">
              <Wand2 size={28} />
              <h2 id="model-download-title" className="text-xl font-bold text-content-strong">
                Download AI Model?
              </h2>
            </div>
            <p
              id="model-download-description"
              className="text-content-secondary mb-4 leading-relaxed"
            >
              To remove backgrounds locally in your browser, we need to download the
              background-removal AI model (approximately 176 MB).
            </p>
            <p className="text-content-muted text-sm mb-6">
              This only happens once. The model will be cached in your browser for future use.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                data-dialog-initial-focus
                onClick={cancelModelDownload}
                className="min-h-11 rounded-xl px-4 text-sm font-semibold text-content-secondary hover:text-content-strong hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={acceptModelDownload}
                className="min-h-11 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent hover:bg-accent-hover transition-colors"
              >
                Download & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface CanvasZoomControlsProps {
  zoom: number;
  isFit: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

interface MobileCanvasZoomSettingsProps {
  zoom: number;
  isFit: boolean;
  onZoomChange: (zoom: number) => void;
  onFit: () => void;
}

const MobileCanvasZoomSettings = memo(
  ({ zoom, isFit, onZoomChange, onFit }: MobileCanvasZoomSettingsProps) => (
    <div className="mb-7 space-y-3 rounded-2xl bg-surface p-4 md:hidden">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-content-secondary">
            Canvas zoom
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-content-subtle">
            Pinch or move two fingers. Double-tap to toggle zoom.
          </p>
        </div>
        <output
          htmlFor="mobile-canvas-zoom"
          className="rounded-lg bg-background px-2.5 py-1.5 text-xs font-extrabold tabular-nums text-content-strong"
        >
          {Math.round(zoom * 100)}%
        </output>
      </div>
      <input
        id="mobile-canvas-zoom"
        type="range"
        min={MIN_CANVAS_ZOOM * 100}
        max={MAX_CANVAS_ZOOM * 100}
        step="1"
        value={Math.round(zoom * 100)}
        onChange={(event) => onZoomChange(Number(event.target.value) / 100)}
        className="w-full accent-accent"
        aria-label="Canvas zoom percentage"
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onFit}
          aria-pressed={isFit}
          className={`min-h-11 rounded-xl border px-3 text-xs font-extrabold transition-colors ${isFit ? 'border-accent bg-accent/15 text-accent-hover' : 'border-border bg-background text-content-secondary'}`}
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => onZoomChange(1)}
          aria-pressed={Math.abs(zoom - 1) < 0.005}
          className={`min-h-11 rounded-xl border px-3 text-xs font-extrabold transition-colors ${Math.abs(zoom - 1) < 0.005 ? 'border-accent bg-accent/15 text-accent-hover' : 'border-border bg-background text-content-secondary'}`}
        >
          100%
        </button>
      </div>
    </div>
  ),
);

const CanvasZoomControls = memo(
  ({ zoom, isFit, onZoomIn, onZoomOut, onFit }: CanvasZoomControlsProps) => {
    const iconButtonClass =
      'pointer-events-auto flex h-11 w-11 items-center justify-center text-content transition-colors hover:bg-surface-hover hover:text-content-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-hover disabled:cursor-not-allowed disabled:opacity-35';

    return (
      <div
        role="group"
        aria-label="Canvas zoom"
        className="flex items-center overflow-hidden rounded-xl border border-border bg-background/95 shadow-2xl shadow-overlay/50 backdrop-blur-md"
      >
        <button
          type="button"
          onClick={onZoomOut}
          disabled={zoom <= MIN_CANVAS_ZOOM}
          className={iconButtonClass}
          aria-label="Zoom out"
          title="Zoom out (Ctrl/Cmd −)"
        >
          <ZoomOut size={18} />
        </button>
        <output
          className="flex h-11 min-w-16 items-center justify-center border-x border-border px-2 text-xs font-bold tabular-nums text-content"
          aria-label={`Canvas zoom ${Math.round(zoom * 100)} percent`}
        >
          {Math.round(zoom * 100)}%
        </output>
        <button
          type="button"
          onClick={onZoomIn}
          disabled={zoom >= MAX_CANVAS_ZOOM}
          className={iconButtonClass}
          aria-label="Zoom in"
          title="Zoom in (Ctrl/Cmd +)"
        >
          <ZoomIn size={18} />
        </button>
        <button
          type="button"
          onClick={onFit}
          className={`${iconButtonClass} border-l border-border ${isFit ? 'bg-accent/15 text-accent-hover' : ''}`}
          aria-label="Fit canvas to viewport"
          aria-pressed={isFit}
          title="Fit canvas (Ctrl/Cmd 0)"
        >
          <Maximize2 size={18} />
        </button>
      </div>
    );
  },
);

interface CropControlBarProps {
  ariaLabel: string;
  label: string;
  onApply: () => void;
  onCancel: () => void;
  onReset: () => void;
  className?: string;
}

const CropControlBar = memo(
  ({ ariaLabel, label, onApply, onCancel, onReset, className = '' }: CropControlBarProps) => (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className={`flex w-max flex-wrap items-center justify-center gap-1 rounded-2xl border border-border bg-background/95 p-1.5 text-content-strong shadow-2xl shadow-overlay/50 backdrop-blur-md ${className}`}
    >
      <output className="whitespace-nowrap px-2 text-xs font-bold tabular-nums text-content-secondary">
        {label}
      </output>
      <button
        type="button"
        onClick={onReset}
        className={IMAGE_ACTION_ICON_BUTTON_CLASS}
        aria-label="Reset crop"
        title="Reset crop"
      >
        <RotateCcw size={18} />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className={IMAGE_ACTION_ICON_BUTTON_CLASS}
        aria-label="Cancel crop"
        title="Cancel crop (Escape)"
      >
        <X size={18} />
      </button>
      <button
        type="button"
        onClick={onApply}
        className="flex min-h-11 items-center gap-2 rounded-xl bg-accent px-3 text-sm font-extrabold text-on-accent transition-colors hover:bg-accent-hover"
        aria-label="Apply crop"
        title="Apply crop (Enter)"
      >
        <Check size={18} /> Apply
      </button>
    </div>
  ),
);

interface CanvasCropOverlayProps {
  canvas: CanvasState;
  draft: CropRect;
  onChange: (crop: CropRect) => void;
}

const CanvasCropOverlay = memo(({ canvas, draft, onChange }: CanvasCropOverlayProps) => {
  const frameRef = useRef<Konva.Rect | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const themeColors = getEditorThemeColors();
  useSelectedTransformer(true, frameRef, transformerRef);

  const commitFrame = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const crop = clampCropRect(
      {
        x: frame.x(),
        y: frame.y(),
        width: frame.width() * frame.scaleX(),
        height: frame.height() * frame.scaleY(),
      },
      canvas,
      MIN_CANVAS_SIZE,
    );
    frame.scaleX(1);
    frame.scaleY(1);
    onChange(crop);
  }, [canvas, onChange]);

  const right = draft.x + draft.width;
  const bottom = draft.y + draft.height;

  return (
    <React.Fragment>
      <Rect
        x={0}
        y={0}
        width={canvas.width}
        height={draft.y}
        fill={themeColors.canvasDim}
        listening={false}
      />
      <Rect
        x={0}
        y={bottom}
        width={canvas.width}
        height={Math.max(0, canvas.height - bottom)}
        fill={themeColors.canvasDim}
        listening={false}
      />
      <Rect
        x={0}
        y={draft.y}
        width={draft.x}
        height={draft.height}
        fill={themeColors.canvasDim}
        listening={false}
      />
      <Rect
        x={right}
        y={draft.y}
        width={Math.max(0, canvas.width - right)}
        height={draft.height}
        fill={themeColors.canvasDim}
        listening={false}
      />
      <Rect
        ref={frameRef}
        x={draft.x}
        y={draft.y}
        width={draft.width}
        height={draft.height}
        fill="rgba(255,255,255,0.001)"
        stroke={themeColors.accent}
        strokeWidth={2}
        draggable
        dragBoundFunc={(position) => ({
          x: Math.min(Math.max(0, position.x), canvas.width - draft.width),
          y: Math.min(Math.max(0, position.y), canvas.height - draft.height),
        })}
        onDragMove={commitFrame}
        onDragEnd={commitFrame}
        onTransformEnd={commitFrame}
      />
      <Transformer
        ref={transformerRef}
        anchorSize={TRANSFORMER_ANCHOR_SIZE}
        rotateEnabled={false}
        flipEnabled={false}
        borderStroke={themeColors.accent}
        anchorStroke={themeColors.onAccent}
        anchorFill={themeColors.accent}
        boundBoxFunc={(previousBox, nextBox) => {
          if (
            Math.abs(nextBox.width) < MIN_CANVAS_SIZE ||
            Math.abs(nextBox.height) < MIN_CANVAS_SIZE
          ) {
            return previousBox;
          }
          const crop = clampCropRect(
            {
              x: nextBox.x,
              y: nextBox.y,
              width: nextBox.width,
              height: nextBox.height,
            },
            canvas,
            MIN_CANVAS_SIZE,
          );
          return { ...nextBox, ...crop, rotation: 0 };
        }}
      />
    </React.Fragment>
  );
});

interface CanvasEdgeControlsProps {
  canvas: CanvasState;
  onAdd: (side: CanvasSide) => void;
}

const CanvasEdgeControls = memo(({ canvas, onAdd }: CanvasEdgeControlsProps) => {
  const buttonClass =
    'absolute z-20 flex h-11 w-11 items-center justify-center rounded-full border border-accent-hover/70 bg-background text-accent-hover shadow-xl shadow-overlay/50 hover:bg-accent hover:text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-hover transition-colors disabled:cursor-not-allowed disabled:opacity-30';
  const horizontalDisabled = canvas.width >= MAX_CANVAS_SIZE;
  const verticalDisabled = canvas.height >= MAX_CANVAS_SIZE;

  return (
    <div role="group" aria-label="Expand canvas controls">
      <button
        type="button"
        data-canvas-edge="top"
        onClick={() => onAdd('top')}
        disabled={verticalDisabled}
        className={`${buttonClass} -top-5 left-1/2 -translate-x-1/2`}
        aria-label="Add above canvas"
        title="Add above"
      >
        <Plus size={20} />
      </button>
      <button
        type="button"
        data-canvas-edge="right"
        onClick={() => onAdd('right')}
        disabled={horizontalDisabled}
        className={`${buttonClass} -right-5 top-1/2 -translate-y-1/2`}
        aria-label="Add to right of canvas"
        title="Add right"
      >
        <Plus size={20} />
      </button>
      <button
        type="button"
        data-canvas-edge="bottom"
        onClick={() => onAdd('bottom')}
        disabled={verticalDisabled}
        className={`${buttonClass} -bottom-5 left-1/2 -translate-x-1/2`}
        aria-label="Add below canvas"
        title="Add below"
      >
        <Plus size={20} />
      </button>
      <button
        type="button"
        data-canvas-edge="left"
        onClick={() => onAdd('left')}
        disabled={horizontalDisabled}
        className={`${buttonClass} -left-5 top-1/2 -translate-y-1/2`}
        aria-label="Add to left of canvas"
        title="Add left"
      >
        <Plus size={20} />
      </button>
    </div>
  );
});

interface CanvasExpansionPreviewProps {
  canvas: CanvasState;
  zoom: number;
  draft: ExpansionDraft;
  onChange: (draft: ExpansionDraft) => void;
  onModeChange: (mode: ExpansionMode) => void;
  onApply: () => void;
  onCancel: () => void;
}

const CanvasExpansionPreview = memo(
  ({
    canvas,
    zoom,
    draft,
    onChange,
    onModeChange,
    onApply,
    onCancel,
  }: CanvasExpansionPreviewProps) => {
    const dragStart = useRef<{ coordinate: number; size: number } | null>(null);
    const dialogRef = useDialogFocus(true, onCancel, false);
    const sizeOnScreen = draft.size * zoom;
    const isHorizontalAddition = draft.side === 'left' || draft.side === 'right';
    const maxAddition = isHorizontalAddition
      ? MAX_CANVAS_SIZE - canvas.width
      : MAX_CANVAS_SIZE - canvas.height;
    const previewStyle: React.CSSProperties =
      draft.side === 'top'
        ? { left: 0, top: -sizeOnScreen, width: '100%', height: sizeOnScreen }
        : draft.side === 'right'
          ? { left: '100%', top: 0, width: sizeOnScreen, height: '100%' }
          : draft.side === 'bottom'
            ? { left: 0, top: '100%', width: '100%', height: sizeOnScreen }
            : { right: '100%', top: 0, width: sizeOnScreen, height: '100%' };
    const handleStyle: React.CSSProperties =
      draft.side === 'top'
        ? { left: 0, top: 0, width: '100%', height: 12, cursor: 'ns-resize' }
        : draft.side === 'right'
          ? { right: 0, top: 0, width: 12, height: '100%', cursor: 'ew-resize' }
          : draft.side === 'bottom'
            ? { left: 0, bottom: 0, width: '100%', height: 12, cursor: 'ns-resize' }
            : { left: 0, top: 0, width: 12, height: '100%', cursor: 'ew-resize' };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStart.current = {
        coordinate: isHorizontalAddition ? event.clientX : event.clientY,
        size: draft.size,
      };
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart.current) return;
      const coordinate = isHorizontalAddition ? event.clientX : event.clientY;
      const direction = draft.side === 'top' || draft.side === 'left' ? -1 : 1;
      const delta =
        ((coordinate - dragStart.current.coordinate) * direction) / Math.max(zoom, 0.01);
      onChange({
        ...draft,
        size: Math.max(1, Math.min(maxAddition, Math.round(dragStart.current.size + delta))),
      });
    };

    const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragStart.current = null;
    };

    const sideLabel = { top: 'above', right: 'to the right', bottom: 'below', left: 'to the left' }[
      draft.side
    ];

    const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      const isDecreaseKey = isHorizontalAddition
        ? event.key === (draft.side === 'left' ? 'ArrowRight' : 'ArrowLeft')
        : event.key === (draft.side === 'top' ? 'ArrowDown' : 'ArrowUp');
      const isIncreaseKey = isHorizontalAddition
        ? event.key === (draft.side === 'left' ? 'ArrowLeft' : 'ArrowRight')
        : event.key === (draft.side === 'top' ? 'ArrowUp' : 'ArrowDown');
      if (!isDecreaseKey && !isIncreaseKey && event.key !== 'Home' && event.key !== 'End') return;

      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const size =
        event.key === 'Home'
          ? 1
          : event.key === 'End'
            ? maxAddition
            : Math.max(1, Math.min(maxAddition, draft.size + (isIncreaseKey ? step : -step)));
      onChange({ ...draft, size });
    };

    return (
      <React.Fragment>
        <div
          className={`pointer-events-none absolute z-10 border-2 border-dashed border-accent-hover/80 ${draft.fill.type === 'transparent' ? 'canvas-transparency-grid' : ''}`}
          style={{
            ...previewStyle,
            backgroundColor: draft.fill.type === 'solid' ? draft.fill.color : undefined,
          }}
        >
          <div
            role="slider"
            tabIndex={0}
            aria-label={`Resize space ${sideLabel}`}
            aria-orientation={isHorizontalAddition ? 'horizontal' : 'vertical'}
            aria-valuemin={1}
            aria-valuemax={maxAddition}
            aria-valuenow={Math.round(draft.size)}
            aria-valuetext={`${Math.round(draft.size)} pixels`}
            className="pointer-events-auto absolute z-30 bg-accent-hover/70 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-strong"
            style={handleStyle}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onKeyDown={handleResizeKeyDown}
          />
        </div>
        <div
          ref={dialogRef}
          role="dialog"
          aria-labelledby="canvas-expansion-title"
          aria-describedby="canvas-expansion-description"
          tabIndex={-1}
          className="absolute left-1/2 top-1/2 z-40 w-[min(19rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-4 text-left leading-normal shadow-2xl shadow-overlay/70"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="canvas-expansion-title"
                className="text-sm font-extrabold text-content-strong"
              >
                Add {sideLabel}
              </h2>
              <p id="canvas-expansion-description" className="mt-0.5 text-xs text-content-muted">
                Drag the highlighted outside edge or use its arrow keys to resize.
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-surface hover:text-content-strong"
              aria-label="Cancel canvas expansion"
            >
              <X size={17} />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="Addition type">
            {(
              [
                ['blank', 'Blank'],
                ['text', 'Text area'],
                ['image', 'Image'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => onModeChange(mode)}
                aria-pressed={draft.mode === mode}
                className={`min-h-11 rounded-xl border px-2 text-xs font-bold transition-colors ${draft.mode === mode ? 'border-accent-hover bg-accent text-on-accent' : 'border-border bg-surface text-content hover:border-border-emphasis'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-3">
            <label className="space-y-1.5 text-[10px] font-bold uppercase tracking-wider text-content-subtle">
              Size
              <input
                type="number"
                min="1"
                max={maxAddition}
                value={draft.size}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    size: Math.max(1, Math.min(maxAddition, Number(event.target.value))),
                  })
                }
                className="block min-h-11 w-full rounded-xl border border-border bg-canvas px-3 text-sm font-normal text-content-strong outline-none focus:border-accent-hover"
              />
            </label>
            <span className="pb-3 text-xs text-content-subtle">px</span>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-content-subtle">
              Canvas background
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...draft, fill: { type: 'solid', color: '#ffffff' } })}
                aria-pressed={
                  draft.fill.type === 'solid' && draft.fill.color.toLowerCase() === '#ffffff'
                }
                className={`min-h-11 flex-1 rounded-xl border text-xs font-bold transition-colors ${draft.fill.type === 'solid' && draft.fill.color.toLowerCase() === '#ffffff' ? 'border-accent-hover text-accent-hover' : 'border-border text-content-secondary hover:border-border-emphasis'}`}
              >
                White
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...draft, fill: { type: 'transparent' } })}
                aria-pressed={draft.fill.type === 'transparent'}
                className={`min-h-11 flex-1 rounded-xl border text-xs font-bold transition-colors ${draft.fill.type === 'transparent' ? 'border-accent-hover text-accent-hover' : 'border-border text-content-secondary hover:border-border-emphasis'}`}
              >
                Transparent
              </button>
            </div>
            <ColorPicker
              value={draft.fill.type === 'solid' ? draft.fill.color : '#ffffff'}
              onChange={(color) => onChange({ ...draft, fill: { type: 'solid', color } })}
              ariaLabel="Custom canvas color"
              className="mt-2"
            />
          </div>

          <button
            type="button"
            onClick={onApply}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-extrabold text-on-accent hover:bg-accent-hover"
          >
            <Check size={17} /> Add {Math.round(draft.size)} px
          </button>
        </div>
      </React.Fragment>
    );
  },
);

interface CanvasDimensionInputProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}

const CanvasDimensionInput = ({ label, value, onCommit }: CanvasDimensionInputProps) => {
  const [inputValue, setInputValue] = useState(String(Math.round(value)));

  const commit = () => {
    const parsed = Number(inputValue);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setInputValue(String(Math.round(value)));
  };

  return (
    <label className="space-y-1.5 text-[10px] font-medium uppercase text-content-subtle">
      {label}
      <input
        type="number"
        min={MIN_CANVAS_SIZE}
        max={MAX_CANVAS_SIZE}
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="block min-h-11 w-full rounded-xl border border-border bg-canvas/50 px-3 text-sm font-normal text-content-strong outline-none transition-colors hover:border-border focus:border-accent"
      />
    </label>
  );
};

interface CanvasPropertiesProps {
  canvas: CanvasState;
  anchor: CanvasAnchor;
  onAnchorChange: (anchor: CanvasAnchor) => void;
  onResize: (width: number, height: number, anchor: CanvasAnchor) => void;
  onFillChange: (fill: CanvasFill) => void;
  onExpand: (side: CanvasSide) => void;
  onCrop: () => void;
}

const CanvasProperties = memo(
  ({
    canvas,
    anchor,
    onAnchorChange,
    onResize,
    onFillChange,
    onExpand,
    onCrop,
  }: CanvasPropertiesProps) => (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-content-muted">
          <LayoutPanelTop size={14} />
          <h3 className="text-xs font-semibold uppercase tracking-wider">Canvas</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <CanvasDimensionInput
            key={`width-${canvas.width}`}
            label="Width"
            value={canvas.width}
            onCommit={(width) => onResize(width, canvas.height, anchor)}
          />
          <CanvasDimensionInput
            key={`height-${canvas.height}`}
            label="Height"
            value={canvas.height}
            onCommit={(height) => onResize(canvas.width, height, anchor)}
          />
        </div>
        <button
          type="button"
          onClick={onCrop}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 text-sm font-bold text-accent-hover transition-colors hover:border-accent-hover hover:bg-accent/15"
        >
          <CropIcon size={17} /> Crop canvas
        </button>
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase text-content-subtle">
            Resize anchor
          </p>
          <div
            className="grid w-fit grid-cols-3 gap-2"
            role="group"
            aria-label="Canvas resize anchor"
          >
            {ALIGNMENT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onAnchorChange(option.value)}
                className={`flex h-11 w-11 items-center justify-center rounded-xl border transition-colors ${anchor === option.value ? 'border-accent-hover bg-accent/15 text-accent-hover' : 'border-border bg-canvas/50 text-content-subtle hover:border-border-emphasis hover:text-content-secondary'}`}
                aria-label={`Keep ${option.label.toLowerCase()} anchored`}
                aria-pressed={anchor === option.value}
                title={`Keep ${option.label.toLowerCase()} anchored`}
              >
                <span className="h-2 w-2 rounded-full bg-current" />
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase text-content-subtle">Presets</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onResize(canvas.width, canvas.width, anchor)}
              className="min-h-11 rounded-xl border border-border bg-canvas/50 text-xs font-bold text-content-secondary transition-colors hover:border-accent-hover hover:text-accent-hover"
            >
              1:1
            </button>
            <button
              type="button"
              onClick={() => onResize(canvas.width, Math.round((canvas.width * 9) / 16), anchor)}
              className="min-h-11 rounded-xl border border-border bg-canvas/50 text-xs font-bold text-content-secondary transition-colors hover:border-accent-hover hover:text-accent-hover"
            >
              16:9
            </button>
            <button
              type="button"
              onClick={() => onResize(canvas.width, Math.round((canvas.width * 5) / 4), anchor)}
              className="min-h-11 rounded-xl border border-border bg-canvas/50 text-xs font-bold text-content-secondary transition-colors hover:border-accent-hover hover:text-accent-hover"
            >
              4:5
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 text-content-muted">
          <Palette size={14} />
          <h3 className="text-xs font-semibold uppercase tracking-wider">Background</h3>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() =>
              onFillChange({
                type: 'solid',
                color: canvas.fill.type === 'solid' ? canvas.fill.color : '#ffffff',
              })
            }
            aria-pressed={canvas.fill.type === 'solid'}
            className={`min-h-11 rounded-xl border text-xs font-bold transition-colors ${canvas.fill.type === 'solid' ? 'border-accent-hover bg-accent/10 text-accent-hover' : 'border-border text-content-secondary hover:border-border-emphasis'}`}
          >
            Solid
          </button>
          <button
            type="button"
            onClick={() => onFillChange({ type: 'transparent' })}
            aria-pressed={canvas.fill.type === 'transparent'}
            className={`min-h-11 rounded-xl border text-xs font-bold transition-colors ${canvas.fill.type === 'transparent' ? 'border-accent-hover bg-accent/10 text-accent-hover' : 'border-border text-content-secondary hover:border-border-emphasis'}`}
          >
            Transparent
          </button>
        </div>
        {canvas.fill.type === 'solid' && (
          <ColorPicker
            value={canvas.fill.color}
            onChange={(color) => onFillChange({ type: 'solid', color })}
            ariaLabel="Canvas background color"
          />
        )}
        {canvas.fill.type === 'transparent' && (
          <p className="text-xs leading-relaxed text-content-subtle">
            PNG and WebP preserve transparency. JPEG exports transparent areas as white.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 text-content-muted">
          <Plus size={14} />
          <h3 className="text-xs font-semibold uppercase tracking-wider">Add space</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <span />
          <button
            type="button"
            onClick={() => onExpand('top')}
            className="min-h-11 rounded-xl border border-border text-xs font-bold text-content-secondary transition-colors hover:border-accent-hover hover:text-accent-hover"
          >
            Above
          </button>
          <span />
          <button
            type="button"
            onClick={() => onExpand('left')}
            className="min-h-11 rounded-xl border border-border text-xs font-bold text-content-secondary transition-colors hover:border-accent-hover hover:text-accent-hover"
          >
            Left
          </button>
          <span className="flex items-center justify-center text-[10px] font-bold uppercase text-content-subtle">
            Canvas
          </span>
          <button
            type="button"
            onClick={() => onExpand('right')}
            className="min-h-11 rounded-xl border border-border text-xs font-bold text-content-secondary transition-colors hover:border-accent-hover hover:text-accent-hover"
          >
            Right
          </button>
          <span />
          <button
            type="button"
            onClick={() => onExpand('bottom')}
            className="min-h-11 rounded-xl border border-border text-xs font-bold text-content-secondary transition-colors hover:border-accent-hover hover:text-accent-hover"
          >
            Below
          </button>
          <span />
        </div>
      </section>
    </div>
  ),
);

// --- Sub-component for individual text nodes ---

interface TextElementItemProps {
  data: TextElement;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, attrs: ItemPatch<TextElement>) => void;
  tool: EditorTool;
}

const TextElementItem = memo(
  ({ data, isSelected, onSelect, onChange, tool }: TextElementItemProps) => {
    const shapeRef = useRef<Konva.Text | null>(null);
    const trRef = useRef<Konva.Transformer | null>(null);
    const axisLockedDragHandlers = useAxisLockedDrag();
    useSelectedTransformer(isSelected, shapeRef, trRef);

    return (
      <React.Fragment>
        <Text
          ref={shapeRef}
          {...data}
          fillAfterStrokeEnabled
          draggable={tool === 'select'}
          listening={tool === 'select'}
          onClick={() => onSelect(data.id)}
          onTap={() => onSelect(data.id)}
          {...axisLockedDragHandlers}
          onDragEnd={(event) => {
            const node = event.target as Konva.Text;
            onChange(data.id, {
              x: round2(node.x()),
              y: round2(node.y()),
            });
          }}
          onTransformEnd={() => {
            const node = shapeRef.current;
            if (!node) return;
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);
            onChange(data.id, {
              x: round2(node.x()),
              y: round2(node.y()),
              fontSize: round2(Math.max(5, node.fontSize() * scaleY)),
              width: round2(node.width() * scaleX),
              strokeWidth: round2(node.strokeWidth() * scaleY),
              rotation: round2(node.rotation()),
            });
          }}
        />
        {isSelected && (
          <Transformer
            ref={trRef}
            anchorSize={TRANSFORMER_ANCHOR_SIZE}
            boundBoxFunc={(_oldBox, newBox) => {
              newBox.width = Math.max(30, newBox.width);
              return newBox;
            }}
          />
        )}
      </React.Fragment>
    );
  },
);

const IMAGE_ACTION_ICON_BUTTON_CLASS =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-content hover:bg-surface-hover hover:text-content-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-colors disabled:cursor-not-allowed disabled:opacity-40';

interface ImageFlipButtonsProps {
  imageId: string;
  onFlip: (id: string, axis: TransformAxis) => void;
}

const ImageFlipButtons = memo(({ imageId, onFlip }: ImageFlipButtonsProps) => (
  <React.Fragment>
    <button
      type="button"
      onClick={() => onFlip(imageId, 'x')}
      className={IMAGE_ACTION_ICON_BUTTON_CLASS}
      aria-label="Flip image horizontally"
      title="Flip horizontal"
    >
      <FlipHorizontal2 size={18} />
    </button>
    <button
      type="button"
      onClick={() => onFlip(imageId, 'y')}
      className={IMAGE_ACTION_ICON_BUTTON_CLASS}
      aria-label="Flip image vertically"
      title="Flip vertical"
    >
      <FlipVertical2 size={18} />
    </button>
  </React.Fragment>
));

interface BackgroundRemovalButtonProps {
  image: Pick<ImageElement, 'id' | 'bgRemoved'>;
  backgroundRemovalState: BackgroundRemovalState;
  onRemoveBackground: (id: string) => void;
  onRestoreBackground: (id: string) => void;
}

const BackgroundRemovalButton = memo(
  ({
    image,
    backgroundRemovalState,
    onRemoveBackground,
    onRestoreBackground,
  }: BackgroundRemovalButtonProps) => {
    const targetsImage =
      'targetId' in backgroundRemovalState && backgroundRemovalState.targetId === image.id;
    const isDownloading = targetsImage && backgroundRemovalState.status === 'downloading';
    const isProcessing = targetsImage && backgroundRemovalState.status === 'processing';
    const isBusy =
      backgroundRemovalState.status === 'downloading' ||
      backgroundRemovalState.status === 'processing';
    const progress = isDownloading ? backgroundRemovalState.progress : 0;

    return (
      <button
        type="button"
        onClick={() =>
          image.bgRemoved ? onRestoreBackground(image.id) : onRemoveBackground(image.id)
        }
        disabled={!image.bgRemoved && isBusy}
        className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-semibold text-content-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={
          image.bgRemoved
            ? 'Restore image background'
            : isDownloading
              ? `Downloading background removal model, ${progress} percent`
              : isProcessing
                ? 'Removing image background'
                : 'Remove image background'
        }
        aria-busy={isDownloading || isProcessing}
        title={
          !image.bgRemoved && isBusy && !targetsImage
            ? 'Wait for the current background removal to finish'
            : undefined
        }
      >
        {isDownloading ? (
          <>
            <Loader2 size={17} className="animate-spin text-accent" /> Downloading {progress}%
          </>
        ) : isProcessing ? (
          <>
            <Loader2 size={17} className="animate-spin text-accent" /> Removing…
          </>
        ) : image.bgRemoved ? (
          <>
            <RotateCcw size={17} className="text-accent" /> Restore BG
          </>
        ) : (
          <>
            <Wand2 size={17} className="text-accent" /> Remove BG
          </>
        )}
      </button>
    );
  },
);

interface ImageContextualControlsProps extends BackgroundRemovalButtonProps {
  image: ImageElement;
  onFlip: (id: string, axis: TransformAxis) => void;
  onCrop: (id: string) => void;
  onDelete: (id: string) => void;
}

const ImageContextualControls = memo(
  ({
    image,
    backgroundRemovalState,
    onFlip,
    onCrop,
    onRemoveBackground,
    onRestoreBackground,
    onDelete,
  }: ImageContextualControlsProps) => {
    return (
      <div
        role="group"
        aria-label="Selected image actions"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        style={{ maxWidth: 'inherit' }}
        className="flex w-max flex-wrap items-center justify-center gap-1 rounded-2xl border border-border bg-background/95 p-1.5 text-content-strong shadow-2xl shadow-overlay/50 backdrop-blur-md"
      >
        <ImageFlipButtons imageId={image.id} onFlip={onFlip} />
        <button
          type="button"
          onClick={() => onCrop(image.id)}
          className={IMAGE_ACTION_ICON_BUTTON_CLASS}
          aria-label="Crop image"
          title="Crop image"
        >
          <CropIcon size={18} />
        </button>
        <div className="mx-0.5 h-7 w-px bg-surface-hover" aria-hidden="true" />
        <BackgroundRemovalButton
          image={image}
          backgroundRemovalState={backgroundRemovalState}
          onRemoveBackground={onRemoveBackground}
          onRestoreBackground={onRestoreBackground}
        />
        <div className="mx-0.5 h-7 w-px bg-surface-hover" aria-hidden="true" />
        <button
          type="button"
          onClick={() => onDelete(image.id)}
          className={`${IMAGE_ACTION_ICON_BUTTON_CLASS} text-danger hover:bg-danger-strong/15 hover:text-danger-hover`}
          aria-label="Delete image"
          title="Delete image"
        >
          <Trash2 size={18} />
        </button>
      </div>
    );
  },
);

interface ImageElementItemProps extends Omit<ImageContextualControlsProps, 'image' | 'onCrop'> {
  data: ImageElement;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, attrs: ItemPatch<ImageElement>) => void;
  tool: EditorTool;
  cropDraft: CropRect | null;
  onBeginCrop: (id: string) => void;
  onCropDraftChange: (crop: CropRect) => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
  onResetCrop: () => void;
}

const ImageElementItem = memo(
  ({
    data,
    isSelected,
    onSelect,
    onChange,
    tool,
    onFlip,
    onRemoveBackground,
    onRestoreBackground,
    onDelete,
    backgroundRemovalState,
    cropDraft,
    onBeginCrop,
    onCropDraftChange,
    onApplyCrop,
    onCancelCrop,
    onResetCrop,
  }: ImageElementItemProps) => {
    const shapeRef = useRef<Konva.Image | null>(null);
    const trRef = useRef<Konva.Transformer | null>(null);
    const fullImageRef = useRef<Konva.Image | null>(null);
    const cropFrameRef = useRef<Konva.Rect | null>(null);
    const cropTransformerRef = useRef<Konva.Transformer | null>(null);
    const htmlDivRef = useRef<HTMLDivElement | null>(null);
    const themeColors = getEditorThemeColors();
    const imageNodeData = getImageNodeData(data);
    const crop = data.crop;
    const sourceSize = useMemo(() => getImageSourceSize(data.image), [data.image]);
    const fullCrop = getFullCrop(sourceSize);
    const fullPreview = cropDraft ? applyImageCrop(data, fullCrop) : null;
    const draftPreview = cropDraft ? applyImageCrop(data, cropDraft) : null;

    const updateHtmlPos = useCallback(() => {
      const node = shapeRef.current;
      const toolbar = htmlDivRef.current;
      const stage = node?.getStage();
      if (!node || !toolbar || !stage) return;

      const bounds = node.getClientRect({ relativeTo: stage });
      const edgePadding = 8;
      const toolbarWidth = Math.min(
        toolbar.offsetWidth,
        Math.max(stage.width() - edgePadding * 2, 0),
      );
      const centerX = bounds.x + bounds.width / 2;
      const x =
        toolbarWidth + edgePadding * 2 >= stage.width()
          ? stage.width() / 2
          : Math.min(
              stage.width() - toolbarWidth / 2 - edgePadding,
              Math.max(toolbarWidth / 2 + edgePadding, centerX),
            );
      const placeBelow =
        bounds.y + bounds.height + toolbar.offsetHeight + 12 <= stage.height() ||
        bounds.y < toolbar.offsetHeight + 12;
      const y = placeBelow ? bounds.y + bounds.height + 12 : bounds.y - 12;

      toolbar.style.maxWidth = `${Math.max(stage.width() - edgePadding * 2, 0)}px`;
      toolbar.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${placeBelow ? '0' : '-100%'})`;
    }, []);

    const setHtmlDivRef = useCallback(
      (node: HTMLDivElement | null) => {
        htmlDivRef.current = node;
        if (node) updateHtmlPos();
      },
      [updateHtmlPos],
    );

    useSelectedTransformer(isSelected && !cropDraft, shapeRef, trRef, updateHtmlPos);
    useSelectedTransformer(Boolean(cropDraft), cropFrameRef, cropTransformerRef, updateHtmlPos);

    useEffect(() => {
      if (isSelected) updateHtmlPos();
    }, [
      backgroundRemovalState,
      cropDraft,
      data.x,
      data.y,
      data.width,
      data.height,
      data.scaleX,
      data.scaleY,
      data.rotation,
      isSelected,
      updateHtmlPos,
    ]);

    const axisLockedDragHandlers = useAxisLockedDrag(updateHtmlPos);

    const commitCropFrame = useCallback(() => {
      const fullImage = fullImageRef.current;
      const frame = cropFrameRef.current;
      if (!fullImage || !frame) return;

      const inverseFullTransform = fullImage.getAbsoluteTransform().copy().invert();
      const frameTransform = frame.getAbsoluteTransform();
      const frameCorners = [
        { x: 0, y: 0 },
        { x: frame.width(), y: 0 },
        { x: 0, y: frame.height() },
        { x: frame.width(), y: frame.height() },
      ].map((point) => inverseFullTransform.point(frameTransform.point(point)));
      const localLeft = Math.min(...frameCorners.map((point) => point.x));
      const localTop = Math.min(...frameCorners.map((point) => point.y));
      const localRight = Math.max(...frameCorners.map((point) => point.x));
      const localBottom = Math.max(...frameCorners.map((point) => point.y));
      const sourcePerLocalX = sourceSize.width / fullImage.width();
      const sourcePerLocalY = sourceSize.height / fullImage.height();

      onCropDraftChange(
        clampCropRect(
          {
            x: localLeft * sourcePerLocalX,
            y: localTop * sourcePerLocalY,
            width: (localRight - localLeft) * sourcePerLocalX,
            height: (localBottom - localTop) * sourcePerLocalY,
          },
          sourceSize,
        ),
      );
    }, [onCropDraftChange, sourceSize]);

    return (
      <React.Fragment>
        {cropDraft && fullPreview && draftPreview ? (
          <React.Fragment>
            <KonvaImage
              ref={fullImageRef}
              {...imageNodeData}
              x={fullPreview.x}
              y={fullPreview.y}
              width={fullPreview.width}
              height={fullPreview.height}
              cropX={fullCrop.x}
              cropY={fullCrop.y}
              cropWidth={fullCrop.width}
              cropHeight={fullCrop.height}
              opacity={0.35}
              listening={false}
            />
            <KonvaImage
              ref={shapeRef}
              {...imageNodeData}
              x={draftPreview.x}
              y={draftPreview.y}
              width={draftPreview.width}
              height={draftPreview.height}
              cropX={cropDraft.x}
              cropY={cropDraft.y}
              cropWidth={cropDraft.width}
              cropHeight={cropDraft.height}
              listening={false}
            />
            <Rect
              ref={cropFrameRef}
              x={draftPreview.x}
              y={draftPreview.y}
              width={draftPreview.width}
              height={draftPreview.height}
              scaleX={draftPreview.scaleX}
              scaleY={draftPreview.scaleY}
              rotation={draftPreview.rotation}
              fill="rgba(255,255,255,0.001)"
              stroke={themeColors.accent}
              strokeWidth={2}
              draggable
              onDragMove={commitCropFrame}
              onDragEnd={commitCropFrame}
              onTransform={updateHtmlPos}
              onTransformEnd={commitCropFrame}
            />
            <Transformer
              ref={cropTransformerRef}
              anchorSize={TRANSFORMER_ANCHOR_SIZE}
              rotateEnabled={false}
              flipEnabled={false}
              keepRatio={false}
              borderStroke={themeColors.accent}
              anchorStroke={themeColors.onAccent}
              anchorFill={themeColors.accent}
              boundBoxFunc={(previousBox, nextBox) =>
                Math.abs(nextBox.width) < 12 || Math.abs(nextBox.height) < 12
                  ? previousBox
                  : nextBox
              }
            />
          </React.Fragment>
        ) : (
          <KonvaImage
            ref={shapeRef}
            {...imageNodeData}
            cropX={crop.x}
            cropY={crop.y}
            cropWidth={crop.width}
            cropHeight={crop.height}
            draggable={tool === 'select'}
            listening={tool === 'select'}
            onClick={() => onSelect(data.id)}
            onTap={() => onSelect(data.id)}
            {...axisLockedDragHandlers}
            onTransform={updateHtmlPos}
            onDragEnd={(event) => {
              const node = event.target as Konva.Image;
              onChange(data.id, { x: round2(node.x()), y: round2(node.y()) });
            }}
            onTransformEnd={() => {
              const node = shapeRef.current;
              if (!node) return;
              onChange(data.id, {
                x: round2(node.x()),
                y: round2(node.y()),
                scaleX: round2(node.scaleX()),
                scaleY: round2(node.scaleY()),
                rotation: round2(node.rotation()),
              });
            }}
          />
        )}
        {isSelected && !cropDraft && (
          <Transformer
            ref={trRef}
            anchorSize={TRANSFORMER_ANCHOR_SIZE}
            flipEnabled
            boundBoxFunc={constrainImageTransform}
          />
        )}
        {isSelected && tool === 'select' && (
          <Html>
            <div
              ref={setHtmlDivRef}
              style={{ position: 'absolute', top: 0, left: 0, transformOrigin: 'top left' }}
              className="flex items-center justify-center leading-normal"
            >
              {cropDraft ? (
                <CropControlBar
                  ariaLabel="Image crop controls"
                  label={`${Math.round(cropDraft.width)} × ${Math.round(cropDraft.height)}`}
                  onApply={onApplyCrop}
                  onCancel={onCancelCrop}
                  onReset={onResetCrop}
                />
              ) : (
                <ImageContextualControls
                  image={data}
                  backgroundRemovalState={backgroundRemovalState}
                  onFlip={onFlip}
                  onCrop={onBeginCrop}
                  onRemoveBackground={onRemoveBackground}
                  onRestoreBackground={onRestoreBackground}
                  onDelete={onDelete}
                />
              )}
            </div>
          </Html>
        )}
      </React.Fragment>
    );
  },
);

export default App;
