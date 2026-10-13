import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { getConfig } from '../utils/config.js';

export async function configCommand() {
  console.log(chalk.cyan('\n⚙️ LOX Configuration Wizard\n'));

  // 1. Dynamically fetch installed models from local Ollama instance
  let availableModels = ['llama3.2', 'qwen2.5:7b', 'llama3.1', 'mistral', 'phi3'];
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      if (data.models && data.models.length > 0) {
        availableModels = data.models.map(m => m.name);
      }
    }
  } catch (err) {
    // Fallback gracefully if Ollama is offline
  }

  // Add a manual input choice to the bottom of the list
  availableModels.push(new inquirer.Separator(), { name: '✏️ Type custom model name...', value: '__CUSTOM__' });

  const currentConfig = getConfig() || { model: 'llama3.2', runPreCommitChecks: false, checkCommand: 'npm run test' };

  const answers = await inquirer.prompt([
    {
      type: 'select',
      name: 'model',
      message: 'Select the AI model for this project:',
      default: currentConfig.model,
      choices: availableModels
    },
    {
      type: 'input',
      name: 'customModel',
      message: 'Enter your custom Ollama model name:',
      when: (ans) => ans.model === '__CUSTOM__',
      validate: (input) => input.trim().length > 0 ? true : 'Model name cannot be empty.'
    },
    {
      type: 'confirm',
      name: 'runPreCommitChecks',
      message: 'Run pre-commit checks (linters/tests) automatically?',
      default: currentConfig.runPreCommitChecks ?? false
    },
    {
      type: 'input',
      name: 'checkCommand',
      message: 'Enter the check command (e.g., npm run test):',
      when: (ans) => ans.runPreCommitChecks,
      default: currentConfig.checkCommand || 'npm run test'
    }
  ]);

  const finalModel = answers.model === '__CUSTOM__' ? answers.customModel : answers.model;

  const newConfig = {
    model: finalModel,
    runPreCommitChecks: answers.runPreCommitChecks,
    checkCommand: answers.checkCommand || currentConfig.checkCommand || 'npm run test'
  };

  // 2. Save .loxrc.json directly into the current project's root folder
  const rcPath = path.join(process.cwd(), '.loxrc.json');
  fs.writeFileSync(rcPath, JSON.stringify(newConfig, null, 2), 'utf8');

  console.log(chalk.green(`\n✔ Configuration saved successfully to .loxrc.json!`));
  console.log(chalk.gray(`   • Model: ${finalModel}`));
  console.log(chalk.gray(`   • Pre-commit checks: ${newConfig.runPreCommitChecks ? newConfig.checkCommand : 'Disabled'}\n`));
}