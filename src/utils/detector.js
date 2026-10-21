import path from 'path';
import chalk from 'chalk';
import { getConfig } from './config.js';
import { sanitizeScope, lowerLeadingVerb, truncateAtWord } from './formatter.js';

const norm = (p = '') => p.replace(/\\/g, '/');
const GENERIC_DIRS = new Set(['', '.', 'src', 'app', 'lib', 'dist']);
const BINARY_EXT = /\.(png|jpe?g|gif|ico|webp|pdf|zip|exe|bin|tar|gz|mp4|mp3|woff2?|ttf|eot)$/i;
const TYPES = 'feat|fix|docs|style|refactor|test|chore|perf|build|ci|revert';

/* ------------------------------------------------------------------ */
/* Diff helpers                                                         */
/* ------------------------------------------------------------------ */

// Returns only real added/removed lines. Parsing by hunk means file headers
// ("--- a/x", "+++ b/x") are skipped, while content like "+++i;" (an added
// "++i;") or "--- foo" (a removed SQL comment "-- foo") is kept.
export function changedLines(diff = '') {
  const out = [];
  let inHunk = false;
  for (const l of diff.replace(/\r/g, '').split('\n')) {
    if (l.startsWith('diff --git')) inHunk = false;
    else if (l.startsWith('@@')) inHunk = true;
    else if (inHunk && (l[0] === '+' || l[0] === '-')) out.push(l);
  }
  return out;
}

// Splits a multi-file diff into [{ file, text, lines, binary }].
export function splitDiff(diff = '') {
  const sections = [];
  let cur = null;
  for (const line of diff.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/ b\/(.+)$/);
      cur = { file: m ? m[1] : '', text: '' };
      sections.push(cur);
    }
    if (cur) cur.text += `${line}\n`;
  }
  for (const s of sections) {
    s.lines = changedLines(s.text);
    s.binary = /^Binary files /m.test(s.text) || /^GIT binary patch/m.test(s.text) || BINARY_EXT.test(s.file);
  }
  return sections;
}

// Regex matching a comment line (prefixed with +/-) for this file type, or null
// when comments can't be detected reliably (markdown, plain text, JSON).
function commentRegex(filePath) {
  const p = norm(filePath).toLowerCase();
  if (/\.(md|mdx|txt|json|rst)$/.test(p)) return null;
  if (/\.(py|sh|bash|zsh|rb|ya?ml|toml|ini|conf|pl|r)$/.test(p) || /(^|\/)(dockerfile|makefile|\.gitignore|\.env[^/]*)$/.test(p)) {
    return /^[+-]\s*#/;
  }
  if (/\.(html?|vue|svelte|xml)$/.test(p)) return /^[+-]\s*(<!--|-->|\/\/|\/\*|\*\/|\*(\s|$))/;
  if (/\.(sql|lua)$/.test(p)) return /^[+-]\s*(--|\/\*|\*\/|\*(\s|$))/;
  // C-like default. `*(\s|$)` avoids matching pointer code such as "+ *ptr = x".
  return /^[+-]\s*(\/\/|\/\*|\*\/|\*(\s|$))/;
}

export function isCommentOnly(lines, filePath) {
  const re = commentRegex(filePath);
  if (!re) return false;
  const body = lines.filter(l => !/^[+-]\s*$/.test(l)); // blank lines don't break it
  return body.length > 0 && body.every(l => re.test(l));
}

// True when removed and added text are identical once whitespace is ignored
// (re-indenting, re-wrapping, blank-line changes). Skipped for languages where
// whitespace is meaningful.
function isFormattingOnly(lines, filePath) {
  if (lines.length === 0) return false;
  if (/\.(py|ya?ml|pug|haml|mk)$/i.test(filePath) || /(^|\/)makefile$/i.test(norm(filePath))) return false;
  const squash = (prefix) => lines.filter(l => l[0] === prefix).map(l => l.slice(1).replace(/\s+/g, '')).join('');
  return squash('-') === squash('+');
}

/* ------------------------------------------------------------------ */
/* Classification                                                       */
/* ------------------------------------------------------------------ */

// Determines the type of change for a SINGLE file, from that file's own diff.
export function getFileType(filePath, diffText = '', status = '') {
  const p = norm(filePath).toLowerCase();

  // 1. Path-based rules (precise boundaries so latest.js / licenseService.js don't match)
  if (/(^|\/)\.github\/workflows\//.test(p) || /(^|\/)(\.gitlab-ci\.yml|\.circleci\/|azure-pipelines\.yml|jenkinsfile)/.test(p)) return 'ci';
  if (/(^|\/)(__tests__|__mocks__|tests?|spec)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /_test\.(py|go)$/.test(p) || /(^|\/)test_[^/]+\.py$/.test(p)) return 'test';
  if (/(^|\/)docs?\//.test(p) || /\.(md|mdx|rst)$/.test(p) || /(^|\/)(license|licence|copying)(\.\w+)?$/.test(p)) return 'docs';
  if (/\.vscode\//.test(p) || /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|\.gitignore|\.gitattributes|\.npmrc|\.nvmrc|\.editorconfig|\.eslintrc[^/]*|\.eslintignore|\.prettierrc[^/]*|\.prettierignore|eslint\.config\.[cm]?[jt]s|prettier\.config\.[cm]?[jt]s)$/.test(p)) return 'chore';
  if (/(^|\/)(dockerfile[^/]*|docker-compose[^/]*\.ya?ml|makefile|tsconfig[^/]*\.json|jsconfig\.json|babel\.config[^/]*|\.babelrc)$/.test(p) || /\.config\.[cm]?[jt]s$/.test(p)) return 'build';

  // 2. Status-based rules. New files are features even if they only contain comments.
  if (status.includes('A') || status.includes('?')) return 'feat';
  if (status.includes('D')) return 'refactor';

  const lines = changedLines(diffText);
  if (status.includes('R') && lines.length === 0) return 'refactor'; // pure rename

  // 3. Content rules on this file's changed lines only
  if (isCommentOnly(lines, p)) return 'chore';
  if (isFormattingOnly(lines, p)) return 'style';

  // Deliberately NO keyword guessing ("fix", "bug", "refactor" in comments): a tool
  // that talks about commit types in its own source would misclassify itself.
  // `fix` comes from a fix/ branch or from the user's own choice in the prompt.
  return 'feat';
}

function getFileDomain(filePath) {
  const parts = norm(filePath).split('/');
  if (parts.length > 1) {
    const root = parts[0].toLowerCase();
    if (['backend', 'server', 'api'].includes(root)) return 'backend';
    if (['frontend', 'client', 'web', 'ui'].includes(root)) return 'frontend';
  }
  return 'root';
}

// Groups files by type. `getDiffFor(file)` returns that file's own diff, so one
// file's content can never change another file's classification.
// Backend/frontend are only split when BOTH are present for the same type.
export async function groupFilesByType(files = [], getDiffFor = async () => '') {
  const typed = [];
  for (const file of files) {
    const diff = await getDiffFor(file);
    typed.push({ file, type: getFileType(file.path, diff, file.status), domain: getFileDomain(file.path) });
  }

  const domainsByType = {};
  for (const t of typed) {
    if (t.domain !== 'root') (domainsByType[t.type] ??= new Set()).add(t.domain);
  }

  const groups = {};
  for (const { file, type, domain } of typed) {
    const split = ['feat', 'fix', 'refactor'].includes(type) && domainsByType[type]?.size > 1 && domain !== 'root';
    const key = split ? `${type}:${domain}` : type;
    (groups[key] ??= []).push(file);
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Scope                                                                */
/* ------------------------------------------------------------------ */

// Returns a valid scope token or '' (no scope is better than a wrong one).
export function detectScope(files = []) {
  if (files.length === 0) return '';
  const dirs = files.map(f => norm(f.path).split('/').slice(0, -1));

  let common = dirs[0];
  for (const d of dirs.slice(1)) {
    let i = 0;
    while (i < common.length && i < d.length && common[i] === d[i]) i++;
    common = common.slice(0, i);
  }

  // Deepest shared directory that is not generic: client/src -> "client",
  // src/components -> "components", plain src -> no scope.
  const meaningful = [...common].reverse().find(d => !GENERIC_DIRS.has(d.toLowerCase()));
  return meaningful ? sanitizeScope(meaningful) : '';
}

/* ------------------------------------------------------------------ */
/* AI description                                                       */
/* ------------------------------------------------------------------ */

const EXAMPLES = [
  { files: 'src/api.js', change: '-console.log(msg)\n+logger.info(msg)', out: 'replace console logging with logger in api' },
  { files: 'README.md', change: '+Contributions are welcome, see CONTRIBUTING.', out: 'add contribution notes to README.md' },
  {
    files: 'src/recipes.js',
    names: 'Added/changed names: updateRecipe',
    change: '-recipe.title = body.title\n+recipe.title = body.title ?? recipe.title',
    out: 'keep title in updateRecipe when missing'
  }
];

const VERBS = { adds: 'add', fixes: 'fix', removes: 'remove', updates: 'update', changes: 'change', improves: 'improve', refactors: 'refactor' };

// Cleans raw model output into a bare description (or '' if unusable).
// Identifiers, filenames and acronyms are kept EXACTLY as the model wrote them.
export function cleanModelOutput(raw = '', max = 60) {
  let s = String(raw)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .trim();
  s = s.split('\n').map(l => l.trim()).find(Boolean) || '';
  const unquote = (t) => t.replace(/^["'`*]+|["'`*]+$/g, '').trim();

  s = unquote(s);
  s = s.replace(/^(output|description|commit message|message)\s*:\s*/i, '');
  s = unquote(s);
  // The colon is REQUIRED, otherwise "fix login bug" would lose its verb.
  s = s.replace(new RegExp(`^(${TYPES})(\\([^)]*\\))?!?:\\s*`, 'i'), '');
  s = unquote(s);
  s = s.replace(/\.$/, '').trim(); // only ONE trailing dot, nothing else is touched
  s = s.replace(/^(adds|fixes|removes|updates|changes|improves|refactors)\b/i, m => VERBS[m.toLowerCase()]);
  return truncateAtWord(lowerLeadingVerb(s), max);
}

// Dotfiles whose bare name models like to write without the dot ("update gitignore").
// Deliberately NOT every dotfile: ".env" -> "env" is also a normal word.
const DOTFILE_STEM = /(rc|ignore|attributes|editorconfig)$/i;
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Puts back file names the model mangled: restores letter case ("readme.md" ->
// "README.md") and the leading dot ("gitignore" -> ".gitignore").
export function restoreFileNames(description, files = []) {
  let out = description;
  const names = new Set(files.map(f => path.basename(f.path)).filter(Boolean));
  for (const name of names) {
    out = out.replace(new RegExp(`(?<![\\w./-])${escapeRe(name)}(?![\\w-])`, 'gi'), name);
    if (name.startsWith('.') && DOTFILE_STEM.test(name.slice(1))) {
      // not preceded by "." (so an already-dotted name is never doubled)
      out = out.replace(new RegExp(`(?<![\\w./-])${escapeRe(name.slice(1))}(?![\\w-])`, 'gi'), name);
    }
  }
  return out;
}

const DECL_PATTERNS = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /\b(?:const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /\bdef\s+([A-Za-z_]\w*)/,
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^[+-]\s*(?:async\s+|static\s+|public\s+|private\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/ // method definitions
];
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'with', 'Props', 'props', 'State']);

// Names declared in the changed lines: { added: [...], removed: [...] }.
// "added" = declared on a + line (new or modified); "removed" = declared only on - lines.
// Top-level declarations (no indentation: components, exported functions) are listed
// before nested ones (local variables), because they describe a change better.
export function extractIdentifiers(lines = []) {
  const collect = (prefix) => {
    const top = new Set();
    const nested = new Set();
    for (const l of lines) {
      if (l[0] !== prefix) continue;
      for (const re of DECL_PATTERNS) {
        const m = l.match(re);
        if (m && m[1] && !NOT_NAMES.has(m[1])) {
          (/^[+-]\S/.test(l) ? top : nested).add(m[1]);
          break;
        }
      }
    }
    return [...top, ...[...nested].filter(n => !top.has(n))];
  };
  const added = collect('+');
  const addedSet = new Set(added);
  const removed = collect('-').filter(n => !addedSet.has(n));
  return { added: added.slice(0, 8), removed: removed.slice(0, 8) };
}

// "File: path" + declared names + the changed lines (cut to `per` characters).
function sampleFor(section, per) {
  const { added, removed } = extractIdentifiers(section.lines);
  const names = [
    added.length ? `Added/changed names: ${added.join(', ')}` : '',
    removed.length ? `Removed names: ${removed.join(', ')}` : ''
  ].filter(Boolean).join('\n');
  return `File: ${section.file}${names ? `\n${names}` : ''}\n${section.lines.map(l => l.slice(0, 200)).join('\n').slice(0, per)}`;
}

function buildSample(sections, budget = 1800) {
  const shown = sections.filter(s => !s.binary && s.lines.length).slice(0, 6);
  const per = Math.max(200, Math.floor(budget / Math.max(1, shown.length)));
  return shown.map(s => sampleFor(s, per)).join('\n\n');
}

function fallbackDescription(files) {
  return files.length === 1 ? `update ${path.basename(files[0].path)}` : `update ${files.length} project files`;
}

/* ------------------------------------------------------------------ */
/* Ollama                                                               */
/* ------------------------------------------------------------------ */

// After a connection failure, later calls in the same run are skipped silently
// instead of printing the same warning for every group.
let aiDown = false;
export function resetAiState() { aiDown = false; }

function aiSettings() {
  let model = 'llama3.2';
  let baseUrl = 'http://127.0.0.1:11434';
  try {
    const config = getConfig();
    if (config?.model) model = config.model;
    if (config?.ollamaUrl) baseUrl = String(config.ollamaUrl).replace(/\/+$/, '');
  } catch { /* config problems are reported by the caller */ }
  return { model, baseUrl };
}

// Returns { text, model } or null when the model is unavailable.
async function askOllama(prompt, { json = false, numPredict = 40, timeoutMs = 45000 } = {}) {
  if (aiDown) return null;
  const { model, baseUrl } = aiSettings();
  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        ...(json ? { format: 'json' } : {}),
        // num_ctx: Ollama's default window is only 4096 tokens, too small for big groups.
        options: { temperature: 0, num_predict: numPredict, num_ctx: 8192 }
      }),
      signal: AbortSignal.timeout(timeoutMs) // a cold model load can take a while
    });

    if (!response.ok) {
      const hint = response.status === 404 ? ` Is the model installed? Try: ollama pull ${model}` : '';
      console.log(chalk.yellow(`⚠️ AI detection skipped (Ollama returned HTTP ${response.status}).${hint}`));
      return null;
    }
    const data = await response.json();
    return { text: data.response ?? '', model };
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    if (!timedOut) aiDown = true;
    console.log(chalk.yellow(`⚠️ AI detection skipped (${timedOut ? 'timed out' : 'Ollama offline'})`));
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Change analysis: type + mixed-change detection                       */
/* ------------------------------------------------------------------ */

const ANALYSIS_TYPES = new Set(['feat', 'fix', 'chore']);

// Parses the model's JSON: { changes: [{ type, file, summary }] }.
// Returns { type, changes, mixed } or null when nothing usable came back.
//   mixed = the diff contains BOTH a bug fix and a new feature.
export function parseAnalysis(raw) {
  const text = String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { data = JSON.parse(m[0]); } catch { return null; }
  }

  const list = Array.isArray(data?.changes) ? data.changes : (data?.type ? [data] : []);
  const changes = list
    .map(c => ({
      type: String(c?.type ?? '').toLowerCase().trim(),
      file: String(c?.file ?? '').trim(),
      summary: String(c?.summary ?? '').trim()
    }))
    .filter(c => ANALYSIS_TYPES.has(c.type));
  if (changes.length === 0) return null;

  return { ...summarizeTypes(changes), changes };
}

// Overall type of a list of changes, and whether it mixes a fix with a feature.
function summarizeTypes(changes) {
  const types = new Set(changes.map(c => c.type));
  return {
    type: types.has('feat') ? 'feat' : types.has('fix') ? 'fix' : 'chore',
    mixed: types.has('feat') && types.has('fix')
  };
}

const ANALYSIS_EXAMPLES = `Example 1:
File: src/parser.js
-const parser = new Parser({ strict: true })
+const parser = new Parser({ strict: false })
Answer: {"changes":[{"type":"chore","file":"src/parser.js","summary":"switch parser strict option"}]}

Example 2:
File: src/recipes.js
Added/changed names: updateRecipe
-recipe.title = body.title
+recipe.title = body.title ?? recipe.title
Answer: {"changes":[{"type":"fix","file":"src/recipes.js","summary":"keep title in updateRecipe when missing"}]}

Example 3:
File: src/recipes.js
Added/changed names: updateRecipe, shareRecipe
-recipe.title = body.title
+recipe.title = body.title ?? recipe.title
+export function shareRecipe(id) {
+  return createShareLink(id)
+}
Answer: {"changes":[{"type":"fix","file":"src/recipes.js","summary":"keep title in updateRecipe when missing"},{"type":"feat","file":"src/recipes.js","summary":"add shareRecipe"}]}`;

// Asks the model to list each DISTINCT change in the diff with a type of
// feat, fix or chore. Returns { type, changes, mixed } or null (model unavailable
// or unusable output, so callers keep their own default).
export async function analyzeGroup(files = [], diffText = '', diffStat = '') {
  const sections = splitDiff(diffText).filter(s => !s.binary && s.lines.length > 0);
  if (sections.length === 0) return null;

  const { model } = aiSettings();
  console.log(chalk.gray(`\n⏳ [AI Active (${model})]: Classifying changes...`));

  const prompt = `You classify code changes for a git commit. List each DISTINCT change in the diff below.
"type" must be exactly one of:
- feat: adds a new capability, function, option or behavior
- fix: corrects wrong behavior (a bug)
- chore: a library or tool option swap, a configuration tweak, dependency or tooling updates, renames or cleanup with no behavior change
A library option swap or a config tweak is ALWAYS chore. Lines that serve the same purpose are ONE change. Only lines starting with + (added) or - (removed) are changes.
Reply with JSON only, in the form {"changes":[{"type":"feat|fix|chore","file":"path","summary":"3 to 8 words"}]}. Keep identifiers exactly as written.

${ANALYSIS_EXAMPLES}

Now the real change:
${diffStat.trim() ? `Summary:\n${diffStat}\n\n` : ''}${buildSample(sections, 2600)}
Answer:`;

  const reply = await askOllama(prompt, { json: true, numPredict: 300 });
  if (!reply) return null;

  const analysis = parseAnalysis(reply.text);
  if (!analysis) {
    console.log(chalk.yellow('⚠️ [AI Guard]: Could not read the model\'s classification, using the detected type.'));
    return null;
  }
  console.log(chalk.magenta(`🧠 [Ollama AI Active (${reply.model})]: type "${analysis.type}"${analysis.mixed ? ' (mixed fix + feat)' : ''}`));
  return analysis;
}

/* ------------------------------------------------------------------ */
/* Big groups: one summary per file, then a title                       */
/* ------------------------------------------------------------------ */

// A single "max 8 words" line cannot describe a dozen files, and sampling only the
// first few files hides the rest from the model. From this many files on, EVERY file
// is read (in batches), each gets its own type + summary, and those summaries become
// the commit body, with a short title written from all of them.
export const BIG_GROUP_FILES = 4;
const BATCH_MAX_FILES = 5;
const BATCH_MAX_CHARS = 3200;
const PER_FILE_CHARS = 800;

const TYPE_RULES = `"type" must be exactly one of:
- feat: adds a new capability, function, option or behavior
- fix: corrects wrong behavior (a bug)
- chore: a library or tool option swap, a configuration tweak, dependency or tooling updates, renames or cleanup with no behavior change
A library option swap or a config tweak is ALWAYS chore.`;

function batchSections(sections) {
  const batches = [];
  let cur = [];
  let chars = 0;
  for (const section of sections) {
    const sample = sampleFor(section, PER_FILE_CHARS);
    if (cur.length && (cur.length >= BATCH_MAX_FILES || chars + sample.length > BATCH_MAX_CHARS)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push({ section, sample });
    chars += sample.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// Parses {"files":[{ "file", "type", "summary" }]} (an array is accepted too).
// Returns [{ file, type, summary }] and drops entries without a usable summary.
export function parseFileSummaries(raw) {
  const text = String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (!m) return [];
    try { data = JSON.parse(m[0]); } catch { return []; }
  }
  const list = Array.isArray(data) ? data
    : Array.isArray(data?.files) ? data.files
    : Array.isArray(data?.changes) ? data.changes
    : [];
  return list
    .map(e => ({
      file: String(e?.file ?? '').trim(),
      type: String(e?.type ?? '').toLowerCase().trim(),
      summary: cleanModelOutput(String(e?.summary ?? ''), 70)
    }))
    .filter(e => e.summary);
}

// The model may answer with the full path, the bare file name, or in order.
function matchEntry(entries, section, index, batchLength) {
  const base = path.basename(section.file);
  return entries.find(e => e.file === section.file)
    || entries.find(e => e.file && (section.file.endsWith(`/${e.file}`) || path.basename(e.file) === base))
    || (entries.length === batchLength ? entries[index] : undefined);
}

const BATCH_EXAMPLE = `Example:
File: src/api.ts
Added/changed names: getItems
+export async function getItems() { return request('/items') }
File: src/Layout.tsx
-<NavLink to="/items">Items</NavLink>
+<NavLink to="/library">Library</NavLink>
Answer: {"files":[{"file":"src/api.ts","type":"feat","summary":"add getItems request"},{"file":"src/Layout.tsx","type":"feat","summary":"point nav link to the library page"}]}`;

const TITLE_EXAMPLE = `Example:
- api.ts: add getItems request
- Library.tsx: show items grouped by tag
- Layout.tsx: link nav to the Library page
- ItemCard.tsx: show tag chips
Title: add Library page with tag grouping`;

// Returns { description, body, analysis } or null (fewer than BIG_GROUP_FILES files,
// or the model is unavailable, so the caller keeps its normal path).
//   body     = one bullet per file ("- Library.tsx: show items grouped by tag")
//   analysis = { type, mixed, changes } built from the per-file types
export async function describeGroup(files = [], diffText = '') {
  const sections = splitDiff(diffText).filter(s => !s.binary && s.lines.length > 0);
  if (sections.length < BIG_GROUP_FILES) return null;

  const batches = batchSections(sections);
  const { model } = aiSettings();
  console.log(chalk.gray(`\n⏳ [AI Active (${model})]: Reading all ${sections.length} files (${batches.length} batch${batches.length === 1 ? '' : 'es'})...`));

  const changes = [];
  let understood = 0;
  for (const batch of batches) {
    const prompt = `You summarize code changes for a git commit. For EACH file below write one summary of 3 to 10 words in imperative mood (e.g. "add", "fix", "replace") saying what changed in that file, and classify it.
${TYPE_RULES}
Name the component, function or behavior that changed (use the "names" lines when present). Keep identifiers exactly as written. Avoid vague words such as "logic", "code", "utility", "improvements", "changes". Only lines starting with + (added) or - (removed) are changes.
Reply with JSON only: {"files":[{"file":"path","type":"feat|fix|chore","summary":"..."}]} with exactly one entry per file, in the same order.

${BATCH_EXAMPLE}

Now the real files:
${batch.map(b => b.sample).join('\n\n')}
Answer:`;

    const reply = await askOllama(prompt, { json: true, numPredict: 90 * batch.length + 60 });
    if (!reply && aiDown) return null;
    const entries = reply ? parseFileSummaries(reply.text) : [];

    batch.forEach(({ section }, i) => {
      const e = matchEntry(entries, section, i, batch.length);
      if (e) understood++;
      changes.push({
        file: section.file,
        type: ANALYSIS_TYPES.has(e?.type) ? e.type : 'feat',
        summary: e?.summary || `update ${path.basename(section.file)}`
      });
    });
  }
  if (understood === 0) return null;

  // Bullet label: the bare file name, or the last two path parts when names collide.
  const counts = {};
  for (const c of changes) counts[path.basename(c.file)] = (counts[path.basename(c.file)] || 0) + 1;
  const label = (f) => (counts[path.basename(f)] > 1 ? f.split('/').slice(-2).join('/') : path.basename(f));
  const body = changes.map(c => `- ${label(c.file)}: ${c.summary}`).join('\n');

  // One short title that covers every summary.
  const titlePrompt = `You write git commit titles. Below is a one-line summary of every change in a commit. Write ONE title: imperative mood, starting with a lowercase verb, max 10 words, no type prefix, no quotes, no trailing period. Mention the main things that changed; when there are more than three separate things, name the overall theme instead of listing them. Keep identifiers and file names exactly as written. Output ONLY the title.

${TITLE_EXAMPLE}

Changes:
${changes.map(c => `- ${label(c.file)}: ${c.summary}`).join('\n')}
Title:`;

  const reply = await askOllama(titlePrompt, { numPredict: 60 });
  let description = reply ? restoreFileNames(cleanModelOutput(reply.text, 64), files) : '';
  const parroted = /^add Library page with tag grouping$/i.test(description);
  if (!description || parroted || /^(none|n\/a)$/i.test(description)) description = `update ${files.length} project files`;

  const analysis = { ...summarizeTypes(changes), changes };
  console.log(chalk.magenta(`🧠 [Ollama AI Active (${model})]: "${description}" (${changes.length} files read, type "${analysis.type}"${analysis.mixed ? ', mixed fix + feat' : ''})`));
  return { description, body, analysis };
}

/* ------------------------------------------------------------------ */
/* Description                                                          */
/* ------------------------------------------------------------------ */

export async function generateDescription(files = [], diffText = '', diffStat = '') {
  if (files.length === 0) return 'update project files';

  // 1. Pure deletions
  if (files.every(f => f.status.includes('D'))) {
    return files.length === 1 ? `remove ${path.basename(files[0].path)}` : 'remove obsolete files';
  }

  const sections = splitDiff(diffText);

  // 2. Binary-only groups
  if (files.every(f => BINARY_EXT.test(f.path)) || (sections.length > 0 && sections.every(s => s.binary))) {
    return 'update binary assets';
  }

  // 3. Comment-only groups skip the AI entirely (markdown/plain text never count)
  const withLines = sections.filter(s => s.lines.length > 0);
  if (withLines.length > 0 && withLines.every(s => isCommentOnly(s.lines, s.file))) {
    console.log(chalk.magenta('🧠 [Deterministic Interceptor]: "update inline comments"'));
    return 'update inline comments';
  }

  // 4. Local AI via Ollama
  if (withLines.length > 0 || diffStat.trim()) {
    const { model } = aiSettings();
    console.log(chalk.gray(`\n⏳ [AI Active (${model})]: Describing changes...`));

    const examples = EXAMPLES
      .map((e, i) => `Example ${i + 1}:\nFile: ${e.files}\n${e.names ? `${e.names}\n` : ''}${e.change}\nOutput: ${e.out}`)
      .join('\n\n');
    const sample = buildSample(sections) || `Summary:\n${diffStat}`;
    const prompt = `You write git commit descriptions. Summarize the change below as ONE line, max 8 words, starting with a lowercase imperative verb (e.g. "add", "fix", "replace"). Keep every identifier, function name and file name EXACTLY as written: same capitalization, leading dots included (e.g. parseJSON, README.md, .gitignore). No type prefix, no quotes, no trailing period. Be SPECIFIC: name the function, feature or behavior that changed (use the "names" lines when present). Avoid vague words such as "logic", "code", "utility", "improvements", "changes". Only lines starting with + (added) or - (removed) are changes. Output ONLY the description.

${examples}

Now the real change:
${diffStat.trim() ? `Summary:\n${diffStat}\n\n` : ''}${sample}
Output:`;

    const reply = await askOllama(prompt);
    if (reply) {
      const desc = restoreFileNames(cleanModelOutput(reply.text), files);
      const parroted = EXAMPLES.some(e => e.out.toLowerCase() === desc.toLowerCase());
      const garbage = /binary file|unmarked|context lines?|^(none|n\/a)$/i.test(desc);

      if (!desc || parroted || garbage) {
        console.log(chalk.yellow('⚠️ [AI Guard]: Unusable model output, using a plain fallback.'));
      } else {
        console.log(chalk.magenta(`🧠 [Ollama AI Active (${reply.model})]: "${desc}"`));
        return desc;
      }
    }
  }

  return fallbackDescription(files);
}

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

// Validates the header that will actually be committed.
export function validateCommitHeader(header) {
  if (!header || typeof header !== 'string') return { valid: false, reason: 'Header cannot be empty.' };
  if (header.length > 72) return { valid: false, reason: `Exceeds 72-character limit (${header.length}/72).` };
  if (header.endsWith('.')) return { valid: false, reason: 'Contains a trailing period.' };

  const re = new RegExp(`^(${TYPES})(\\([a-z0-9_./-]+\\))?!?: \\S.*$`);
  if (!re.test(header)) {
    return { valid: false, reason: 'Invalid format. Expected: type(scope): description' };
  }
  return { valid: true };
}