import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import postcss, { type ChildNode, type Container } from 'postcss';
import postcssMixins from '@csstools/postcss-mixins';
import { Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin from '../src/index.js';

/*
 * A part re-points a custom property on its element, and custom properties inherit, so an instance nested in a part used
 * to inherit it. A component (the group above the first part of a part token) starts every token its parts re-point again
 * from its rest in its own mixin (`--_x: initial`); a child group's mixin resets only what its own parts re-point, so the pin
 * still receives the button's part by inheritance.
 * The cascade below is a small model of exactly that: inheritance of custom properties, specificity, order, `initial`.
 */

const px = (value: number) => ({ value, unit: 'px' });
const srgb = (r: number, g: number, b: number) => ({ colorSpace: 'srgb', components: [r, g, b] });
const color = (value: unknown) => ({ $type: 'color', $value: value });
const WHITE = srgb(1, 1, 1);
const BLUE = srgb(0, 0, 1);
const RED = srgb(1, 0, 0);
const BLACK = srgb(0, 0, 0);
const GREY = srgb(0.5, 0.5, 0.5);

const VOCABULARY = {
  variant: { primary: "[data-variant='primary']" },
  state: { hover: ':hover', pressed: ':active' },
};

function doc(extra: Record<string, unknown> = {}): ResolverDocument {
  return {
    version: '2025-11-01',
    name: 'ds',
    sets: {
      base: {
        sources: [
          {
            ui: {
              $extensions: { 'com.toghen': { css: { parts: VOCABULARY } } },
              card: {
                background: color(WHITE),
                paddingBlock: { $type: 'dimension', $value: px(8) },
                primary: { background: color(BLUE) },
                hover: { background: color(RED) },
              },
              button: {
                background: color(WHITE),
                pin: { color: color(BLACK) },
                pressed: { background: color(RED), pin: { color: color(WHITE) } },
              },
              ...extra,
            },
          },
        ],
      },
    },
    modifiers: {
      theme: {
        default: 'light',
        contexts: { light: [], dark: [{ ui: { card: { background: { $value: GREY } } } }] },
        $extensions: { 'com.toghen': { css: { selector: "[data-theme='{context}']" } } },
      },
    },
    resolutionOrder: [{ $ref: '#/sets/base' }, { $ref: '#/modifiers/theme' }],
  };
}

async function build(css: string, document = doc()) {
  const system = new Resolver(document).resolveContextsToDesignSystem();
  return (await postcss([toghenPlugin({ system }), postcssMixins()]).process(css, { from: undefined })).css;
}

const norm = (css: string) => css.replace(/\s+/g, ' ').replace(/;\s*}/g, ' }').trim();
function mixin(css: string, name: string): string | undefined {
  let found: string | undefined;
  postcss.parse(css).walkAtRules('mixin', (rule) => {
    if (rule.params === name)
      found = norm(rule.toString())
        .replace(/^@mixin \S+ \{ /, '')
        .replace(/ \}$/, '');
  });
  return found;
}

const SHEET = `@toghen contexts; @toghen mixins;
.card { @apply --ui-card; }
.button { @apply --ui-button; }
.pin { @apply --ui-button-pin; }`;

describe('a component starts every token its parts re-point again from its rest', () => {
  it("writes `--_x: initial` for each token a part re-points, its own and its child groups', before its declarations", async () => {
    const system = new Resolver(doc()).resolveContextsToDesignSystem();
    const out = (await postcss([toghenPlugin({ system })]).process('@toghen mixins;', { from: undefined })).css;
    assert.equal(
      mixin(out, '--ui-button'),
      '--_ui-button-background: initial; --_ui-button-pin-color: initial; background: var(--_ui-button-background, var(--ui-button-background, #ffffff)); @contents; ' +
        '&:where(:active) { --_ui-button-background: var(--ui-button-pressed-background, #ff0000); --_ui-button-pin-color: var(--ui-button-pressed-pin-color, #ffffff) }',
    );
    assert.equal(
      mixin(out, '--ui-card'),
      '--_ui-card-background: initial; background: var(--_ui-card-background, var(--ui-card-background, #ffffff)); padding-block: var(--ui-card-padding-block, 8px); @contents; ' +
        "&:where([data-variant='primary']) { --_ui-card-background: var(--ui-card-primary-background, #0000ff) } &:where(:hover) { --_ui-card-background: var(--ui-card-hover-background, #ff0000) }",
    );
  });

  it("writes no reset in a child group's mixin, which reads through the local property and falls back to its own", async () => {
    const system = new Resolver(doc()).resolveContextsToDesignSystem();
    const out = (await postcss([toghenPlugin({ system })]).process('@toghen mixins;', { from: undefined })).css;
    assert.equal(mixin(out, '--ui-button-pin'), 'color: var(--_ui-button-pin-color, var(--ui-button-pin-color, #000000)); @contents');
  });

  it('re-points the local property in a part, and leaves a token no part touches as it was', async () => {
    const system = new Resolver(doc()).resolveContextsToDesignSystem();
    const out = (await postcss([toghenPlugin({ system })]).process('@toghen mixins;', { from: undefined })).css;
    assert.equal(
      mixin(out, '--ui-button-pressed'),
      '--_ui-button-background: var(--ui-button-pressed-background, #ff0000); --_ui-button-pin-color: var(--ui-button-pressed-pin-color, #ffffff)',
    );
    // `padding-block` has no part: no reset, a plain read
    assert.match(mixin(out, '--ui-card')!, /padding-block: var\(--ui-card-padding-block, 8px\)/);
    assert.doesNotMatch(mixin(out, '--ui-card')!, /padding-block: initial/);
  });

  // Moved: the badge's reset was written in `card`; a token only the badge's own parts re-point is reset at the badge.
  it("resets a token only a child group's own parts re-point at that group, and none at the group above", async () => {
    const document = doc({
      card: {
        background: color(WHITE),
        hover: { background: color(RED) },
        badge: { background: color(BLUE), hover: { background: color(RED) } },
      },
    });
    const system = new Resolver(document).resolveContextsToDesignSystem();
    const out = (await postcss([toghenPlugin({ system })]).process('@toghen mixins;', { from: undefined })).css;
    assert.match(mixin(out, '--ui-card')!, /^--_ui-card-background: initial; background: /);
    assert.doesNotMatch(mixin(out, '--ui-card')!, /badge-background: initial/);
    assert.match(mixin(out, '--ui-card-badge')!, /^--_ui-card-badge-background: initial; background: var\(--_ui-card-badge-background, /);
  });

  it("resets a token that both a component's parts and a child group's own parts re-point at the component only", async () => {
    const document = doc({
      button: {
        background: color(WHITE),
        pin: { color: color(BLACK), hover: { color: color(RED) } },
        pressed: { background: color(RED), pin: { color: color(WHITE) } },
      },
    });
    const system = new Resolver(document).resolveContextsToDesignSystem();
    const out = (await postcss([toghenPlugin({ system })]).process('@toghen mixins;', { from: undefined })).css;
    assert.match(mixin(out, '--ui-button')!, /^--_ui-button-background: initial; --_ui-button-pin-color: initial; /);
    assert.doesNotMatch(mixin(out, '--ui-button-pin')!, /initial/);
  });

  it('resets in each component, and not in a namespace above them that holds a token keyed like a CSS property', async () => {
    // `ui.clear` is a CSS property, so `ui` has a mixin of its own; nothing applies it to a component's element
    const system = new Resolver(doc({ clear: { $type: 'string', $value: 'both' } })).resolveContextsToDesignSystem();
    const out = (await postcss([toghenPlugin({ system })]).process('@toghen mixins;', { from: undefined })).css;
    assert.ok(mixin(out, '--ui'), 'the namespace has a mixin');
    assert.doesNotMatch(mixin(out, '--ui')!, /initial/);
    assert.match(mixin(out, '--ui-button')!, /^--_ui-button-background: initial; --_ui-button-pin-color: initial; /);
    assert.match(mixin(out, '--ui-card')!, /^--_ui-card-background: initial; /);
  });

  it('reads a re-pointed token through t() as the mixins do', async () => {
    const system = new Resolver(doc()).resolveContextsToDesignSystem();
    const out = (
      await postcss([toghenPlugin({ system })]).process(
        '.x { background: t(ui.card.background); padding-block: t(ui.card.paddingBlock); }',
        { from: undefined },
      )
    ).css;
    assert.match(out, /background: var\(--_ui-card-background, var\(--ui-card-background, #ffffff\)\)/);
    assert.match(out, /padding-block: var\(--ui-card-padding-block, 8px\)/);
  });
});

// ---- a cascade: inheritance of custom properties, specificity, order, and `initial` ----

interface Element {
  cls: string;
  attrs?: Record<string, string>;
  hover?: boolean;
  pressed?: boolean;
  children?: Element[];
  id?: string;
}
interface Flat {
  selector: string;
  decls: [string, string][];
}

function flatten(css: string): Flat[] {
  const out: Flat[] = [];
  const visit = (container: Container, parent: string | undefined) => {
    for (const node of container.nodes as ChildNode[]) {
      if (node.type !== 'rule') continue;
      const selector =
        parent === undefined
          ? node.selector
          : node.selector.includes('&')
            ? node.selector.replaceAll('&', parent)
            : `${parent} ${node.selector}`;
      out.push({
        selector,
        decls: node.nodes
          .filter((n) => n.type === 'decl')
          .map((d) => [(d as any).prop, (d as any).value.replace(/\s+/g, ' ')] as [string, string]),
      });
      visit(node, selector);
    }
  };
  visit(postcss.parse(css), undefined);
  return out;
}

function evaluate(value: string, scope: Record<string, string>, depth = 0): string {
  if (depth > 20) throw new Error(`var() cycle in "${value}"`);
  const start = value.indexOf('var(');
  if (start < 0) return value;
  let level = 0;
  let comma = -1;
  let end = -1;
  for (let i = start + 3; i < value.length; i++) {
    if (value[i] === '(') level++;
    else if (value[i] === ')' && --level === 0) {
      end = i;
      break;
    } else if (value[i] === ',' && level === 1 && comma < 0) comma = i;
  }
  const name = value.slice(start + 4, comma < 0 ? end : comma).trim();
  const fallback = comma < 0 ? undefined : value.slice(comma + 1, end).trim();
  const used =
    scope[name] !== undefined
      ? evaluate(scope[name], scope, depth + 1)
      : fallback !== undefined
        ? evaluate(fallback, scope, depth + 1)
        : '';
  return evaluate(value.slice(0, start) + used + value.slice(end + 1), scope, depth + 1);
}

/**
 * Whether a selector made of `.class`, `[attr='v']`, `:hover` and `:active`, each alone or inside `:where()`, matches an
 * element; its specificity, or -1. A piece inside `:where()` weighs nothing.
 */
function specificity(selector: string, el: Element): number {
  if (!selector.startsWith('.')) return -1; // the worlds are `worldOf`'s
  const PIECE = /(?:\[[^\]]+\]|:hover|:active)/.source;
  const m = new RegExp(`^\\.([\\w-]+)((?:${PIECE}|:where\\(${PIECE}\\))*)$`).exec(selector);
  if (!m) throw new Error(`The selector "${selector}" is not one this test knows how to match.`);
  if (m[1] !== el.cls) return -1;
  let weight = 1;
  for (const written of m[2].match(new RegExp(`:where\\(${PIECE}\\)|${PIECE}`, 'g')) ?? []) {
    const piece = written.startsWith(':where(') ? written.slice(7, -1) : written;
    if (piece === written) weight++;
    const attr = /^\[([\w-]+)='([^']*)'\]$/.exec(piece);
    const ok = attr ? el.attrs?.[attr[1]] === attr[2] : piece === ':hover' ? el.hover : el.pressed;
    if (!ok) return -1;
  }
  return weight;
}

/** Every element's used value of `prop`, by id, with the custom properties inherited down the tree and `scope` at the root. */
function used(rules: Flat[], root: Element, world: Record<string, string>, prop: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (el: Element, inherited: Record<string, string>) => {
    const best = new Map<string, { weight: number; order: number; value: string }>();
    rules.forEach(({ selector, decls }, order) => {
      const weight = specificity(selector, el);
      if (weight < 0) return;
      for (const [p, value] of decls) {
        const held = best.get(p);
        if (!held || weight > held.weight || (weight === held.weight && order > held.order)) best.set(p, { weight, order, value });
      }
    });
    const scope = { ...inherited };
    for (const [p, { value }] of best)
      if (p.startsWith('--')) {
        if (value.trim() === 'initial') delete scope[p];
        else scope[p] = value;
      }
    const value = best.get(prop)?.value;
    if (el.id && value !== undefined) out[el.id] = evaluate(value, scope).trim();
    // a custom property inherits as the token stream its var()s resolved to on this element
    const resolved = Object.fromEntries(Object.entries(scope).map(([k, v]) => [k, evaluate(v, scope).trim()]));
    el.children?.forEach((child) => {
      walk(child, resolved);
    });
  };
  walk(root, world);
  return out;
}

function worldOf(rules: Flat[], theme = 'light'): Record<string, string> {
  const scope: Record<string, string> = {};
  for (const { selector, decls } of rules) {
    if (selector === ':root' || selector === `[data-theme='${theme}']`) for (const [p, v] of decls) scope[p] = v;
  }
  return scope;
}

describe('a nested instance renders its rest; a child element receives the part', () => {
  it('a plain card inside a primary card, inside a hovered one, renders the rest value', async () => {
    const rules = flatten(await build(SHEET));
    const tree: Element = {
      cls: 'card',
      id: 'outer',
      attrs: { 'data-variant': 'primary' },
      children: [{ cls: 'card', id: 'inner', children: [{ cls: 'card', id: 'deep', hover: true }] }],
    };
    assert.deepEqual(used(rules, tree, worldOf(rules), 'background'), { outer: '#0000ff', inner: '#ffffff', deep: '#ff0000' });
  });

  it('a pin inside a pressed button receives the part; a pin inside a plain button inside it receives the rest', async () => {
    const rules = flatten(await build(SHEET));
    const tree: Element = {
      cls: 'button',
      id: 'outer',
      pressed: true,
      children: [
        { cls: 'pin', id: 'pin' },
        { cls: 'button', id: 'inner', children: [{ cls: 'pin', id: 'innerPin' }] },
      ],
    };
    assert.deepEqual(used(rules, tree, worldOf(rules), 'color'), { pin: '#ffffff', innerPin: '#000000' });
    assert.deepEqual(used(rules, tree, worldOf(rules), 'background'), { outer: '#ff0000', inner: '#ffffff' });
  });

  it('a namespace token keyed like a CSS property changes neither: the nested card still renders its rest', async () => {
    const rules = flatten(await build(SHEET, doc({ clear: { $type: 'string', $value: 'both' } })));
    const tree: Element = { cls: 'card', id: 'outer', attrs: { 'data-variant': 'primary' }, children: [{ cls: 'card', id: 'inner' }] };
    assert.deepEqual(used(rules, tree, worldOf(rules), 'background'), { outer: '#0000ff', inner: '#ffffff' });
  });

  it('a pin with no button above it reads the token as the contexts declare it', async () => {
    const rules = flatten(await build(SHEET));
    assert.deepEqual(used(rules, { cls: 'pin', id: 'alone' }, worldOf(rules), 'color'), { alone: '#000000' });
  });

  it('a dark world reaches the rest and the parts alike', async () => {
    const rules = flatten(await build(SHEET));
    const dark = worldOf(rules, 'dark');
    assert.deepEqual(
      used(rules, { cls: 'card', id: 'a', children: [{ cls: 'card', id: 'b', attrs: { 'data-variant': 'primary' } }] }, dark, 'background'),
      { a: '#808080', b: '#0000ff' },
    );
  });
});

describe('@contents sits between the rest of a group and its parts', () => {
  it('lands a block given to @apply after the rest and before the parts, through the polyfill', async () => {
    const css = norm(await build('@toghen mixins; .card { @apply --ui-card { height: 40px; } }'));
    const at = (text: string) => css.indexOf(text);
    assert.ok(at('--_ui-card-background: initial') >= 0);
    assert.ok(at('padding-block: var(') < at('height: 40px'), 'after the rest');
    assert.ok(at('height: 40px') < at("&:where([data-variant='primary'])"), 'before the parts');
    assert.doesNotMatch(css, /@contents|@apply|@mixin/);
  });

  it('inserts nothing for @apply with no block, and leaves no @contents behind', async () => {
    const css = norm(await build('@toghen mixins; .card { @apply --ui-card; }'));
    assert.doesNotMatch(css, /@contents|@apply|@mixin/);
    assert.match(css, /^\.card \{ --_ui-card-background: initial;/);
  });

  it("writes none in a part's mixin, which has no place for a caller's block", async () => {
    const system = new Resolver(doc()).resolveContextsToDesignSystem();
    const out = (await postcss([toghenPlugin({ system })]).process('@toghen mixins;', { from: undefined })).css;
    assert.doesNotMatch(mixin(out, '--ui-card-primary')!, /@contents/);
    assert.doesNotMatch(mixin(out, '--ui-button-pressed')!, /@contents/);
    assert.match(mixin(out, '--ui-card')!, /@contents/);
  });
});
