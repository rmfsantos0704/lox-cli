import path from 'path';

// Cross-file checks on what is about to be committed. Only relative JS/TS-style
// imports are understood; other languages are simply not checked.
//   - findGroupDependencies / mergeGroups / orderGroups: a group imports a file that
//     changes in ANOTHER group (committed alone or in the wrong order it would not run)
//   - findStrayUntracked: a new file that nothing being committed imports
//   - findCaseMismatches: an import whose letter case differs from the real file name
//     (works on Windows/macOS, breaks on Linux)

const CODE_EXT = /\.(m?[jt]sx?|cjs|cts|vue|svelte)$/i;
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]*)['"]/g;
const EXTS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.json', '.vue', '.svelte'];
const INDEXES = ['index.js', 'index.mjs', 'index.ts', 'index.tsx', 'index.jsx'];
const TYPE_PRIORITY = ['feat', 'fix', 'perf', 'refactor', 'build', 'ci', 'test', 'docs', 'style', 'chore', 'revert'];

// New files that are legitimately never imported.
const NEVER_IMPORTED = [
  /(^|\/)(__tests__|__mocks__|tests?|spec|bin|scripts?|examples?|docs?)\//i,
  /\.(test|spec)\.[^/]+$/i,
  /\.config\.[^/]+$/i,
  /(^|\/)(index|main|cli|app|server)\.[^/]+$/i
];

function candidatesFor(fromFile, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  return [base, ...EXTS.map(e => base + e), ...INDEXES.map(i => `${base}/${i}`)];
}

function resolveSpec(fromFile, spec, known) {
  return candidatesFor(fromFile, spec).find(c => known.has(c));
}

// Calls cb(file, groupKey, spec) for every relative import in every changed code file.
async function forEachImport(groups, readFile, cb) {
  for (const [key, files] of Object.entries(groups)) {
    for (const f of files) {
      if (f.status.includes('D') || !CODE_EXT.test(f.path)) continue;
      const src = await readFile(f.path);
      if (!src) continue;
      for (const m of src.matchAll(IMPORT_RE)) cb(f, key, m[1]);
    }
  }
}

function ownerMap(groups) {
  const owner = new Map();
  for (const [key, files] of Object.entries(groups)) {
    for (const f of files) owner.set(f.path, key);
  }
  return owner;
}

/* ---------------------------- dependencies ---------------------------- */

// Returns [{ from, to, file, imports }]: group `from` has a file that imports
// `imports`, which is being committed in group `to`.
export async function findGroupDependencies(groups, readFile) {
  const owner = ownerMap(groups);
  const edges = [];
  await forEachImport(groups, readFile, (f, key, spec) => {
    const target = resolveSpec(f.path, spec, owner);
    const toKey = target && owner.get(target);
    if (toKey && toKey !== key) edges.push({ from: key, to: toKey, file: f.path, imports: target });
  });
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

/* ------------------------- stray untracked files ------------------------ */

// Untracked code files that no file in this commit run imports. Often a scratch
// file or a forgotten import. Tests, scripts, bin/, configs and entry points are
// skipped because they are legitimately never imported.
export async function findStrayUntracked(groups, readFile) {
  const owner = ownerMap(groups);
  const imported = new Set();
  await forEachImport(groups, readFile, (f, _key, spec) => {
    const target = resolveSpec(f.path, spec, owner);
    if (target && target !== f.path) imported.add(target);
  });

  const stray = [];
  for (const files of Object.values(groups)) {
    for (const f of files) {
      if (f.status !== '??' || !CODE_EXT.test(f.path)) continue;
      if (NEVER_IMPORTED.some(re => re.test(f.path))) continue;
      if (!imported.has(f.path)) stray.push(f);
    }
  }
  return stray;
}

/* ---------------------------- case mismatches --------------------------- */

// `allPaths` = every file git knows (index spelling) or could add. Returns
// [{ file, spec, actual }] for imports that only resolve when letter case is ignored.
export async function findCaseMismatches(groups, readFile, allPaths = []) {
  const exact = new Set(allPaths);
  const lower = new Map(allPaths.map(p => [p.toLowerCase(), p]));
  const found = [];
  const seen = new Set();

  await forEachImport(groups, readFile, (f, _key, spec) => {
    const cands = candidatesFor(f.path, spec);
    if (cands.some(c => exact.has(c))) return;
    const actual = cands.map(c => lower.get(c.toLowerCase())).find(Boolean);
    const id = `${f.path}|${spec}`;
    if (actual && !seen.has(id)) {
      seen.add(id);
      found.push({ file: f.path, spec, actual });
    }
  });
  return found;
}