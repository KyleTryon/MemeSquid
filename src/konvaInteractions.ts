import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type Konva from 'konva';

type DragEventHandler = (event: Konva.KonvaEventObject<DragEvent>) => void;

interface AxisLockedDragHandlers {
  onDragStart: DragEventHandler;
  onDragMove: DragEventHandler;
}

export const useAxisLockedDrag = (afterDragMove?: () => void): AxisLockedDragHandlers => {
  const dragStartPosition = useRef<{ x: number; y: number } | null>(null);
  const lockedAxis = useRef<'x' | 'y' | null>(null);

  const onDragStart = useCallback<DragEventHandler>((event) => {
    dragStartPosition.current = { x: event.target.x(), y: event.target.y() };
    lockedAxis.current = null;
  }, []);

  const onDragMove = useCallback<DragEventHandler>(
    (event) => {
      const startPosition = dragStartPosition.current;

      if (event.evt.shiftKey && startPosition) {
        if (!lockedAxis.current) {
          const deltaX = Math.abs(event.target.x() - startPosition.x);
          const deltaY = Math.abs(event.target.y() - startPosition.y);
          if (deltaX > deltaY) lockedAxis.current = 'x';
          if (deltaY > deltaX) lockedAxis.current = 'y';
        }

        if (lockedAxis.current === 'x') event.target.y(startPosition.y);
        if (lockedAxis.current === 'y') event.target.x(startPosition.x);
      } else {
        lockedAxis.current = null;
      }

      afterDragMove?.();
    },
    [afterDragMove],
  );

  return { onDragStart, onDragMove };
};

export const useSelectedTransformer = <TNode extends Konva.Node>(
  isSelected: boolean,
  nodeRef: RefObject<TNode | null>,
  transformerRef: RefObject<Konva.Transformer | null>,
  afterAttach?: () => void,
): void => {
  useEffect(() => {
    const node = nodeRef.current;
    const transformer = transformerRef.current;
    if (!isSelected || !node || !transformer) return;

    transformer.nodes([node]);
    transformer.getLayer()?.batchDraw();
    afterAttach?.();
  }, [afterAttach, isSelected, nodeRef, transformerRef]);
};
