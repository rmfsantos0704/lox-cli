import inquirer from 'inquirer';
import chalk from 'chalk';
import { commitPrompts } from '../utils/prompts.js';
import { formatCommitMessage } from '../utils/formatter.js';
import { commitChanges, getGitStatus } from '../utils/git.js';

export async function commitCommand() {
  const status = await getGitStatus();

  if (status.files.length === 0) {
    console.log(chalk.yellow('No changes detected to commit.'));
    return;
  }

  const answers = await inquirer.prompt(commitPrompts);
  const commitMsg = formatCommitMessage(answers);

  console.log(chalk.cyan(`\nGenerated Commit Message: "${commitMsg}"\n`));

  const success = await commitChanges(commitMsg);
  if (success) {
    console.log(chalk.green('✔ Changes staged and committed successfully!'));
  } else {
    console.log(chalk.red('✖ Failed to commit changes.'));
  }
}