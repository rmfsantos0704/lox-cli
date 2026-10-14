import path from 'path';

// Detects when one commit group imports a file that is changing in ANOTHER group.
// Committed separately (and in the wrong order) the first commit would not run on
// its own, which breaks `git bisect` and reverts. Only relative JS/TS-style imports
// are understood; other languages are simply not checked.

const CODE_EXT = /\.(m?[jt]sx?|cjs|cts|vue|svelte)$/i;
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]*)['"]/g;
const EXTS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.json', '.vue', '.svelte'];
const INDEXES = ['index.js', 'index.mjs', 'index.ts', 'index.tsx', 'index.jsx'];
const TYPE_PRIORITY = ['feat', 'fix', 'perf', 'refactor', 'build', 'ci', 'test', 'docs', 'style', 'chore', 'revert'];

function resolveSpec(fromFile, spec, known) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  const candidates = [base, ...EXTS.map(e => base + e), ...INDEXES.map(i => `${base}/${i}`)];
  return candidates.find(c => known.has(c));
}

// Returns [{ from, to, file, imports }]: group `from` has a file that imports
// `imports`, which is being committed in group `to`.
export async function findGroupDependencies(groups, readFile) {
  const owner = new Map();
  for (const [key, files] of Object.entries(groups)) {
    for (const f of files) owner.set(f.path, key);
  }

  const edges = [];
  for (const [key, files] of Object.entries(groups)) {
    for (const f of files) {
      if (f.status.includes('D') || !CODE_EXT.test(f.path)) continue;
      const src = await readFile(f.path);
      if (!src) continue;
      for (const m of src.matchAll(IMPORT_RE)) {
        const target = resolveSpec(f.path, m[1], owner);
        const toKey = target && owner.get(target);
        if (toKey && toKey !== key) edges.push({ from: key, to: toKey, file: f.path, imports: target });
      }
    }
  }
  return edges;
}

const typeRank = (key) => {
  const i = TYPE_PRIORITY.indexOf(key.split(':')[0]);
  return i === -1 ? TYPE_PRIORITY.length : i;
};

// Merges every set of groups connected by an import into ONE group.
// The merged group takes the key of its highest-priority type (feat before docs...).
export function mergeGroups(groups, edges) {
  const keys = Object.keys(groups);
  const parent = Object.fromEntries(keys.map(k => [k, k]));
  const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  for (const e of edges) parent[find(e.from)] = find(e.to);

  const members = {};
  for (const k of keys) (members[find(k)] ??= []).push(k);

  const out = {};
  const done = new Set();
  for (const k of keys) {
    const root = find(k);
    if (done.has(root)) continue;
    done.add(root);
    const ks = members[root];
    const best = [...ks].sort((a, b) => typeRank(a) - typeRank(b))[0];
    out[best] = ks.flatMap(m => groups[m]);
  }
  return out;
}

// Orders groups so that a group is committed AFTER the groups it imports from.
// Groups in an import cycle can't be ordered; they keep their original order
// (and `cyclic` lists them so the caller can suggest merging).
export function orderGroups(groups, edges) {
  const keys = Object.keys(groups);
  const needs = Object.fromEntries(keys.map(k => [k, new Set()]));
  for (const e of edges) needs[e.from].add(e.to);

  const ordered = [];
  const left = new Set(keys);
  while (left.size) {
    const ready = keys.find(k => left.has(k) && [...needs[k]].every(d => !left.has(d)));
    if (!ready) break;
    ordered.push(ready);
    left.delete(ready);
  }
  const cyclic = keys.filter(k => left.has(k));
  const out = {};
  for (const k of [...ordered, ...cyclic]) out[k] = groups[k];
  return { groups: out, cyclic };
}