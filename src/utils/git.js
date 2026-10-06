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

export async function commitChanges(message) {
  try {
    // Adds all modified and untracked files
    await git.add('.');
    // Commits with the generated conventional message
    await git.commit(message);
    return true;
  } catch (error) {
    console.error('Git commit failed:', error.message);
    return false;
  }
}