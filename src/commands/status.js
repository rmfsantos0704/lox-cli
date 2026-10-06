import chalk from 'chalk';
import { getGitStatus } from '../utils/git.js';

export async function statusCommand() {
  const status = await getGitStatus();
  console.log(chalk.bold('\n--- LOX Project Status ---'));
  console.log(chalk.blue(`Current Branch: ${status.current}`));

  if (status.files.length === 0) {
    console.log(chalk.green('Working tree clean. No changes detected.\n'));
    return;
  }

  console.log(chalk.yellow('\nChanged Files:'));
  status.files.forEach(file => {
    console.log(`  - ${file.path} [${file.working_dir || file.index}]`);
  });
  console.log('');
}