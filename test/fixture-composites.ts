import postcss from 'postcss';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

// A synthetic system of components named by the properties they fill, and composites at keys that are,
// and are not, shorthand properties. Every value in the W3C structured shape.
export const px = (value: number) => ({ value, unit: 'px' });
export const rem = (value: number) => ({ value, unit: 'rem' });
export const srgb = (r: number, g: number, b: number) => ({ colorSpace: 'srgb', components: [r, g, b] });
export const ATTR = (name: string) => ({ $extensions: { 'com.toghen': { css: { selector: `[data-${name}='{context}']` } } } });

export const BLUE = srgb(0.1, 0.4, 0.9); // #1a66e6
export const DEEP = srgb(0.08, 0.31, 0.74); // #1450bd
export const NIGHT = srgb(0.1, 0.1, 0.1); // #1a1a1a

const text = (weight: number) => ({ fontFamily: ['Inter', 'sans-serif'], fontSize: rem(0.875), fontWeight: weight, lineHeight: 1.25 });
const line = (color: unknown) => ({ color, width: px(1), style: 'solid' });

export function doc(css: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            color: { $type: 'color', accent: { $value: BLUE }, strong: { $value: DEEP }, edge: { $value: srgb(0.8, 0.8, 0.8) } },
            card: {
              border: { $type: 'border', $value: line('{color.edge}') },
              borderTop: { $type: 'border', $value: line('{color.accent}') },
              edge: { $type: 'border', $value: line('{color.edge}') },
              boxShadow: { $type: 'shadow', $value: { color: srgb(0, 0, 0), offsetX: px(0), offsetY: px(4), blur: px(12), spread: px(0) } },
              transition: {
                $type: 'transition',
                $value: { duration: { value: 200, unit: 'ms' }, delay: { value: 0, unit: 'ms' }, timingFunction: [0.4, 0, 0.2, 1] },
              },
              pad: { $type: 'dimension', $value: px(16) },
              'border-width': { $type: 'dimension', $value: px(2) },
            },
            type: { body: { $type: 'typography', $value: text(400) } },
            ...extra,
          },
        ],
      },
    },
    modifiers: {
      theme: {
        default: 'light',
        contexts: {
          light: [],
          dark: [{ color: { accent: { $value: NIGHT }, edge: { $value: srgb(0.3, 0.3, 0.3) } }, type: { body: { $value: text(700) } } }],
        },
        ...ATTR('theme'),
        ...css,
      },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
  };
}

export const flat = (css: string) => css.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }').trim();

export async function run(input: string, options: Partial<ToghenPluginOptions> = {}, document: ResolverDocument = doc()) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'throw', ...options })]).process(input, { from: undefined });
  return { css: flat(result.css), warnings: result.warnings().map((w) => w.text) };
}
export const warned = (input: string, options: Partial<ToghenPluginOptions> = {}, document?: ResolverDocument) =>
  run(input, { onUnresolved: 'warn', ...options }, document);
