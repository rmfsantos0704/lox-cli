// formatter.js is the single source of truth for the commit header: whatever this
// returns is exactly what gets validated and committed.

export const MAX_HEADER = 72;

// Conventional-commit scope: lowercase [a-z0-9_-], no leading/trailing separators,
// capped so a long branch name can't eat the description's space.
export function sanitizeScope(scope = '', maxLen = 24) {
  let s = String(scope)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen);
    const i = cut.lastIndexOf('-');
    s = (i > 3 ? cut.slice(0, i) : cut).replace(/[-_]+$/, '');
  }
  return s;
}

// Conventional commits start with a lowercase imperative verb ("Add x" -> "add x").
// ONLY a leading verb is lowercased. Identifiers, filenames and acronyms are kept
// exactly as written ("UserStore ...", "README.md ...", "API ...", "parseJSON ...").
const LEADING_VERBS = new Set([
  'add', 'adjust', 'allow', 'bump', 'change', 'clean', 'configure', 'correct', 'disable', 'drop',
  'enable', 'extract', 'fix', 'handle', 'implement', 'improve', 'introduce', 'make', 'merge', 'move',
  'prevent', 'refactor', 'remove', 'rename', 'replace', 'restore', 'revert', 'rewrite', 'set',
  'simplify', 'split', 'support', 'switch', 'tweak', 'update', 'use'
]);

export function lowerLeadingVerb(text = '') {
  const m = text.match(/^([A-Z][a-z]+)\b/);
  return m && LEADING_VERBS.has(m[1].toLowerCase()) ? m[1].toLowerCase() + text.slice(m[1].length) : text;
}

// Cut at a word boundary instead of mid-word.
export function truncateAtWord(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const i = cut.lastIndexOf(' ');
  return (i > 0 ? cut.slice(0, i) : text.slice(0, max)).replace(/[\s.,;:-]+$/, '');
}

// Wraps body text to `width` columns. Bullet lines ("- file: text") keep a hanging indent.
export function wrapBody(body = '', width = 72) {
  return String(body).split('\n').map((line) => {
    if (line.length <= width) return line;
    const lead = (/^(\s*[-*]\s+)/.exec(line) || [''])[0];
    const indent = ' '.repeat(lead.length);
    const words = line.slice(lead.length).split(/\s+/).filter(Boolean);
    const out = [];
    let cur = lead;
    let empty = true;
    for (const w of words) {
      if (!empty && cur.length + 1 + w.length > width) {
        out.push(cur);
        cur = indent + w;
      } else {
        cur += (empty ? '' : ' ') + w;
      }
      empty = false;
    }
    out.push(cur);
    return out.join('\n');
  }).join('\n');
}

export function formatCommitMessage({ type, scope, description, body, isBreaking, breakingDesc }) {
  const s = sanitizeScope(scope);
  const prefix = `${type}${s ? `(${s})` : ''}${isBreaking ? '!' : ''}: `;

  // Only ONE trailing "." is stripped (a rule of the header, not a rewrite of the text).
  let desc = String(description ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .trim();
  desc = lowerLeadingVerb(desc);
  desc = truncateAtWord(desc, Math.max(10, MAX_HEADER - prefix.length));

  let message = `${prefix}${desc}`;
  const bodyText = String(body ?? '').trim();
  if (bodyText) message += `\n\n${wrapBody(bodyText)}`;
  if (isBreaking && breakingDesc && breakingDesc.trim()) {
    message += `\n\nBREAKING CHANGE: ${breakingDesc.trim()}`;
  }
  return message;
}