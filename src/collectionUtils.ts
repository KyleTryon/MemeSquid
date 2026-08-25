export interface IdentifiedItem {
  id: string;
}

export type ItemPatch<T extends IdentifiedItem> = Partial<Omit<T, 'id' | 'type'>>;

export const patchItemById = <T extends IdentifiedItem>(
  items: readonly T[],
  id: string,
  patch: ItemPatch<T>,
): T[] => items.map((item) => (item.id === id ? { ...item, ...patch } : item));

export const updateItemById = <T extends IdentifiedItem>(
  items: readonly T[],
  id: string,
  update: (item: T) => T,
): T[] => items.map((item) => (item.id === id ? update(item) : item));

export const removeItemById = <T extends IdentifiedItem>(items: readonly T[], id: string): T[] =>
  items.filter((item) => item.id !== id);
