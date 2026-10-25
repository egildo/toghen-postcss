import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { run, warned } from './fixture-composites.js';

const ACCENT = '#1a66e6';

describe('t(path as value)', () => {
  it('is the resolved literal, in any position', async () => {
    assert.equal((await run('.a { --c: t(ds.color.accent as value); }')).css, `.a { --c: ${ACCENT} }`);
    assert.equal((await run('@layer tokens { .a { --c: t(ds.color.accent as value); } }')).css, `@layer tokens { .a { --c: ${ACCENT} } }`);
  });

  it('keeps the mode of the call', async () => {
    assert.equal((await run('.a { x: t(ds.color.accent as value, theme=dark); }')).css, '.a { x: #1a1a1a }');
  });

  it('is what the property read falls back to, and a path with no as reads the property', async () => {
    assert.equal(
      (await run('.a { x: t(ds.card.pad); y: t(ds.card.pad, theme=dark); z: t(ds.card.pad as value); }')).css,
      '.a { x: var(--card-pad, 16px); y: 16px; z: 16px }',
    );
  });

  it('reads a member that has a property of its own, and writes the literal for one that has none', async () => {
    assert.equal(
      (await run('.a { x: t(ds.card.border.width); y: t(ds.card.boxShadow.blur); }')).css,
      '.a { x: var(--card-border-width, 1px); y: 12px }',
    );
  });
});

describe('the forms that retired', () => {
  it('refuses as var, as longhands and as shorthand, naming what replaces them, and leaves the call', async () => {
    const out = await warned('.a { x: t(ds.card.pad as var); y: t(ds.card.border as longhands); z: t(ds.card.border as shorthand); }');
    assert.equal(out.warnings.length, 3);
    assert.match(out.warnings[0], /"as var" is retired or unknown: t\(path\) already writes var\(--name, literal\)/);
    assert.match(out.warnings[1], /"as longhands" is retired or unknown: .*@apply and @toghen mixins/);
    assert.match(out.warnings[2], /"as shorthand" is retired or unknown/);
    assert.match(out.css, /x: t\(ds.card.pad as var\); y: t\(ds.card.border as longhands\)/);
  });

  it('refuses an unknown form, and an as with none', async () => {
    const unknown = await warned('.a { x: t(ds.card.pad as rem); }');
    assert.match(unknown.warnings[0], /Cannot read "ds.card.pad": "as rem" is retired or unknown: the only form is value/);
    const none = await warned('.a { x: t(ds.card.pad as); }');
    assert.match(none.warnings[0], /Cannot read "ds.card.pad": as takes a form/);
    await assert.rejects(run('.a { x: t(ds.card.pad as rem); }'), /"as rem" is retired or unknown/);
  });

  it('refuses a form on contexts, mixins and declare', async () => {
    for (const input of ['@toghen contexts ds as value;', '@toghen mixins ds as value;', '.a { @toghen declare ds.card as value; }']) {
      const out = await warned(input);
      assert.match(out.warnings[0], /take no form/, input);
    }
  });
});

describe('the directives that retired', () => {
  const cases: [string, RegExp][] = [
    ['.a { @toghen ds.button; }', /Cannot use "@toghen ds.button;?": it is retired: use @apply --button; with @toghen mixins/],
    [
      '.a { @t ds.card.pad, theme=dark; }',
      /Cannot use "@t ds.card.pad, theme=dark": it is retired: use t\(ds.card.pad, theme=dark\) in a declaration\./,
    ],
    ['.a { @t ds.type.body; }', /Cannot use "@t ds.type.body": it is retired: use @apply --type-body; with @toghen mixins/],
    ['@toghen base ds.card;', /Cannot use "@toghen base ds.card": it is retired: write the path in full/],
    ['.a { @toghen mode theme=dark; }', /it is retired: read a value in a context with t\(path, mode\)/],
    ["@toghen states via ':has(> input{state})';", /it is retired: a part is nested in the mixin of its group/],
    ['.a { @toghen layer; }', /it is retired: a part is nested in the rule that applies its group/],
  ];

  for (const [input, sentence] of cases) {
    it(`reports ${input} and leaves it where it is`, async () => {
      const out = await warned(input);
      assert.equal(out.warnings.length, 1);
      assert.match(out.warnings[0], sentence);
      assert.match(out.css, /@(?:toghen|t) /);
      await assert.rejects(run(input), /it is retired/);
    });
  }

  it('reports nothing under onUnresolved: ignore, and still leaves it', async () => {
    const out = await run('.a { @toghen ds.button; }', { onUnresolved: 'ignore' });
    assert.match(out.css, /@toghen ds.button/);
  });

  it('reports a :toghen() or :t() selector and leaves the rule as written', async () => {
    for (const selector of ['.a:t(theme=dark)', '.a:toghen(theme=dark) .b']) {
      const out = await warned(`${selector} { x: 1; }`);
      assert.equal(out.css, `${selector} { x: 1 }`);
      assert.equal(out.warnings.length, 1);
      assert.ok(
        out.warnings[0].startsWith(
          `[@toghen/postcss] Cannot use "${selector}": the :toghen() and :t() selectors are retired: write the rule for a context with @apply --when-<modifier>-<context>`,
        ),
        out.warnings[0],
      );
    }
    await assert.rejects(run('.a:t(theme=dark) { x: 1; }'), /selectors are retired/);
  });

  it('reports the options tokenLayer and stateLayer once per stylesheet, and ignores them', async () => {
    const out = await warned('.a { x: t(ds.card.pad); }', { tokenLayer: 'tokens', stateLayer: 'states' } as never);
    assert.equal(out.css, '.a { x: var(--card-pad, 16px) }');
    assert.deepEqual(out.warnings, [
      '[@toghen/postcss] The option "tokenLayer" is retired and ignored: nothing replaces it. t(path) writes var(--name, literal) everywhere, in any layer.',
      '[@toghen/postcss] The option "stateLayer" is retired and ignored: nothing replaces it. A part is nested in the rule that applies its component, in that rule\'s layer.',
    ]);
    await assert.rejects(run('.a { x: 1; }', { tokenLayer: 'tokens' } as never), /"tokenLayer" is retired/);
  });
});
