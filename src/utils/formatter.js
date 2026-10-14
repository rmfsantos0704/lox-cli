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

// "Add x" -> "add x", but leave "API", "JSON", "parseJSON", "README" untouched.
export function lowerFirst(text = '') {
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

// Cut at a word boundary instead of mid-word.
export function truncateAtWord(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const i = cut.lastIndexOf(' ');
  return (i > 0 ? cut.slice(0, i) : text.slice(0, max)).replace(/[\s.,;:-]+$/, '');
}

export function formatCommitMessage({ type, scope, description, isBreaking, breakingDesc }) {
  const s = sanitizeScope(scope);
  const prefix = `${type}${s ? `(${s})` : ''}${isBreaking ? '!' : ''}: `;

  let desc = String(description ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '');
  desc = lowerFirst(desc);
  desc = truncateAtWord(desc, Math.max(10, MAX_HEADER - prefix.length));

  let message = `${prefix}${desc}`;
  if (isBreaking && breakingDesc && breakingDesc.trim()) {
    message += `\n\nBREAKING CHANGE: ${breakingDesc.trim()}`;
  }
  return message;
}