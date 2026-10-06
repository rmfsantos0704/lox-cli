import { simpleGit } from 'simple-git';

const git = simpleGit();

export async function getGitStatus() {
  try {
    return await git.status();
  } catch (error) {
    console.error('Error fetching git status:', error.message);
    process.exit(1);
  }
}

export async function getGitDiff() {
  try {
    return await git.diff();
  } catch (error) {
    return '';
  }
}

// NEW: Accepts an array of specific file paths to stage and commit independently
export async function commitSpecificFiles(filePaths, message) {
  try {
    await git.add(filePaths);
    await git.commit(message);
    return true;
  } catch (error) {
    console.error('Git commit failed:', error.message);
    return false;
  }
}

export async function getCurrentBranch() {
  try {
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    return branch.trim();
  } catch (error) {
    return '';
  }
}