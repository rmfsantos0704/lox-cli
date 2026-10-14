import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { getConfig } from './config.js';

// Strict & safe path classification
function getFileType(filePath, diffText = '', status = '') {
  const p = filePath.toLowerCase();

  // 1. Path-based overrides with precise boundary checks
  if (/(^|\/)(__tests__|tests?|spec)\//.test(p) || /\.(test|spec)\.[jt]sx?$/.test(p)) return 'test';
  if (/(^|\/)docs?\//.test(p) || p.endsWith('.md') || p.includes('license')) return 'docs';
  if (p.endsWith('package.json') || p.endsWith('package-lock.json') || p.endsWith('pnpm-lock.yaml') || p.endsWith('yarn.lock') || p.endsWith('.gitignore') || p.includes('.vscode/')) return 'chore';
  if (/\.(css|scss|sass|less)$/.test(p)) return 'style';

  // 2. Status-based overrides
  if (status.includes('D')) return 'refactor';

  // Comment-only detection (ignoring markdown bullet lines)
  const cleanDiff = diffText.replace(/\r/g, '');
  const lines = cleanDiff.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  
  if (lines.length > 0 && lines.every(l => /^[+-]\s*(\/\/|\/\*|\*\/|\*|<!--|#)/.test(l))) {
    if (!p.endsWith('.md')) return 'chore';
  }

  if (status.includes('A') || status.includes('?')) return 'feat';

  // 3. Diff content heuristics (analyzing added/removed lines only)
  const addedOrRemoved = lines.join('\n').toLowerCase();
  if (/\b(fix|bug|patch|issue|crash|resolves)\b/.test(addedOrRemoved)) return 'fix';
  if (/\b(refactor|rename|clean|restructure)\b/.test(addedOrRemoved)) return 'refactor';

  return 'feat';
}

function getFileDomain(filePath) {
  const parts = filePath.split(/[\/\\]/);
  if (parts.length > 1) {
    const rootDir = parts[0].toLowerCase();
    if (['backend', 'server', 'api'].includes(rootDir)) return 'backend';
    if (['frontend', 'client', 'web', 'ui'].includes(rootDir)) return 'frontend';
  }
  return 'root';
}

export function groupFilesByType(files = [], getDiffFor) {
  // We return groups structured by type or type:domain
  const groups = {};
  
  // To keep it clean and asynchronous if needed, we process synchronously using pre-fetched or basic rules
  files.forEach(file => {
    const type = getFileType(file.path, '', file.status);
    const domain = getFileDomain(file.path);

    let groupKey = type;
    // Only split backend vs frontend for code changes
    if (['feat', 'fix', 'refactor'].includes(type) && ['backend', 'frontend'].includes(domain)) {
      groupKey = `${type}:${domain}`;
    }

    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(file);
  });

  return groups;
}

export function detectScope(files = []) {
  if (files.length === 0) return '';
  if (files.length === 1) {
    const parsed = path.parse(files[0].path);
    if (parsed.dir === '' || parsed.dir === '.') return parsed.name.toLowerCase();
    const parts = parsed.dir.split(/[\/\\]/);
    return parts[parts.length - 1].toLowerCase();
  }

  // Find longest common directory name among files
  const filePartsList = files.map(f => f.path.split(/[\/\\]/));
  let commonPrefix = [];
  const first = filePartsList[0];

  for (let i = 0; i < first.length - 1; i++) {
    const segment = first[i];
    if (filePartsList.every(parts => parts[i] === segment)) {
      commonPrefix.push(segment);
    } else {
      break;
    }
  }

  if (commonPrefix.length > 0) {
    const lastCommon = commonPrefix[commonPrefix.length - 1];
    if (!['src', 'app', 'lib', '.'].includes(lastCommon)) {
      return lastCommon.toLowerCase();
    }
  }

  return '';
}

export function validateCommitHeader(header) {
  if (!header || typeof header !== 'string') return { valid: false, reason: 'Header cannot be empty.' };
  if (header.length > 72) return { valid: false, reason: `Exceeds 72-character limit (${header.length}/72).` };
  if (header.endsWith('.')) return { valid: false, reason: 'Contains a trailing period.' };

  // Conventional commit regex supporting standard types, scopes, breaking change !, and descriptions
  const conventionalRegex = /^(feat|fix|docs|style|refactor|test|chore|perf|build|ci|revert)(\([a-z0-9_-]+\))?!?: .+$/;
  if (!conventionalRegex.test(header)) {
    return { valid: false, reason: 'Invalid format. Expected: type(scope): description' };
  }

  return { valid: true };
}

export function sanitizeCommitHeader(header) {
  let cleaned = header.trim();
  if (cleaned.endsWith('.')) cleaned = cleaned.slice(0, -1);

  // Capitalize/lowercase safety: lowercase only the first letter of the description to protect identifiers like parseJSON
  const colonIdx = cleaned.indexOf(':');
  if (colonIdx !== -1) {
    const prefix = cleaned.slice(0, colonIdx + 1);
    let desc = cleaned.slice(colonIdx + 1).trim();
    if (desc.length > 0) {
      desc = desc.charAt(0).toLowerCase() + desc.slice(1);
    }
    cleaned = `${prefix} ${desc}`;
  }
  return cleaned;
}

export async function generateDescription(files = [], diffText = '', diffStat = '') {
  if (files.length === 0) return 'update project files';

  const isDeletionGroup = files.every(f => f.status.includes('D'));
  if (isDeletionGroup) {
    const names = files.map(f => path.basename(f.path)).join(', ');
    return files.length === 1 ? `remove ${names}` : 'remove obsolete files';
  }

  const cleanDiff = diffText.replace(/\r/g, '');
  const lines = cleanDiff.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));

  if (lines.length > 0 && lines.every(l => /^[+-]\s*(\/\/|\/\*|\*\/|\*|<!--|#)/.test(l))) {
    return 'update inline comments';
  }

  const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.exe', '.bin', '.tar', '.gz', '.mp4', '.mp3'];
  if (files.length === 1 && binaryExtensions.some(ext => files[0].path.toLowerCase().endsWith(ext))) {
    return 'update binary assets';
  }

  // AI Generation via Ollama
  if (cleanDiff.trim().length > 0 || diffStat.trim().length > 0) {
    let selectedModel = 'llama3.2';
    try {
      const config = getConfig();
      if (config?.model) selectedModel = config.model;
    } catch {}

    console.log(chalk.gray(`\n⏳ [AI Active (${selectedModel})]: Analyzing changes...`));

    const contextPrompt = diffStat.trim()
      ? `Summary:\n${diffStat}\n\nDiff Snippet:\n${cleanDiff.slice(0, 1200)}`
      : `Diff:\n${cleanDiff.slice(0, 2500)}`;

    try {
      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          prompt: `You are an expert developer. Summarize the code changes in imperative mood, max 7-8 words, lowercase description, output ONLY the text.
Example: update logger implementation in api module
Changes:
${contextPrompt}
Output:`,
          stream: false,
          options: { temperature: 0, num_predict: 40 }
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (response.ok) {
        const data = await response.json();
        let aiDesc = data.response?.trim();
        if (aiDesc) {
          // Clean model prefixes like "feat: " or quotes
          aiDesc = aiDesc.replace(/^(feat|fix|docs|style|refactor|test|chore)(\([^)]+\))?!?:?\s*/i, '');
          aiDesc = aiDesc.replace(/^["'`]+|["'`]+$/g, '').trim().toLowerCase();

          if (aiDesc.includes('binary file') || aiDesc.includes('ignore')) {
            return `update ${path.basename(files[0].path)}`;
          }

          console.log(chalk.magenta(`🧠 [Ollama AI Active (${selectedModel})]: "${aiDesc}"`));
          return aiDesc;
        }
      }
    } catch {
      console.log(chalk.yellow(`⚠️ AI detection skipped (Ollama offline or timed out)`));
    }
  }

  return files.length === 1 ? `update ${path.basename(files[0].path)}` : `update ${files.length} project files`;
}