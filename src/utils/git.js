import { exec } from 'child_process';
import util from 'util';

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

// Gets the code differences for specific files (or global if empty)
export async function getGitDiff(filePaths = []) {
  try {
    const target = filePaths.length > 0 ? `-- ${filePaths.map(p => `"${p}"`).join(' ')}` : '';
    const { stdout } = await execAsync(`git diff HEAD ${target}`);
    return stdout || '';
  } catch (err) {
    // Fallback if HEAD doesn't exist yet (initial commit)
    try {
      const target = filePaths.length > 0 ? `-- ${filePaths.map(p => `"${p}"`).join(' ')}` : '';
      const { stdout } = await execAsync(`git diff ${target}`);
      return stdout || '';
    } catch {
      return '';
    }
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