import postcss, { type ChildNode, type Container } from 'postcss';

/*
 * A cascade just big enough for one component's rule and its parts, shared by the tests that ask what an element ends
 * up with. It flattens `&` nesting and at-rules, and orders by specificity, then source order. Layers are read through
 * and otherwise ignored: the tests that use it write the component in one layer.
 */

/** A rule with nesting resolved. `chain` is the top selector, then each nested selector or at-rule (`@media …`) as written. */
export interface Flat {
  selector: string;
  chain: string[];
  decls: [string, string][];
}

export function flatten(css: string): Flat[] {
  const out: Flat[] = [];
  const visit = (container: Container, parent: string | undefined, chain: string[]) => {
    for (const node of container.nodes as ChildNode[]) {
      if (node.type === 'rule') {
        const selector =
          parent === undefined
            ? node.selector
            : node.selector.includes('&')
              ? node.selector.replaceAll('&', parent)
              : `${parent} ${node.selector}`;
        const next = [...chain, node.selector];
        out.push({ selector, chain: next, decls: decls(node) });
        visit(node, selector, next);
      } else if (node.type === 'atrule' && node.nodes) {
        if (node.name === 'layer') {
          visit(node, parent, chain);
          continue;
        }
        const next = [...chain, `@${node.name} ${node.params}`];
        if (parent !== undefined) out.push({ selector: parent, chain: next, decls: decls(node) });
        visit(node, parent, next);
      }
    }
  };
  visit(postcss.parse(css), undefined, []);
  return out.filter((r) => r.decls.length > 0);
}

const decls = (node: Container): [string, string][] =>
  (node.nodes as ChildNode[])
    .filter((n) => n.type === 'decl')
    .map((d) => [(d as any).prop, (d as any).value.replace(/\s+/g, ' ')] as [string, string]);

/** The text with every `var(--x, fallback)` replaced by its value in `scope`. */
export function evaluate(value: string, scope: Record<string, string>, depth = 0): string {
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

/** Split at top-level commas. */
function args(text: string): string[] {
  const out: string[] = [];
  let level = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') level++;
    else if (text[i] === ')') level--;
    else if (text[i] === ',' && level === 0) {
      out.push(text.slice(from, i));
      from = i + 1;
    }
  }
  return [...out, text.slice(from)];
}

/**
 * The specificity of a selector fragment, as ids × 10000 + classes, attributes and pseudo-classes × 100 + types.
 * `&` weighs nothing here (the parent is counted once, by the caller); `:where()` weighs nothing; `:is()`, `:not()`
 * and `:has()` weigh their heaviest argument.
 */
export function specificity(selector: string): number {
  let weight = 0;
  let i = 0;
  const s = selector.replaceAll('&', ' ');
  while (i < s.length) {
    const fn = /^:(where|is|not|has)\(/.exec(s.slice(i));
    if (fn) {
      let level = 1;
      let j = i + fn[0].length;
      for (; j < s.length && level > 0; j++) level += s[j] === '(' ? 1 : s[j] === ')' ? -1 : 0;
      if (fn[1] !== 'where') weight += Math.max(...args(s.slice(i + fn[0].length, j - 1)).map(specificity));
      i = j;
      continue;
    }
    const piece = /^(#[\w-]+|\.[\w-]+|\[[^\]]*\]|::[\w-]+|:[\w-]+|[a-zA-Z][\w-]*|\*|[\s>+~]+)/.exec(s.slice(i));
    if (!piece) throw new Error(`The selector "${selector}" is not one this test knows how to weigh.`);
    const p = piece[0];
    weight += p.startsWith('#') ? 10000 : p.startsWith('::') ? 1 : /^[.[:]/.test(p) ? 100 : /^[a-zA-Z]/.test(p) ? 1 : 0;
    i += p.length;
  }
  return weight;
}

export interface Component {
  /** The selector of the element's own rule, such as `.button`. */
  root: string;
  /** Each part value's spelling: `{ hover: ':hover', fine: '@media (pointer: fine)' }`. */
  spellings: Record<string, string>;
  /** The world in force: the selectors whose custom properties reach the element, in order, `:root` first. */
  world: string[];
}

/**
 * What every CSS property of the component's element ends up with, with some part values on. A nested selector or
 * an at-rule this component does not spell throws, so a rule the test does not know cannot pass unseen. An at-rule
 * spelling matches when its value is on, and adds no specificity.
 */
export function used(rules: Flat[], { root, spellings, world }: Component, on: Set<string>): Record<string, string> {
  const scope: Record<string, string> = {};
  const fragments = new Map<string, string>();
  for (const [value, spelling] of Object.entries(spellings)) {
    // as the mixins place it, and as a rule written by hand places it, which weighs its spelling
    if (!spelling.startsWith('@')) fragments.set(`&:where(${spelling})`, value);
    fragments.set(spelling.startsWith('@') || spelling.includes('&') ? spelling : `&${spelling}`, value);
  }
  const best = new Map<string, { weight: number; order: number; value: string }>();
  rules.forEach(({ chain: written, decls }, order) => {
    // a compound written flat, `.button:hover`, is the root with one part
    const [top, ...below] = written;
    const chain =
      top !== root && top.startsWith(root) && /^[[:]/.test(top.slice(root.length))
        ? [root, `&${top.slice(root.length)}`, ...below]
        : written;
    if (chain.length === 1 && world.includes(chain[0])) {
      for (const [prop, value] of decls) if (prop.startsWith('--')) scope[prop] = value;
      return;
    }
    if (chain[0] !== root) return;
    let weight = specificity(root);
    for (const fragment of chain.slice(1)) {
      const value = fragments.get(fragment);
      if (value === undefined) throw new Error(`The rule "${chain.join(' > ')}" is not one this test knows how to match.`);
      if (!on.has(value)) return;
      if (!fragment.startsWith('@')) weight += specificity(fragment);
    }
    for (const [prop, value] of decls) {
      const held = best.get(prop);
      if (!held || weight > held.weight || (weight === held.weight && order > held.order)) best.set(prop, { weight, order, value });
    }
  });
  // `initial` on a custom property is the guaranteed-invalid value: a var() of it takes its fallback.
  for (const [prop, { value }] of best)
    if (prop.startsWith('--')) {
      if (value.trim() === 'initial') delete scope[prop];
      else scope[prop] = value;
    }
  return Object.fromEntries(
    [...best]
      .filter(([prop]) => !prop.startsWith('--'))
      .map(([prop, { value }]) => [prop, evaluate(value, scope).trim()])
      .sort(),
  );
}

/** The custom properties a world sets, in order: what a value read outside any component sees. */
export function worldScope(rules: Flat[], world: string[]): Record<string, string> {
  const scope: Record<string, string> = {};
  for (const { chain, decls } of rules)
    if (chain.length === 1 && world.includes(chain[0])) for (const [prop, value] of decls) scope[prop] = value;
  return scope;
}
