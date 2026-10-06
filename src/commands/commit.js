import chalk from 'chalk';
import inquirer from 'inquirer';
import { getGitStatus, getGitDiff, getCurrentBranch, commitSpecificFiles } from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import { runChecks } from '../utils/checker.js';
import { groupFilesByType, detectScope, generateDescription } from '../utils/detector.js';
import { formatCommitMessage } from '../utils/formatter.js';

export async function commitCommand(options = {}) {
  const status = await getGitStatus();
  let filesToProcess = status.files;
  if (options.interactive && filesToProcess.length > 0) {
    const choices = filesToProcess.map(f => ({
      name: `${f.status} ${f.path}`,
      value: f,
      checked: true 
    }));

    const { selectedFiles } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedFiles',
        message: 'Select the files you want to include in this commit run:',
        choices,
        validate: (ans) => ans.length > 0 ? true : 'You must select at least one file.'
      }
    ]);
    
    filesToProcess = selectedFiles;
  }

  if (status.files.length === 0) {
    console.log(chalk.yellow('No changes detected to commit.'));
    return;
  }

  // 1. Load Config & Run Checks
  const config = getConfig();
  if (config.runPreCommitChecks && config.checkCommand) {
    const passed = await runChecks(config.checkCommand);
    if (!passed) {
      console.log(chalk.red.bold('Commit aborted due to failing checks.'));
      process.exit(1);
    }
  }

  // 2. Branch Name Auto-Detection
  const branchName = await getCurrentBranch();
  const branchMatch = branchName.match(/^(feat|fix|docs|style|refactor|test|chore)\/([^/]+)/);
  const branchType = branchMatch ? branchMatch[1] : null;
  const branchScope = branchMatch ? branchMatch[2] : null;

  const globalDiff = await getGitDiff();
  const groupedFiles = groupFilesByType(status.files, globalDiff);
  const groupCount = Object.keys(groupedFiles).length;

  console.log(chalk.cyan(`\n🤖 Auto-detected ${groupCount} different type(s) of changes. Preparing separate commits...\n`));

  for (const [detectedType, files] of Object.entries(groupedFiles)) {
    console.log(chalk.bgMagenta.bold(`\n --- Committing [${detectedType}] Changes --- `));
    files.forEach(f => console.log(chalk.gray(`  • ${f.path}`)));

    // Extract file paths for this specific group
    const groupFilePaths = files.map(f => f.path);

    // Fetch an ISOLATED diff strictly for the files in this group
    const groupDiff = await getGitDiff(groupFilePaths);

    // Use branch-detected scope/type if available, otherwise fall back to file analysis
    const defaultType = branchType && branchType === detectedType ? branchType : detectedType;
    const defaultScope = branchScope || detectScope(files);

    // FIX: Await the async generateDescription call with the group-specific diff
    const defaultDescription = await generateDescription(files, groupDiff);

    const commitPrompts = [
      {
        type: 'select',
        name: 'type',
        message: 'Confirm the type of change:',
        default: defaultType,
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
        default: defaultScope
      },
      {
        type: 'input',
        name: 'description',
        message: 'Write a short description of the change:',
        default: defaultDescription,
        validate: (input) => input.length > 0 ? true : 'Description cannot be empty.'
      },
      {
        type: 'confirm',
        name: 'isBreaking',
        message: 'Does this commit introduce a breaking change?',
        default: false
      },
      {
        type: 'input',
        name: 'breakingDesc',
        message: 'Describe the breaking change:',
        when: (answers) => answers.isBreaking,
        validate: (input) => input.length > 0 ? true : 'You must provide a description for a breaking change.'
      }
    ];

    const answers = await inquirer.prompt(commitPrompts);
    const commitMsg = formatCommitMessage(answers);
    
    const success = await commitSpecificFiles(groupFilePaths, commitMsg);
    
    if (success) {
      console.log(chalk.green(`✔ Committed: "${commitMsg.split('\n')[0]}"`));
    } else {
      console.log(chalk.red(`✖ Failed to commit [${detectedType}] files.`));
    }
  }

  console.log(chalk.green.bold('\n🎉 All separated changes have been committed successfully!'));
}