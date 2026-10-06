import { exec } from 'child_process';
import util from 'util';
import chalk from 'chalk';

const execAsync = util.promisify(exec);

export async function runChecks(command) {
  if (!command) return true;

  console.log(chalk.cyan(`\n⏳ Running pre-commit checks: ${command}...`));

  try {
    await execAsync(command);
    console.log(chalk.green('✔ Checks passed!\n'));
    return true;
  } catch (error) {
    console.log(chalk.red('\n✖ Pre-commit check failed:'));
    if (error.stdout) console.log(chalk.gray(error.stdout));
    if (error.stderr) console.log(chalk.red(error.stderr));
    return false;
  }
}