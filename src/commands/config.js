import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

const CONFIG_PATH = path.join(process.cwd(), '.loxrc.json');

export async function configCommand() {
  let currentConfig = { model: 'llama3.2', runChecks: true };

  try {
    const file = await fs.readFile(CONFIG_PATH, 'utf8');
    currentConfig = JSON.parse(file);
  } catch (err) {
    // No config exists yet, use defaults
  }

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'model',
      message: 'Which local Ollama model should LOX use?',
      choices: ['llama3.2', 'mistral', 'phi3', 'codellama'],
      default: currentConfig.model
    },
    {
      type: 'confirm',
      name: 'runChecks',
      message: 'Run pre-commit checks (e.g., linter, tests) before committing?',
      default: currentConfig.runChecks
    }
  ]);

  await fs.writeFile(CONFIG_PATH, JSON.stringify(answers, null, 2));
  console.log(chalk.cyan(`\n⚙️ Configuration saved to ${CONFIG_PATH}`));
}

export function configCommand() {}