import { exec } from 'child_process';
import util from 'util';
import fs from 'fs/promises';

const execAsync = util.promisify(exec);

// Gets the list of modified, added, or deleted files
export async function getGitStatus() {
  try {
    const { stdout } = await execAsync('git status --porcelain');
    if (!stdout.trim()) return { files: [] };

    const files = stdout.split('\n').filter(Boolean).map(line => {
      // Parses porcelain output (e.g., " M src/index.js")
      const match = line.match(/^\s*([A-Z?]{1,2})\s+(.+)$/);
      if (match) {
        return { status: match[1], path: match[2] };
      }
      return null;
    }).filter(Boolean);

    return { files };
  } catch (error) {
    return { files: [] };
  }
}
export async function getGitDiff(filePaths = []) {
  try {
    const target = filePaths.length > 0 ? `-- ${filePaths.map(p => `"${p}"`).join(' ')}` : '';
    // This captures actual git changes, including deletions (shown as minus lines)
    const { stdout } = await execAsync(`git diff HEAD ${target}`);
    if (stdout.trim()) return stdout;

    // Fallback for untracked or newly added files
    if (filePaths.length > 0) {
      let combinedContent = '';
      for (const file of filePaths) {
        try {
          const content = await fs.readFile(file, 'utf8');
          combinedContent += `\n--- NEW FILE: ${file} ---\n${content}`;
        } catch (err) {
          // File likely deleted or doesn't exist on disk, mark it clearly for Ollama
          combinedContent += `\n--- DELETED FILE: ${file} ---\n`;
        }
      }
      return combinedContent;
    }
    
    return '';
  } catch (err) {
    return '';
  }
}

// Gets the current active Git branch
export async function getCurrentBranch() {
  try {
    const { stdout } = await execAsync('git branch --show-current');
    return stdout.trim();
  } catch {
    return 'main'; // Fallback branch name
  }
}

// Stages and commits only the specific files provided
export async function commitSpecificFiles(filePaths, commitMsg) {
  try {
    // 1. Unstage everything to ensure a clean slate
    await execAsync('git reset');
    
    // 2. Stage only the specific files in this group
    const paths = filePaths.map(p => `"${p}"`).join(' ');
    await execAsync(`git add ${paths}`);
    
    // 3. Commit with the generated message
    const escapedMsg = commitMsg.replace(/"/g, '\\"');
    await execAsync(`git commit -m "${escapedMsg}"`);
    return true;
  } catch (err) {
    return false;
  }
}