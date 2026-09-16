import { z } from 'zod';
import type { TextElement } from './types';

export const TEXT_ELEMENT_CLIPBOARD_TYPE = 'application/x-memesquid-text+json';

// Validate clipboard input against the existing editor type before creating a layer.
const textElementSchema: z.ZodType<TextElement> = z.strictObject({
  id: z.string(),
  type: z.literal('text'),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  fontSize: z.number(),
  fill: z.string(),
  stroke: z.string(),
  strokeWidth: z.number(),
  fontFamily: z.string(),
  fontWeight: z.enum(['normal', 'bold']),
  allCaps: z.boolean(),
  align: z.string(),
  width: z.number().optional(),
  rotation: z.number().optional(),
  shadowColor: z.string().optional(),
  shadowBlur: z.number().optional(),
  shadowOffsetX: z.number().optional(),
  shadowOffsetY: z.number().optional(),
  shadowOpacity: z.number().optional(),
  zIndex: z.number().optional(),
});

export const copyTextElement = (
  clipboard: Pick<DataTransfer, 'setData'>,
  text: TextElement,
): void => {
  clipboard.setData(TEXT_ELEMENT_CLIPBOARD_TYPE, JSON.stringify(text));
  clipboard.setData('text/plain', text.allCaps ? text.text.toUpperCase() : text.text);
};

export const readCopiedTextElement = (serialized: string): TextElement | null => {
  try {
    const result = textElementSchema.safeParse(JSON.parse(serialized));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

export const createPastedTextElement = (
  source: TextElement,
  offset: number,
  zIndex: number,
): TextElement => ({
  ...source,
  id: `text-${crypto.randomUUID()}`,
  x: source.x + offset,
  y: source.y + offset,
  zIndex,
});
