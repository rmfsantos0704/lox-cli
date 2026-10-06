import inquirer from 'inquirer';
import chalk from 'chalk';
import { formatCommitMessage } from '../utils/formatter.js';
import { commitChanges, getGitStatus, getGitDiff } from '../utils/git.js';
import { detectCommitType, detectScope, generateDescription } from '../utils/detector.js';

export async function commitCommand() {
  const status = await getGitStatus();

  if (status.files.length === 0) {
    console.log(chalk.yellow('No changes detected to commit.'));
    return;
  }

  const diff = await getGitDiff();

  // Run auto-detections
  const detectedType = detectCommitType(status.files, diff);
  const detectedScope = detectScope(status.files);
  const detectedDescription = generateDescription(status.files);

  console.log(chalk.cyan(`\n🤖 Auto-detected suggestions:`));
  console.log(`   Type:        ${chalk.bold.green(detectedType)}`);
  console.log(`   Scope:       ${chalk.bold.green(detectedScope || '(none)')}`);
  console.log(`   Description: ${chalk.bold.green(detectedDescription)}\n`);

  const commitPrompts = [
    {
      type: 'select',
      name: 'type',
      message: 'Select the type of change you are committing:',
      default: detectedType,
      choices: [
        { name: 'feat:     A new feature', value: 'feat' },
        { name: 'fix:      A bug fix', value: 'fix' },
        { name: 'docs:     Documentation only changes', value: 'docs' },
        { name: 'style:    Changes that do not affect the meaning of the code', value: 'style' },
        { name: 'refactor: A code change that neither fixes a bug nor adds a feature', value: 'refactor' },
        { name: 'test:     Adding missing tests or correcting existing tests', value: 'test' },
        { name: 'chore:    Changes to the build process or auxiliary tools', value: 'chore' }
      ]
    },
    {
      type: 'input',
      name: 'scope',
      message: 'Enter the scope of this change [optional]:',
      default: detectedScope
    },
    {
      type: 'input',
      name: 'description',
      message: 'Write a short description of the change:',
      default: detectedDescription,
      validate: (input) => input.length > 0 ? true : 'Description cannot be empty.'
    }
  ];

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