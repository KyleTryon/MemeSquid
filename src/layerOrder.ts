export type LayerOrderAction = 'front' | 'forward' | 'backward' | 'back';

interface OrderedLayer {
  id: string;
  type: string;
  zIndex?: number;
}

/** Sorts layers bottom to top. Ties keep their input order. */
export const sortLayers = <T extends { zIndex?: number }>(layers: readonly T[]): T[] =>
  [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

export const getTopZIndex = (layers: readonly { zIndex?: number }[]): number =>
  Math.max(0, ...layers.map((layer) => layer.zIndex ?? 0));

// Consecutive drawing strokes act as one layer so a drawing can be stepped past in one move.
const groupLayerUnits = (sorted: readonly OrderedLayer[], targetId: string): OrderedLayer[][] => {
  const units: OrderedLayer[][] = [];
  for (const layer of sorted) {
    const previous = units.at(-1);
    const canJoinPrevious =
      layer.type === 'line' &&
      layer.id !== targetId &&
      previous?.[0].type === 'line' &&
      previous[0].id !== targetId;
    if (canJoinPrevious) previous.push(layer);
    else units.push([layer]);
  }
  return units;
};

export const getLayerOrderAvailability = (
  layers: readonly OrderedLayer[],
  id: string,
): { canMoveUp: boolean; canMoveDown: boolean } => {
  const sorted = sortLayers(layers);
  const index = sorted.findIndex((layer) => layer.id === id);
  return {
    canMoveUp: index !== -1 && index < sorted.length - 1,
    canMoveDown: index > 0,
  };
};

/**
 * Moves one layer and returns new sequential z-indexes for every layer,
 * or null when the layer is missing or already in place.
 */
export const reorderLayer = (
  layers: readonly OrderedLayer[],
  id: string,
  action: LayerOrderAction,
): Map<string, number> | null => {
  const units = groupLayerUnits(sortLayers(layers), id);
  const index = units.findIndex((unit) => unit[0].id === id);
  if (index === -1) return null;

  const nextIndex = {
    front: units.length - 1,
    forward: Math.min(index + 1, units.length - 1),
    backward: Math.max(index - 1, 0),
    back: 0,
  }[action];
  if (nextIndex === index) return null;

  const [target] = units.splice(index, 1);
  units.splice(nextIndex, 0, target);
  return new Map(units.flat().map((layer, order) => [layer.id, order + 1]));
};

export const applyZIndexes = <T extends { id: string; zIndex?: number }>(
  items: T[],
  zIndexes: ReadonlyMap<string, number>,
): T[] => {
  let changed = false;
  const next = items.map((item) => {
    const zIndex = zIndexes.get(item.id);
    if (zIndex === undefined || zIndex === item.zIndex) return item;
    changed = true;
    return { ...item, zIndex };
  });
  return changed ? next : items;
};
