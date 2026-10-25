/**
 * The running example of the docs, run through the real pipeline, every output kept as a golden file.
 *
 * `@toghen/lib/example/` is the example as a reader writes it: a resolver document and its token files, read by `load()`.
 * Each snippet a doc shows lives under `test/example-output/`, one file per snippet: `<name>.in.css` is what the
 * reader writes, `<name>.out.css` what the tools write. A doc pastes from these files and writes no output by
 * hand, so a change of behaviour fails here first. `UPDATE_EXAMPLE=1 pnpm test` rewrites the files; read the diff.
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import postcssMixins from '@csstools/postcss-mixins';
import { load, Resolver, type ResolverDocument } from '@toghen/lib';
import toghenPlugin, { type ToghenPluginOptions } from '../src/index.js';

const EXAMPLE = `${dirname(fileURLToPath(import.meta.resolve('@toghen/lib/example/ds.resolver.json')))}/`;
const OUTPUT = fileURLToPath(new URL('./example-output/', import.meta.url));
const UPDATE = process.env.UPDATE_EXAMPLE === '1';

/** The options every snippet runs with unless it says otherwise: none, the defaults. */
const BASE: Partial<ToghenPluginOptions> = {};

const read = (file: string) => readFile(file, 'utf8');
const loadExample = async (file = 'ds.resolver.json') => (await load(`${EXAMPLE}${file}`, { read })).document;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The source of the document that holds a top-level group. */
const sourceOf = (document: ResolverDocument, group: string) =>
  (document.sets!.base.sources as Record<string, any>[]).find((source) => group in source)!;

// ---- the golden files ----

const written = new Set<string>();

/** Compares a file under `example-output/` with `text`, or rewrites it. */
function golden(name: string, text: string): void {
  written.add(name);
  const file = `${OUTPUT}${name}`;
  const body = `${text.replace(/\s+$/, '')}\n`;
  if (UPDATE) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    return;
  }
  assert.ok(existsSync(file), `${name} does not exist; run with UPDATE_EXAMPLE=1`);
  assert.equal(readFileSync(file, 'utf8'), body, `${name} differs from what the pipeline writes now`);
}

// ---- the pipeline ----

/** Toghen on its own. Warnings are the messages the plugin reports, in order. */
async function toghen(input: string, options: Partial<ToghenPluginOptions> = {}, document?: ResolverDocument) {
  const system = new Resolver(document ?? (await loadExample())).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn', ...BASE, ...options })]).process(input, { from: undefined });
  return { css: result.css, warnings: result.warnings().map((warning) => warning.text) };
}

/**
 * The mixins polyfill's output with its whitespace made regular: it indents nested rules unevenly, which says
 * nothing about the CSS.
 */
function tidy(css: string): string {
  const root = postcss.parse(css);
  root.walk((node) => void (node.raws = {}));
  root.raws = {};
  return root.toString().replace(/\n\s*\n/g, '\n');
}

/** Toghen, then `@csstools/postcss-mixins`: one pipeline, as a build lists them. `written` is what Toghen alone writes. */
async function expanded(input: string, options: Partial<ToghenPluginOptions> = {}, document?: ResolverDocument) {
  const system = new Resolver(document ?? (await loadExample())).resolveContextsToDesignSystem();
  const result = await postcss([toghenPlugin({ system, onUnresolved: 'warn', ...BASE, ...options }), postcssMixins()]).process(input, {
    from: undefined,
  });
  const first = await toghen(input, options, document);
  return { css: tidy(result.css), written: first.css, warnings: result.warnings().map((warning) => warning.text) };
}

/** An input and its output as goldens; a message, if there is one, in a third file, so the output stays pure. */
function pair(name: string, input: string, result: { css: string; warnings: string[] }, expectWarnings = false): void {
  golden(`${name}.in.css`, input);
  golden(`${name}.out.css`, result.css);
  if (expectWarnings) golden(`${name}.messages.txt`, result.warnings.join('\n'));
  else assert.deepEqual(result.warnings, [], `${name} reported`);
}

/** The mixins of that name, as the plugin wrote them. */
function mixins(css: string, ...names: string[]): string {
  return postcss
    .parse(css)
    .nodes.filter((node) => node.type === 'atrule' && node.name === 'mixin' && names.includes(node.params))
    .map((node) => node.toString())
    .join('\n');
}
const mixinNames = (css: string) =>
  [...postcss.parse(css).nodes].flatMap((node) => (node.type === 'atrule' && node.name === 'mixin' ? [node.params] : []));

/** The top-level rules whose selector starts with one of `selectors`. */
function rules(css: string, ...selectors: string[]): string {
  return postcss
    .parse(css)
    .nodes.filter((node) => node.type === 'rule' && selectors.some((selector) => node.selector.startsWith(selector)))
    .map((node) => node.toString())
    .join('\n');
}

// ---- the snippets ----

const CONTEXTS = `@layer tokens {
    @toghen contexts;
}`;
const MIXINS = '@toghen mixins;';
const TUTORIAL = `${CONTEXTS}

${MIXINS}

.button {
    display: inline-flex;
    @apply --button;
}

.button-icon {
    @apply --button-icon;
}
`;
const PAGE = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Buttons</title>
    <link rel="stylesheet" href="app.css">
</head>
<body>
    <button class="button"><span class="button-icon">★</span> Save</button>
    <button class="button" data-variant="primary">Save</button>
    <button class="button" aria-pressed="true">Save</button>
    <button class="button" disabled>Save</button>

    <section data-theme="dark">
        <button class="button"><span class="button-icon">★</span> Save</button>
        <button class="button" data-variant="primary">Save</button>
        <button class="button" aria-pressed="true">Save</button>
        <button class="button" disabled>Save</button>
    </section>
</body>
</html>
`;

describe('the running example', () => {
  after(() => {
    const stray = readdirSync(OUTPUT, { recursive: true })
      .map(String)
      .filter((file) => statSync(`${OUTPUT}${file}`).isFile() && !written.has(file));
    if (UPDATE) for (const file of stray) rmSync(`${OUTPUT}${file}`);
    else assert.deepEqual(stray, [], 'files in example-output/ that no test writes any more');
  });

  describe('the worlds and the mixins', () => {
    it('@toghen contexts, in an author layer', async () => {
      pair('contexts', CONTEXTS, await toghen(CONTEXTS));
    });

    it('@toghen mixins: the raw mixins', async () => {
      const result = await toghen(MIXINS);
      pair('mixins', MIXINS, result);
      assert.deepEqual(mixinNames(result.css), [
        '--type-label',
        '--button',
        '--button-font',
        '--button-icon',
        '--button-primary',
        '--button-hover',
        '--button-pressed',
        '--button-disabled',
        '--button-selected',
        '--button-selected-hover',
        '--field',
        '--field-focus',
        '--field-disabled',
        '--when-theme-light',
        '--when-theme-dark',
        '--when-density-regular',
        '--when-density-compact',
      ]);
    });

    it('a part mixin re-points the twin at rest; a part with no twin sets the property itself', async () => {
      const { css } = await toghen(MIXINS);
      golden(
        'mixins-button-parts.out.css',
        mixins(
          css,
          '--button-primary',
          '--button-hover',
          '--button-pressed',
          '--button-disabled',
          '--button-selected',
          '--button-selected-hover',
        ),
      );
      golden('mixins-field.out.css', mixins(css, '--field', '--field-focus', '--field-disabled'));
      golden(
        'mixins-when.out.css',
        mixins(css, '--when-theme-light', '--when-theme-dark', '--when-density-regular', '--when-density-compact'),
      );
    });

    it('registerProperties: true', async () => {
      const input = `@layer tokens {\n    @toghen contexts surface;\n}`;
      pair('register-properties', input, await toghen(input, { registerProperties: true }));
    });
  });

  describe('the tutorial', () => {
    it('the stylesheet, expanded, and the page that uses it', async () => {
      const result = await expanded(TUTORIAL);
      golden('tutorial.in.css', TUTORIAL);
      golden('tutorial.out.css', result.css);
      golden('tutorial.html', PAGE);
      assert.deepEqual(result.warnings, []);
      assert.doesNotMatch(result.css, /@mixin|@apply|@toghen/);
      // every class and attribute the page uses is one the stylesheet styles
      for (const used of [
        '.button',
        '.button-icon',
        "[data-variant='primary']",
        "[aria-pressed='true']",
        ":is(:disabled, [aria-disabled='true'])",
        "[data-theme='dark']",
      ]) {
        assert.ok(result.css.includes(used), `the stylesheet never mentions ${used}`);
      }
    });

    it('the button rules as the button gains parts: none, the hover part, all', async () => {
      const parts = ['primary', 'hover', 'pressed', 'disabled', 'selected'];
      const without = async (keep: string[]) => {
        const document = clone(await loadExample());
        const button = sourceOf(document, 'button').button;
        for (const part of parts) if (!keep.includes(part)) delete button[part];
        return rules((await expanded(TUTORIAL, {}, document)).css, '.button');
      };
      golden('tutorial-button-bare.out.css', await without([]));
      golden('tutorial-button-hover.out.css', await without(['hover']));
      golden('tutorial-button-all.out.css', await without(parts));
      assert.equal(await without(parts), rules((await expanded(TUTORIAL)).css, '.button'));
    });
  });

  describe('the tutorial, step by step', () => {
    const only = (css: string) =>
      postcss
        .parse(css)
        .nodes.filter((node) => node.type === 'rule' && node.selector === '.button')
        .map((node) => node.toString())
        .join('\n');
    const json = (file: string) => JSON.parse(readFileSync(`${EXAMPLE}tutorial/${file}`, 'utf8'));

    for (const step of ['start', 'hover'] as const) {
      it(`${step}: the worlds, the mixins and the button rule`, async () => {
        const document = await loadExample(`tutorial/${step}.resolver.json`);
        const contexts = await toghen(CONTEXTS, {}, document);
        const made = await toghen(MIXINS, {}, document);
        const result = await expanded(TUTORIAL, {}, document);
        assert.deepEqual([...contexts.warnings, ...made.warnings, ...result.warnings], []);
        golden(`tutorial/${step}/contexts.out.css`, contexts.css);
        golden(`tutorial/${step}/mixins.out.css`, made.css);
        golden(`tutorial/${step}/button.out.css`, only(result.css));
        assert.match(only(result.css), /^\.button \{\n {4}display: inline-flex;/);
      });
    }

    it('hover: what the reader adds, taken from the files', async () => {
      const vocabulary = json('vocabulary.hover.tokens.json');
      const token = json('button.hover.tokens.json').button.hover;
      golden('tutorial/hover/vocabulary.in.json', JSON.stringify(vocabulary, null, 2));
      golden('tutorial/hover/button-hover.in.json', JSON.stringify({ hover: token }, null, 2));
      const made = await toghen(MIXINS, {}, await loadExample('tutorial/hover.resolver.json'));
      golden('tutorial/hover/mixins-hover.out.css', mixins(made.css, '--button', '--button-hover'));
      // nothing of the other parts is there: only the state axis with hover, and the one token
      assert.deepEqual(Object.keys(token), ['backgroundColor']);
      assert.deepEqual(Object.keys(vocabulary.$extensions['com.toghen'].css.parts.state), ['hover']);
      assert.ok(!mixinNames(made.css).includes('--button-pressed'));
      // the start has neither a part mixin nor a nested rule
      const start = await toghen(MIXINS, {}, await loadExample('tutorial/start.resolver.json'));
      assert.ok(!start.css.includes('&:hover') && !mixinNames(start.css).some((name) => name.startsWith('--button-h')));
    });
  });

  describe('token files, and a theme by map', () => {
    const loadWarm = async () => {
      const overrides = JSON.parse(readFileSync(`${EXAMPLE}warm.overrides.json`, 'utf8')) as Record<string, string>;
      return (await load(`${EXAMPLE}ds.resolver.json`, { read, overrides })).document;
    };

    /** Each node as a line, a declaration's property after the selectors and at-rules that hold it; and each declaration's value by its line. */
    function shape(css: string) {
      const lines: string[] = [];
      const values = new Map<string, string>();
      postcss.parse(css).walk((node) => {
        const path: string[] = [];
        for (let parent: postcss.Node | undefined = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
          path.unshift(
            parent.type === 'rule'
              ? (parent as postcss.Rule).selector
              : `@${(parent as postcss.AtRule).name} ${(parent as postcss.AtRule).params}`,
          );
        }
        const where = path.join(' > ');
        if (node.type === 'decl') {
          lines.push(`${where} | ${node.prop}`);
          values.set(`${lines.length}: ${where} | ${node.prop}`, node.value);
        } else if (node.type === 'rule') lines.push(node.selector);
        else if (node.type === 'atrule') lines.push(`@${node.name} ${node.params}`);
      });
      return { lines, values };
    }

    it('the same document with warm.overrides.json moves the accent and what resolves through it, and nothing else', async () => {
      const cold = await toghen(TUTORIAL);
      const warm = await toghen(TUTORIAL, {}, await loadWarm());
      assert.deepEqual([...cold.warnings, ...warm.warnings], []);
      for (const css of [cold.css, warm.css]) assert.doesNotMatch(css, /object Object|toghen\(/);
      const a = shape(cold.css);
      const b = shape(warm.css);
      // every rule, mixin, selector and property is the same, in the same place
      assert.deepEqual(b.lines, a.lines);
      const moved = [...a.values].filter(([key, value]) => b.values.get(key) !== value);
      // where a value moved, the cold accent became the warm one, and only that
      for (const [key, value] of moved) assert.equal(b.values.get(key), value.replaceAll('#1a66e6', '#e6661a'), key);
      assert.deepEqual(
        moved.map(([key]) => key.replace(/^\d+: /, '')),
        [
          // the accent and the three tokens that refer to it, in the defaults and in the light theme
          ...['defaults > :root', "theme > [data-theme='light']"].flatMap((block) =>
            [
              '--surface-accent',
              '--button-primary-background-color',
              '--button-selected-hover-background-color',
              '--field-focus-outline-color',
            ].map((property) => `@layer tokens > @layer ${block} | ${property}`),
          ),
          // the fallbacks of the parts that read them
          "@mixin --button > &:where([data-variant='primary']) | --_button-background-color",
          "@mixin --button > &:where([aria-pressed='true']) > &:where(:hover) | --_button-background-color",
          '@mixin --button-primary | --_button-background-color',
          '@mixin --button-selected > &:where(:hover) | --_button-background-color',
          '@mixin --button-selected-hover | --_button-background-color',
          '@mixin --field-focus | outline-color',
        ],
      );
      // the dark accent comes from the dark file, which the map does not touch
      assert.ok(warm.css.includes('--surface-accent: #5c9bff'));
    });

    it('the tutorial step: the defaults and the button under the warm map', async () => {
      const { css } = await toghen(CONTEXTS, {}, await loadWarm());
      let defaults: postcss.AtRule | undefined;
      postcss.parse(css).walkAtRules('layer', (node) => void (node.params === 'defaults' && node.nodes && (defaults = node)));
      golden('tutorial/warm/contexts-defaults.out.css', tidy(postcss.root().append(defaults!.clone()).toString()));
      const button = (css: string) =>
        postcss
          .parse(css)
          .nodes.filter((node) => node.type === 'rule' && node.selector === '.button')
          .map((node) => node.toString())
          .join('\n');
      const warm = button((await expanded(TUTORIAL, {}, await loadWarm())).css);
      golden('tutorial/warm/button.out.css', warm);
      // step 8's rule, with the accent swapped
      const cold = button((await expanded(TUTORIAL)).css);
      assert.notEqual(warm, cold);
      assert.equal(warm.replaceAll('#e6661a', '#1a66e6'), cold);
    });

    it('a list of token files gives the CSS of the one-set resolver document over the same files', async () => {
      const files = ['vocabulary.tokens.json', 'roles.tokens.json', 'button.tokens.json', 'field.tokens.json'];
      const listed = (
        await load(
          files.map((file) => `${EXAMPLE}${file}`),
          { read },
        )
      ).document;
      const entry = `${EXAMPLE}one-set.resolver.json`;
      const oneSet = JSON.stringify({
        version: '2025-11-01',
        name: 'ds',
        sets: { base: { sources: files.map((file) => ({ $ref: file })) } },
        resolutionOrder: [{ $ref: '#/sets/base' }],
      });
      const written = (await load(entry, { read: (file) => (file === entry ? Promise.resolve(oneSet) : read(file)) })).document;
      assert.notEqual(listed.name, written.name);
      for (const input of [CONTEXTS, MIXINS]) {
        const fromFiles = await toghen(input, {}, listed);
        const fromDocument = await toghen(input, {}, written);
        assert.deepEqual([...fromFiles.warnings, ...fromDocument.warnings], []);
        assert.equal(fromFiles.css, fromDocument.css);
        assert.doesNotMatch(fromFiles.css, /object Object|toghen\(/);
      }
      // the defaults only: no modifier, so no context block and no --when- mixin
      const contexts = (await toghen(CONTEXTS, {}, listed)).css;
      const made = (await toghen(MIXINS, {}, listed)).css;
      assert.ok(!contexts.includes('[data-') && contexts.includes('--surface-accent: #1a66e6'));
      assert.ok(!mixinNames(made).some((name) => name.startsWith('--when-')) && mixinNames(made).includes('--button'));
    });
  });

  describe('reading one token', () => {
    const READS = `.label {
    color: t(text.default);
    background-color: t(surface.raised as value);
    border-color: t(surface.accent, theme=dark);
    font-size: t(type.label.fontSize);
}`;

    it('t(): the property with its fallback, as value, a mode, a member of a composite', async () => {
      pair('t-reads', READS, await toghen(READS));
    });

    it('the member of the typography token, under typography: block', async () => {
      golden('t-reads-typography-block.out.css', (await toghen(READS, { typography: 'block' })).css);
    });
  });

  describe('typography', () => {
    const LABEL = `.label {
    @apply --type-label;
}`;

    for (const typography of ['block', 'font'] as const) {
      it(`the --type-label mixin and what it expands to, under typography: '${typography}'`, async () => {
        const made = await toghen(MIXINS, { typography });
        golden(`typography-${typography}.mixin.out.css`, mixins(made.css, '--type-label'));
        const contexts = `@layer tokens {\n    @toghen contexts type;\n}`;
        pair(`typography-${typography}.declared`, contexts, await toghen(contexts, { typography }));
        const result = await expanded(`${MIXINS}\n${LABEL}`, { typography });
        golden(`typography-${typography}.in.css`, LABEL);
        golden(`typography-${typography}.out.css`, result.css);
      });
    }

    it("and the group that holds a typography token (`button.font`): its longhands under 'block', the font shorthand under 'font'", async () => {
      for (const typography of ['block', 'font'] as const) {
        const { css } = await toghen(MIXINS, { typography });
        golden(`typography-${typography}.button-mixin.out.css`, mixins(css, '--button'));
        assert.ok(mixinNames(css).includes('--button'), `a --button under '${typography}'`);
      }
    });
  });

  describe('a world, a child, a spelling', () => {
    it('--when-theme-dark applied with a block', async () => {
      const input = `.card {
    background-color: t(surface.raised);
    @apply --when-theme-dark {
        border: 1px solid t(surface.accent);
    }
}`;
      const result = await expanded(`${MIXINS}\n${input}`);
      golden('when-dark.in.css', input);
      golden('when-dark.out.css', result.css);
      assert.deepEqual(result.warnings, []);
    });

    it("field: the state that lives on a child, the field's own spelling, the part with no twin", async () => {
      const input = `.field {
    @apply --field;
}

.field:has(> input:focus-visible) {
    @apply --field-focus;
}`;
      const result = await expanded(`${MIXINS}\n${input}`);
      golden('field.in.css', input);
      golden('field.out.css', result.css);
      assert.deepEqual(result.warnings, []);
      // `disabled` is spelled on the field's own group; `focus` is no vocabulary entry, a plain child group
      assert.match(result.css, /&:where\(:has\(> input:disabled\)\) \{\n\s+opacity: var\(--field-disabled-opacity, 0\.5\)/);
    });
  });

  describe('references, declare, descriptions, chains', () => {
    it('references: var', async () => {
      const input = `:root {\n    @toghen declare ds.button.primary;\n}`;
      pair('references-resolve', input, await toghen(input));
      pair('references-var', input, await toghen(input, { references: 'var' }));
    });

    it('@toghen declare, one world, and from', async () => {
      const input = `.card {
    @toghen declare ds.space;
}

[data-density='compact'] .card {
    @toghen declare ds.space, density=compact;
}

[data-theme='dark'] .panel {
    @toghen declare ds.text, theme=light from theme=dark;
}`;
      pair('declare', input, await toghen(input));
    });

    it("descriptions: 'comment'", async () => {
      const input = `@layer tokens {\n    @toghen contexts surface;\n}`;
      pair('descriptions-comment', input, await toghen(input, { descriptions: 'comment' }));
    });

    it("bind: 'chain' on a token that two worlds change, and what it replaces", async () => {
      const input = `@layer tokens {\n    @toghen contexts surface.stripe;\n}`;
      const striped = await loadExample('ds-striped.resolver.json');
      pair('chain', input, await toghen(input, { bind: 'chain' }, striped));
      const plain = await toghen(input, {}, striped);
      pair('chain-none', input, plain, true);
      assert.match(plain.warnings[0], /changes under 'theme' and 'density'/);
    });
  });

  describe('messages', () => {
    it('every retired form once, and the cases a stylesheet can get wrong', async () => {
      const example = await loadExample();
      const system = new Resolver(example).resolveContextsToDesignSystem();
      const other = new Resolver({ ...clone(example), name: 'other' }).resolveContextsToDesignSystem();
      for (const name of other.getCollectionNames()) system.addCollection(other.getCollection(name)!);
      const twoCollections = new Resolver(example).resolveContextsToDesignSystem();
      for (const name of other.getCollectionNames()) twoCollections.addCollection(other.getCollection(name)!);

      const nested = clone(example);
      sourceOf(nested, 'button').button.hover.pressed = { backgroundColor: { $type: 'color', $value: '{surface.accent}' } };

      // [input, options, document, a note on what makes the case]
      type Case = [string, Partial<ToghenPluginOptions>?, ResolverDocument?, string?];
      const cases: Case[] = [
        ['.a:toghen(theme=dark) { x: 1; }'],
        ['.a:t(theme=dark) { x: 1; }'],
        ['@toghen base button;'],
        ['.a { @toghen mode theme=dark; }'],
        ["@toghen states via ':has(> input{state})';"],
        ['@toghen layer;'],
        ['.a { @toghen layer states; }'],
        ['.a { @toghen ds.button; }'],
        ['.a { @t text.default, theme=dark; }'],
        ['.a { x: t(surface.raised as var); }'],
        ['.a { x: t(button as longhands); }'],
        ['.a { x: t(button as shorthand); }'],
        ['.a { x: t(surface.raised as); }'],
        ['.a { x: t(surface.raised as rem); }'],
        ['@toghen contexts ds as value;'],
        ['.a { @toghen declare ds.space as value; }'],
        ['.a { x: t(text.default); }', { tokenLayer: 'tokens' } as never, undefined, "option tokenLayer: 'tokens'"],
        ['.a { x: t(text.default); }', { stateLayer: 'states' } as never, undefined, "option stateLayer: 'states'"],
        ['@layer tokens { @toghen mixins; }'],
        ['.a { @toghen mixins; }'],
        ['@toghen mixins ds.button;'],
        ['.a { x: t(.button.color); }'],
        ['.a { x: t(button.colour); }'],
        ['.a { x: t(nothing.color); }'],
        ['@toghen contexts nothing;'],
        ['.a { @toghen declare ds.nothing; }'],
        ['.a { @toghen declare nothing; }'],
        [MIXINS, {}, nested, 'a token at button.hover.pressed.backgroundColor: two values of the state axis nested'],
      ];
      const lines: string[] = [];
      for (const [input, options = {}, document, note] of cases) {
        const result = await toghen(input, options, document);
        assert.ok(result.warnings.length > 0, `no message for ${input}`);
        lines.push(
          note ? `${input}   (${note})` : input,
          ...(result.warnings.length > 0
            ? result.warnings.map((warning) => `    ${warning}`)
            : [`    (no message; the plugin writes: ${result.css.replace(/\s+/g, ' ')})`]),
          '',
        );
      }

      // a path without the collection segment, when the system has two collections
      const two = await postcss([toghenPlugin({ system: twoCollections, onUnresolved: 'warn', ...BASE })]).process(
        '.a { x: t(text.default); }',
        { from: undefined },
      );
      lines.push(
        '.a { x: t(text.default); }   (a system of two collections, ds and other)',
        ...two.warnings().map((warning) => `    ${warning.text}`),
        '',
      );

      // the polyfill, on a mixin nobody wrote
      const unknown = await expanded('.a {\n    @apply --nothing;\n}');
      lines.push(
        '.a { @apply --nothing; }   (after the mixins polyfill)',
        unknown.warnings.length > 0
          ? unknown.warnings.map((warning) => `    ${warning}`).join('\n')
          : `    (no message; the polyfill writes: ${unknown.css.replace(/\s+/g, ' ')})`,
        '',
      );

      golden('messages.txt', lines.join('\n'));
    });
  });
});
