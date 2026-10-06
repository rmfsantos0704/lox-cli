import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import chalk from 'chalk';

const execAsync = util.promisify(exec);

// Loads settings from .loxrc.json if it exists
export function getConfig() {
  const configPath = path.join(process.cwd(), '.loxrc.json');
  const defaultConfig = {
    runPreCommitChecks: false,
    checkCommand: 'npm run lint'
  };

  if (fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      return { ...defaultConfig, ...JSON.parse(fileContent) };
    } catch (error) {
      console.log(chalk.red('⚠ Failed to parse .loxrc.json. Using defaults.'));
    }
  }
  return defaultConfig;
}

// Executes the command defined in the config
export async function runChecks(command) {
  try {
    console.log(chalk.blue(`\n⏳ Running pre-commit checks: ${command}...`));
    await execAsync(command);
    console.log(chalk.green('✔ Checks passed!\n'));
    return true;
  } catch (error) {
    console.log(chalk.red(`\n✖ Checks failed!\n${error.stdout || error.message}`));
    return false;
  }
}