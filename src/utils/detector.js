import path from 'path';
import chalk from 'chalk';

// Determines the type of change for a SINGLE file
function getFileType(filePath, diffText = '') {
  const p = filePath.toLowerCase();
  const lowerDiff = diffText.toLowerCase();

  if (p.endsWith('.md') || p.includes('docs/') || p.includes('license')) return 'docs';
  if (p.includes('test') || p.includes('spec') || p.includes('__tests__')) return 'test';
  if (p.endsWith('package.json') || p.endsWith('package-lock.json') || p.endsWith('.gitignore') || p.includes('.vscode/')) return 'chore';
  if (p.endsWith('.css') || p.endsWith('.scss')) return 'style';

  if (['fix', 'bug', 'error', 'issue', 'patch'].some(k => lowerDiff.includes(k))) return 'fix';
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

  // 1. Attempt Local AI Detection via Ollama
  if (diffText.trim().length > 0) {
    try {
      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.2',
          prompt: `Analyze this git diff and summarize the main code/feature change in 3 to 8 words using imperative mood (e.g. "add user login authentication" or "fix null pointer error"). Do not include quotes, markdown, or punctuation:\n\n${diffText.slice(0, 4000)}`,
          stream: false
        }),
        signal: AbortSignal.timeout(15000)
      });

if (response.ok) {
        const data = await response.json();
        const aiDescription = data.response?.trim().toLowerCase();
        
        if (aiDescription) {
           const cleaned = aiDescription.replace(/^adds\b/, 'add').replace(/^fixes\b/, 'fix');
           
           // Print debug log
           console.log(chalk.magenta(`🧠 [Ollama AI Active]: "${cleaned}"`));
           
           return cleaned;
        }
      }
      
    } catch (err) {
      // Fallback silently if Ollama times out
      console.log(chalk.red(`❌ [Ollama Error]: ${err.message}`));
    }
  }

  // 2. Local Regex Parsing (Fallback)
  const features = [];
  const lines = diffText.split('\n');

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const match = line.match(/(?:function|class|const|let|var)\s+([a-zA-Z_$][\w$]*)/);
      if (match && !['req', 'res', 'err', 'data'].includes(match[1])) {
        features.push(match[1]);
      }
    }
  }

  const uniqueFeatures = [...new Set(features)];
  if (uniqueFeatures.length > 0) {
    return `implement ${uniqueFeatures.slice(0, 2).join(' and ')} functionality`;
  }

  // 3. Basic File Action Fallback
  if (files.length === 1) {
    const filename = path.basename(files[0].path);
    return `update ${filename}`;
  }

  return `update ${files.length} project files`;
}//refactor: clean up logic