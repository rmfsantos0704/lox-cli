import path from 'path';

export function detectCommitType(files = [], diffText = '') {
  if (files.length === 0) return ['chore'];

  const types = new Set();
  const filePaths = files.map(file => file.path.toLowerCase());
  const lowerDiff = diffText.toLowerCase();

  // 1. Documentation
  if (filePaths.some(p => p.endsWith('.md') || p.includes('docs/') || p.includes('license'))) {
    types.add('docs');
  }

  // 2. Tests
  if (filePaths.some(p => p.includes('test') || p.includes('spec') || p.includes('__tests__'))) {
    types.add('test');
  }

  // 3. Tooling / Config
  if (filePaths.some(p => p.endsWith('package.json') || p.endsWith('package-lock.json') || p.endsWith('.gitignore') || p.includes('.vscode/'))) {
    types.add('chore');
  }

  // 4. Styling
  if (filePaths.some(p => p.endsWith('.css') || p.endsWith('.scss'))) {
    types.add('style');
  }

  // 5. Bug Fixes (via Diff analysis)
  if (['fix', 'bug', 'error', 'issue'].some(k => lowerDiff.includes(k))) {
    types.add('fix');
  }

  // 6. Refactoring (via Diff analysis)
  if (['refactor', 'rename', 'clean'].some(k => lowerDiff.includes(k))) {
    types.add('refactor');
  }

  // 7. Feature (If source files were modified, or as a default if nothing else matched)
  const hasSourceCode = filePaths.some(p => p.endsWith('.js') || p.endsWith('.ts') || p.endsWith('.jsx') || p.endsWith('.html') || p.endsWith('.py'));
  if (hasSourceCode || types.size === 0) {
    types.add('feat');
  }

  return Array.from(types); // Returns an array like ['feat', 'docs']
}
// Generates specific scopes from changed filenames
export function detectScope(files = []) {
  if (files.length === 0) return '';

  const fileNames = files.map(f => path.parse(f.path).name);

  if (fileNames.length === 1) {
    return fileNames[0];
  }

  // Up to 3 files: list them explicitly (e.g., "index, README, detector")
  if (fileNames.length <= 3) {
    return fileNames.join(', ');
  }

  // More than 3 files: list the first 2 and show the remaining count
  return `${fileNames.slice(0, 2).join(', ')} +${fileNames.length - 2} more`;
}



// New Helper: Scans git diff for newly added functions, classes, or components
function extractFeaturesFromDiff(diffText) {
  const addedFeatures = [];
  const lines = diffText.split('\n');

  for (const line of lines) {
    // Only look at added lines in the diff
    if (line.startsWith('+') && !line.startsWith('+++')) {
      // 1. Detect standard functions or classes (e.g., "function calculateTax()" or "class User")
      const funcClassMatch = line.match(/(?:function|class)\s+([a-zA-Z_$][\w$]*)/);
      if (funcClassMatch) addedFeatures.push(funcClassMatch[1]);

      // 2. Detect Arrow Functions / React Components (e.g., "const Button = () =>")
      const arrowMatch = line.match(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/);
      if (arrowMatch) addedFeatures.push(arrowMatch[1]);
    }
  }

  // Return unique feature names
  return [...new Set(addedFeatures)];
}

// Updated Description Generator using Diff Analysis
export function generateDescription(files = [], diffText = '') {
  if (files.length === 0) return 'update project files';

  // Extract the specific code features added in this commit
  const features = extractFeaturesFromDiff(diffText);

  // If specific features (functions/classes) were detected, use them!
  if (features.length > 0) {
    if (features.length === 1) {
      return `implement ${features[0]} feature`;
    }
    if (features.length <= 3) {
      return `add ${features.join(', ')} logic`;
    }
    return `add ${features.slice(0, 2).join(', ')} and ${features.length - 2} other features`;
  }

  // Fallback to file-level tracking if no clear functions/classes were found
  const getActionForFile = (file) => {
    const filename = path.basename(file.path);
    if (file.index === 'A' || file.working_dir === '?') return `add ${filename}`;
    if (file.index === 'D' || file.working_dir === 'D') return `remove ${filename}`;
    return `update ${filename}`;
  };

  if (files.length === 1) return getActionForFile(files[0]);
  
  if (files.length <= 3) {
    const actions = files.map(getActionForFile);
    const lastAction = actions.pop();
    return `${actions.join(', ')} and ${lastAction}`;
  }

  const actions = files.map(getActionForFile);
  const firstTwo = actions.slice(0, 2).join(', ');
  return `${firstTwo} and ${files.length - 2} other files`;
}
// Determines the type of change for a SINGLE file
function getFileType(filePath, diffText = '') {
  const p = filePath.toLowerCase();
  const lowerDiff = diffText.toLowerCase();

  if (p.endsWith('.md') || p.includes('docs/') || p.includes('license')) return 'docs';
  if (p.includes('test') || p.includes('spec') || p.includes('__tests__')) return 'test';
  if (p.endsWith('package.json') || p.endsWith('package-lock.json') || p.endsWith('.gitignore') || p.includes('.vscode/')) return 'chore';
  if (p.endsWith('.css') || p.endsWith('.scss')) return 'style';

  if (['fix', 'bug', 'error', 'issue'].some(k => lowerDiff.includes(k))) return 'fix';
  if (['refactor', 'rename', 'clean'].some(k => lowerDiff.includes(k))) return 'refactor';

  return 'feat';
}

// Groups an array of git status files into buckets based on their detected type
export function groupFilesByType(files = [], diffText = '') {
  const groups = {};
  files.forEach(file => {
    const type = getFileType(file.path, diffText);
    if (!groups[type]) groups[type] = [];
    groups[type].push(file);
  });
  return groups; // Returns e.g., { docs: [file1], feat: [file2, file3] }
}