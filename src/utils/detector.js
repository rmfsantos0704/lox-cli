import path from 'path';
import chalk from 'chalk';

// Determines the type of change for a SINGLE file
function getFileType(filePath, diffText = '', status = '') {
  const p = filePath.toLowerCase();
  const lowerDiff = diffText.toLowerCase();

  // 1. Path-based overrides (highest priority)
  if (p.endsWith('.md') || p.includes('docs/') || p.includes('license')) return 'docs';
  if (p.includes('test') || p.includes('spec') || p.includes('__tests__')) return 'test';
  if (p.endsWith('package.json') || p.endsWith('package-lock.json') || p.endsWith('.gitignore') || p.includes('.vscode/')) return 'chore';
  if (p.endsWith('.css') || p.endsWith('.scss')) return 'style';

  // 2. Status-based overrides
  // If the file is newly added (A) or untracked (?), default to 'feat' instead of scanning for fix/refactor keywords
  if (status.includes('A') || status.includes('?')) return 'feat';

  // 3. Diff-based heuristics (for modified files)
  // Use regex word boundaries (\b) so "prefix" doesn't trigger "fix". Removed "error" as it flags standard try/catch blocks.
  if (/\b(fix|bug|patch|issue)\b/.test(lowerDiff)) return 'fix';
  if (/\b(refactor|rename|clean)\b/.test(lowerDiff)) return 'refactor';

  return 'feat';
}

// Groups an array of git status files into buckets based on their detected type
export function groupFilesByType(files = [], diffText = '') {
  const groups = {};
  files.forEach(file => {
    // Pass the git status indicator into the detection logic
    const type = getFileType(file.path, diffText, file.status);
    if (!groups[type]) groups[type] = [];
    groups[type].push(file);
  });
  return groups;
}

export function detectScope(files = []) {
  if (files.length === 0) return '';
  const names = files.map(f => path.parse(f.path).name);
  if (names.length === 1) return names[0];
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}

export async function generateDescription(files = [], diffText = '') {
  if (files.length === 0) return 'update project files';

  // Check if all files in this group are deletions
  const isDeletionGroup = files.every(f => f.status.includes('D'));
  if (isDeletionGroup) {
    const names = files.map(f => path.basename(f.path)).join(', ');
    if (files.length === 1) return `remove ${names}`;
    return `remove obsolete files`;
  }

  // 1. Attempt Local AI Detection via Ollama
  if (diffText.trim().length > 0) {
    try {
      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.2',
          prompt: `Analyze this git diff (note: lines starting with '-' are deletions) and summarize the change in 3 to 8 words using imperative mood (e.g. "remove deprecated utility" or "add user login"). Do not include quotes, markdown, or punctuation:\n\n${diffText.slice(0, 4000)}`,
          stream: false
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (response.ok) {
        const data = await response.json();
        const aiDescription = data.response?.trim().toLowerCase();
        
        if (aiDescription) {
           const cleaned = aiDescription.replace(/^adds\b/, 'add').replace(/^fixes\b/, 'fix').replace(/^removes\b/, 'remove');
           console.log(chalk.magenta(`🧠 [Ollama AI Active]: "${cleaned}"`));
           return cleaned;
        }
      }
    } catch (err) {
      // Fallback silently
    }
  }

  // ... rest of fallback logic stays the same ...
  if (files.length === 1) {
    const filename = path.basename(files[0].path);
    return `update ${filename}`;
  }

  return `update ${files.length} project files`;
}
