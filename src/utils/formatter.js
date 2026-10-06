export function formatCommitMessage({ type, scope, description, isBreaking, breakingDesc }) {
  const scopeStr = scope ? `(${scope.trim()})` : '';
  const breakingMarker = isBreaking ? '!' : '';
  let message = `${type}${scopeStr}${breakingMarker}: ${description.trim()}`;

  if (isBreaking && breakingDesc) {
    message += `\n\nBREAKING CHANGE: ${breakingDesc.trim()}`;
  }
  
  return message;
}