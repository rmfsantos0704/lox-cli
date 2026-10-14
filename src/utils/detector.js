import path from 'path';
import chalk from 'chalk';
import { getConfig } from './config.js';
import { sanitizeScope, lowerFirst, truncateAtWord } from './formatter.js';

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

  const last = common[common.length - 1] ?? '';
  if (GENERIC_DIRS.has(last.toLowerCase())) return '';
  return sanitizeScope(last);
}

/* ------------------------------------------------------------------ */
/* AI description                                                       */
/* ------------------------------------------------------------------ */

const EXAMPLES = [
  { files: 'src/api.js', change: '-console.log(msg)\n+logger.info(msg)', out: 'replace console logging with logger in api' },
  { files: 'README.md', change: '+Contributions are welcome, see CONTRIBUTING.', out: 'add contribution notes to readme' },
  { files: 'auth/session.js', change: '-if (token) return user\n+if (token && !isExpired(token)) return user', out: 'reject expired tokens in session check' }
];

const VERBS = { adds: 'add', fixes: 'fix', removes: 'remove', updates: 'update', changes: 'change', improves: 'improve', refactors: 'refactor' };

// Cleans raw model output into a bare, imperative description (or '' if unusable).
export function cleanModelOutput(raw = '') {
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
  s = s.replace(/[.!,;:\s]+$/, '');
  s = s.replace(/^(adds|fixes|removes|updates|changes|improves|refactors)\b/i, m => VERBS[m.toLowerCase()]);
  return truncateAtWord(lowerFirst(s), 60);
}

const DECL_PATTERNS = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /\b(?:const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /\bdef\s+([A-Za-z_]\w*)/,
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^[+-]\s*(?:async\s+|static\s+|public\s+|private\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/ // method definitions
];
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'with']);

// Names declared in the changed lines: { added: [...], removed: [...] }.
// "added" = declared on a + line (new or modified); "removed" = declared only on - lines.
export function extractIdentifiers(lines = []) {
  const collect = (prefix) => {
    const found = new Set();
    for (const l of lines) {
      if (l[0] !== prefix) continue;
      for (const re of DECL_PATTERNS) {
        const m = l.match(re);
        if (m && m[1] && !NOT_NAMES.has(m[1])) { found.add(m[1]); break; }
      }
    }
    return found;
  };
  const added = collect('+');
  const removed = [...collect('-')].filter(n => !added.has(n));
  return { added: [...added].slice(0, 8), removed: removed.slice(0, 8) };
}

function buildSample(sections, budget = 1800) {
  const shown = sections.filter(s => !s.binary && s.lines.length).slice(0, 6);
  const per = Math.max(200, Math.floor(budget / Math.max(1, shown.length)));
  return shown
    .map(s => {
      const { added, removed } = extractIdentifiers(s.lines);
      const names = [
        added.length ? `Added/changed names: ${added.join(', ')}` : '',
        removed.length ? `Removed names: ${removed.join(', ')}` : ''
      ].filter(Boolean).join('\n');
      return `File: ${s.file}${names ? `\n${names}` : ''}\n${s.lines.map(l => l.slice(0, 200)).join('\n').slice(0, per)}`;
    })
    .join('\n\n');
}

function fallbackDescription(files) {
  return files.length === 1 ? `update ${path.basename(files[0].path)}` : `update ${files.length} project files`;
}

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
    let model = 'llama3.2';
    let baseUrl = 'http://127.0.0.1:11434';
    try {
      const config = getConfig();
      if (config?.model) model = config.model;
      if (config?.ollamaUrl) baseUrl = String(config.ollamaUrl).replace(/\/+$/, '');
    } catch { /* config problems are reported by the caller */ }

    console.log(chalk.gray(`\n⏳ [AI Active (${model})]: Analyzing code changes...`));

    const examples = EXAMPLES.map((e, i) => `Example ${i + 1}:\nFile: ${e.files}\n${e.change}\nOutput: ${e.out}`).join('\n\n');
    const sample = buildSample(sections) || `Summary:\n${diffStat}`;
    const prompt = `You write git commit descriptions. Summarize the change below as ONE line in imperative mood (e.g. "add", "fix", "replace"), max 8 words, lowercase, no type prefix, no quotes, no trailing period. Be SPECIFIC: name the function, feature or behavior that changed (use the "names" lines when present). Avoid vague words such as "logic", "code", "utility", "improvements", "changes". Only lines starting with + (added) or - (removed) are changes. Output ONLY the description.

${examples}

Now the real change:
${diffStat.trim() ? `Summary:\n${diffStat}\n\n` : ''}${sample}
Output:`;

    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0, num_predict: 40 } }),
        signal: AbortSignal.timeout(45000) // a cold model load can take a while
      });

      if (!response.ok) {
        const hint = response.status === 404 ? ` Is the model installed? Try: ollama pull ${model}` : '';
        console.log(chalk.yellow(`⚠️ AI detection skipped (Ollama returned HTTP ${response.status}).${hint}`));
      } else {
        const data = await response.json();
        const desc = cleanModelOutput(data.response);
        const parroted = EXAMPLES.some(e => e.out === desc.toLowerCase());
        const garbage = /binary file|unmarked|context lines?|^(none|n\/a)$/i.test(desc);

        if (!desc || parroted || garbage) {
          console.log(chalk.yellow('⚠️ [AI Guard]: Unusable model output, using a plain fallback.'));
        } else {
          console.log(chalk.magenta(`🧠 [Ollama AI Active (${model})]: "${desc}"`));
          return desc;
        }
      }
    } catch (err) {
      const reason = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timed out' : 'Ollama offline';
      console.log(chalk.yellow(`⚠️ AI detection skipped (${reason})`));
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