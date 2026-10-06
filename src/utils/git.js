import { simpleGit } from 'simple-git';

const git = simpleGit();

export async function getGitStatus() {
  try {
    const status = await git.status();
    return status;
  } catch (error) {
    console.error('Error fetching git status:', error.message);
    process.exit(1);
  }
}

export async function getGitDiff() {
  try {
    const diff = await git.diff();
    return diff;
  } catch (error) {
    console.error('Error fetching git diff:', error.message);
    return '';
  }
}

export async function commitChanges(message) {
  try {
    await git.add('.');
    await git.commit(message);
    return true;
  } catch (error) {
    console.error('Git commit failed:', error.message);
    return false;
  }
}