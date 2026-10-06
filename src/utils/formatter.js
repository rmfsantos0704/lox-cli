export function formatCommitMessage({ type, scope, description }) {
  const formattedScope = scope && scope.trim() !== '' ? `(${scope.trim()})` : '';
  return `${type}${formattedScope}: ${description.trim()}`;
}