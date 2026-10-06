import path from 'path';

export function detectCommitType(files = [], diffText = '') {
  if (files.length === 0) return 'chore';

  const filePaths = files.map(file => file.path.toLowerCase());

  const isDocs = filePaths.every(p => p.endsWith('.md') || p.includes('docs/') || p === 'license');
  if (isDocs) return 'docs';

  const isTest = filePaths.every(p => p.includes('test') || p.includes('spec') || p.includes('__tests__'));
  if (isTest) return 'test';

  const isChore = filePaths.every(p =>
    p.endsWith('package.json') ||
    p.endsWith('package-lock.json') ||
    p.endsWith('.gitignore') ||
    p.includes('.vscode/')
  );
  if (isChore) return 'chore';

  const isStyle = filePaths.every(p => p.endsWith('.css') || p.endsWith('.scss'));
  if (isStyle) return 'style';

  const lowerDiff = diffText.toLowerCase();
  if (['fix', 'bug', 'error', 'issue'].some(k => lowerDiff.includes(k))) return 'fix';
  if (['refactor', 'rename', 'clean'].some(k => lowerDiff.includes(k))) return 'refactor';

  return 'feat';
}

// Automatically detects scope based on modified files/folders
export function detectScope(files = []) {
  if (files.length === 0) return '';

  const paths = files.map(f => f.path);

  // Single file change: use filename without extension
  if (paths.length === 1) {
    const parsed = path.parse(paths[0]);
    return parsed.name;
  }

  // Multiple files in the same directory: use directory name
  const dirs = paths.map(p => path.dirname(p)).filter(d => d !== '.');
  if (dirs.length > 0 && dirs.every(d => d === dirs[0])) {
    return path.basename(dirs[0]);
  }

  return 'multi';
}

// Auto-generates a default summary description
export function generateDescription(files = []) {
  if (files.length === 0) return 'update project files';

  if (files.length === 1) {
    const file = files[0];
    const filename = path.basename(file.path);

    if (file.index === 'A' || file.working_dir === '?') {
      return `add ${filename}`;
    }
    if (file.index === 'D' || file.working_dir === 'D') {
      return `remove ${filename}`;
    }
    return `update ${filename}`;
  }

  const modifiedCount = files.filter(f => f.working_dir === 'M' || f.index === 'M').length;
  const addedCount = files.filter(f => f.working_dir === '?' || f.index === 'A').length;

  const summary = [];
  if (addedCount > 0) summary.push(`add ${addedCount} file(s)`);
  if (modifiedCount > 0) summary.push(`update ${modifiedCount} file(s)`);

  return summary.join(' and ') || `update ${files.length} files`;
}