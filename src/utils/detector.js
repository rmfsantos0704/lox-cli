import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

// Determines the type of change for a SINGLE file
function getFileType(filePath, diffText = '', status = '') {
  const p = filePath.toLowerCase();

  // 1. Path-based overrides (highest priority)
  if (p.endsWith('.md') || p.includes('docs/') || p.includes('license')) return 'docs';
  if (p.includes('test') || p.includes('spec') || p.includes('__tests__')) return 'test';
  if (p.endsWith('package.json') || p.endsWith('package-lock.json') || p.endsWith('.gitignore') || p.includes('.vscode/')) return 'chore';
  if (p.endsWith('.css') || p.endsWith('.scss')) return 'style';

  // 2. Status-based overrides
  if (status.includes('D')) return 'refactor';

  // NEW: Comment-Only Detection
  // Extract actual changed lines, ignoring Git file headers (+++/---)
  const changedLines = diffText.split('\n').filter(line => 
    (line.startsWith('+') || line.startsWith('-')) && 
    !line.startsWith('+++') && !line.startsWith('---')
  );

  // If there are changes, and EVERY changed line is a comment, force 'chore'
  if (changedLines.length > 0 && changedLines.every(line => /^[+-]\s*(\/\/|\/\*|\*)/.test(line))) {
    return 'chore';
  }

  // Newly added files are features
  if (status.includes('A') || status.includes('?')) return 'feat';

  // 3. Diff-based heuristics for modified (M) files
  const lowerDiff = diffText.toLowerCase();
  if (/\b(fix|bug|patch|issue)\b/.test(lowerDiff)) return 'fix';
  if (/\b(refactor|rename|clean)\b/.test(lowerDiff)) return 'refactor';

  return 'feat';
}

// Groups an array of git status files into buckets based on their detected type
export function groupFilesByType(files = [], diffText = '') {
  const groups = {};
  files.forEach(file => {
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

// AI-powered feature description with Ollama and fallback
export async function generateDescription(files = [], diffText = '') {
  if (files.length === 0) return 'update project files';

  // 1. Check if all files in this group are deletions
  const isDeletionGroup = files.every(f => f.status.includes('D'));
  if (isDeletionGroup) {
    const names = files.map(f => path.basename(f.path)).join(', ');
    if (files.length === 1) return `remove ${names}`;
    return `remove obsolete files`;
  }

  // 2. Attempt Local AI Detection via Ollama
  if (diffText.trim().length > 0) {
    // Read user's config to check for upgraded model, fallback to llama3.2
    let selectedModel = 'llama3.2';
    try {
      const rcPath = path.join(process.cwd(), '.loxrc.json');
      if (fs.existsSync(rcPath)) {
        const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
        if (rc.model) selectedModel = rc.model;
      }
    } catch (e) {
      // Silently ignore config read errors and use default
    }

    // NEW: Visual indicator that AI processing has started
    console.log(chalk.gray(`\n⏳ [AI Active (${selectedModel})]: Analyzing code changes...`));

    try {
      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          prompt: `You are an expert developer writing commit descriptions. Summarize ONLY the code changes marked with '+' (additions) or '-' (deletions). Ignore all unmarked context lines.
Use imperative mood (e.g., "add", "fix", "update"), keep it under 8 words, and output ONLY the raw text.

Example 1:
Diff:
  function load() {
-   console.log("loading");
+   logger.info("loading module");
    return true;
  }
Output: update logger implementation in load function

Example 2:
Diff:
  const config = {
+   // update timeout to 5000ms
    timeout: 5000
  }
Output: update inline comments

Now process this diff:
Diff:
${diffText.slice(0, 4000)}
Output:`,
          stream: false
        }),
        signal: AbortSignal.timeout(30000) // Increased to 30 seconds for 7B models
      });

      if (response.ok) {
        const data = await response.json();
        const aiDescription = data.response?.trim().toLowerCase();
        
        if (aiDescription) {
           const cleaned = aiDescription
             .replace(/^adds\b/, 'add')
             .replace(/^fixes\b/, 'fix')
             .replace(/^removes\b/, 'remove')
             .replace(/^updates\b/, 'update');
             
           console.log(chalk.magenta(`🧠 [Ollama AI Active (${selectedModel})]: "${cleaned}"`));
           return cleaned;
        }
      }
    } catch (err) {
      // NEW: Catch block now alerts if it times out or Ollama is not running
      console.log(chalk.yellow(`⚠️ AI detection skipped (${err.name === 'AbortError' ? 'Timed out' : 'Ollama offline'})`));
    }
  }

  // 3. Basic File Action Fallback
  if (files.length === 1) {
    const filename = path.basename(files[0].path);
    return `update ${filename}`;
  }

  return `update ${files.length} project files`;
}