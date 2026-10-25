// Synthetic resolver documents for claim 8, in the W3C structured shapes ({ colorSpace, components }, { value, unit }).
// Each document lists the consumers the check reads: a token, and what the consumer spells it as.
// Every modifier is spelled as an attribute selector, `[data-<modifier>='<context>']`.

export const srgb = (r, g, b) => ({ colorSpace: 'srgb', components: [r / 255, g / 255, b / 255] });
export const px = (value) => ({ value, unit: 'px' });

const selector = (modifier) => ({ 'com.toghen': { css: { selector: `[data-${modifier}='{context}']` } } });

/** A modifier: its default first, the other contexts after it, each with the tokens it overrides. */
const modifier = (name, def, contexts) => ({
  default: def,
  contexts: Object.fromEntries(Object.entries(contexts).map(([c, tokens]) => [c, tokens ? [tokens] : []])),
  $extensions: selector(name),
});

const document = (sources, modifiers) => ({
  version: '2025-11-01',
  name: 'ds',
  sets: { base: { sources: [sources] } },
  modifiers,
  resolutionOrder: [{ $ref: '#/sets/base' }, ...Object.keys(modifiers).map((m) => ({ $ref: `#/modifiers/${m}` }))],
});

const color = (value) => ({ $type: 'color', $value: value });
const dimension = (value) => ({ $type: 'dimension', $value: value });

export const docs = {
  // The measured two-axis case. `alert` is fixed under one modifier and a reference to a token the other varies
  // otherwise (one link, a base that is a reference); `copy` is a pure alias of it (no link, depends through).
  twoAxes: {
    document: document(
      { tone: { base: color(srgb(17, 17, 17)), alert: color('{tone.base}'), copy: color('{tone.alert}') } },
      {
        scheme: modifier('scheme', 'light', { light: null, dark: { tone: { alert: { $value: srgb(170, 0, 0) } } } }),
        contrast: modifier('contrast', 'normal', { normal: null, high: { tone: { base: { $value: srgb(34, 34, 34) } } } }),
      },
    ),
    consumers: [
      { path: 'tone.base', kind: 'color' },
      { path: 'tone.alert', kind: 'color' },
      { path: 'tone.copy', kind: 'color' },
    ],
  },

  // Two literal links and a base, with sparse contexts (`light` and `neutral` define nothing), for a colour and a dimension.
  twoLinks: {
    document: document(
      { button: { bg: color(srgb(230, 230, 230)), pad: dimension(px(8)) } },
      {
        scheme: modifier('scheme', 'light', {
          light: null,
          dark: { button: { bg: { $value: srgb(51, 51, 51) }, pad: { $value: px(12) } } },
        }),
        tone: modifier('tone', 'neutral', {
          neutral: null,
          primary: { button: { bg: { $value: srgb(26, 102, 230) }, pad: { $value: px(16) } } },
        }),
      },
    ),
    consumers: [
      { path: 'button.bg', kind: 'color' },
      { path: 'button.pad', kind: 'length' },
    ],
  },

  // The conditional reference: `t` is `{y}` under `scheme=dark` and a literal otherwise; `y` varies on `contrast`.
  conditional: {
    document: document(
      { tone: { y: color(srgb(17, 17, 17)), t: color(srgb(170, 170, 170)) } },
      {
        scheme: modifier('scheme', 'light', { light: null, dark: { tone: { t: { $value: '{tone.y}' } } } }),
        contrast: modifier('contrast', 'normal', { normal: null, high: { tone: { y: { $value: srgb(34, 34, 34) } } } }),
      },
    ),
    consumers: [
      { path: 'tone.y', kind: 'color' },
      { path: 'tone.t', kind: 'color' },
    ],
  },

  // The same, with the reference under the modifier's *default* context and a literal under the other:
  // the link has a defined step where nothing sets the modifier.
  conditionalDefault: {
    document: document(
      { tone: { y: color(srgb(17, 17, 17)), t: color(srgb(170, 170, 170)) } },
      {
        scheme: modifier('scheme', 'light', {
          light: { tone: { t: { $value: '{tone.y}' } } },
          dark: { tone: { t: { $value: srgb(0, 170, 0) } } },
        }),
        contrast: modifier('contrast', 'normal', { normal: null, high: { tone: { y: { $value: srgb(34, 34, 34) } } } }),
      },
    ),
    consumers: [
      { path: 'tone.y', kind: 'color' },
      { path: 'tone.t', kind: 'color' },
    ],
  },

  // A hole: `x` is defined only under `scheme=dark` and under `tone=primary`, and by no set, so
  // scheme=light with tone=neutral has no value. Its consumers carry their own fallback.
  hole: {
    document: document(
      { tone: { a: color(srgb(17, 17, 17)) } },
      {
        scheme: modifier('scheme', 'light', { light: null, dark: { tone: { x: color(srgb(170, 0, 0)) } } }),
        tone: modifier('tone', 'neutral', { neutral: null, primary: { tone: { x: color(srgb(0, 0, 170)) } } }),
      },
    ),
    consumers: [
      { path: 'tone.a', kind: 'color' },
      { path: 'tone.x', kind: 'color', fallback: '#123456', plain: true },
    ],
  },

  // Three modifiers: a token with a link in each, a conditional link on one that follows a token another modifier varies,
  // a pure alias, and a token whose single link follows a token that depends on all three.
  threeModifiers: {
    document: document(
      {
        c: {
          base: color(srgb(17, 17, 17)),
          line: color(srgb(204, 204, 204)),
          fill: color('{c.line}'),
          mark: color(srgb(0, 170, 0)),
          edge: color(srgb(238, 238, 238)),
        },
      },
      {
        scheme: modifier('scheme', 'light', {
          light: null,
          dark: { c: { line: { $value: srgb(51, 51, 51) }, mark: { $value: srgb(0, 187, 0) } } },
        }),
        contrast: modifier('contrast', 'normal', {
          normal: null,
          high: { c: { base: { $value: srgb(34, 34, 34) }, mark: { $value: srgb(0, 204, 0) }, edge: { $value: '{c.line}' } } },
        }),
        density: modifier('density', 'regular', {
          regular: null,
          compact: { c: { line: { $value: '{c.base}' }, mark: { $value: srgb(0, 221, 0) } } },
        }),
      },
    ),
    consumers: ['base', 'line', 'fill', 'mark', 'edge'].map((t) => ({ path: `c.${t}`, kind: 'color' })),
  },
};
