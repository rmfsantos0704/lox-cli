import chalk from 'chalk';
import inquirer from 'inquirer';
import { getGitStatus, getGitDiff, getGitDiffStat, getCurrentBranch, commitSpecificFiles } from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import { runChecks } from '../utils/checker.js';
import { groupFilesByType, detectScope, generateDescription, validateCommitHeader, sanitizeCommitHeader } from '../utils/detector.js';
import { formatCommitMessage } from '../utils/formatter.js';


export async function commitCommand(options = {}) {
  const status = await getGitStatus();
  let filesToProcess = status.files;

  if (filesToProcess.length === 0) {
    console.log(chalk.yellow('No changes detected to commit.'));
    return;
  }

  if (options.interactive) {
    const choices = filesToProcess.map(f => ({ name: `${f.status} ${f.path}`, value: f, checked: true }));
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

  if (filesToProcess.length === 0) {
    console.log(chalk.yellow('No files selected for commit.'));
    return;
  }

  const config = getConfig();
  if (config.runPreCommitChecks && config.checkCommand) {
    const passed = await runChecks(config.checkCommand);
    if (!passed) {
      console.log(chalk.red.bold('Commit aborted due to failing checks.'));
      process.exit(1);
    }
  }

  const branchName = await getCurrentBranch();
  const branchMatch = branchName.match(/^(feat|fix|docs|style|refactor|test|chore)\/([^/]+)/);
  const branchType = branchMatch ? branchMatch[1] : null;
  const branchScope = branchMatch ? branchMatch[2] : null;

  const groupedFiles = groupFilesByType(filesToProcess);
  const groupCount = Object.keys(groupedFiles).length;

  console.log(chalk.cyan(`\n🤖 Auto-detected ${groupCount} different commit group(s). Preparing commits...\n`));

  for (const [groupKey, files] of Object.entries(groupedFiles)) {
    const detectedType = groupKey.split(':')[0]; // e.g., 'fix:backend' -> 'fix'
    
    console.log(chalk.bgMagenta.bold(`\n --- Committing [${groupKey}] Changes --- `));
    files.forEach(f => console.log(chalk.gray(`   • ${f.path}`)));

    const groupFilePaths = files.map(f => f.path);
    const groupDiff = await getGitDiff(groupFilePaths);
    const groupStat = await getGitDiffStat(groupFilePaths);

    // Apply branch scope only if the branch type matches this group's type
    const defaultType = branchType === detectedType ? branchType : detectedType;
    const defaultScope = (branchType === detectedType && branchScope) ? branchScope : detectScope(files);
    const defaultDescription = await generateDescription(files, groupDiff, groupStat);

    const answers = await inquirer.prompt([
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
          { name: 'chore:    Changes to the build process or auxiliary tools', value: 'chore' },
          { name: 'perf:     A code change that improves performance', value: 'perf' },
          { name: 'build:    Changes that affect the build system or external dependencies', value: 'build' },
          { name: 'ci:       Changes to CI configuration files and scripts', value: 'ci' }
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
        validate: (input) => input.length > 0 ? true : 'Breaking change description required.'
      }
    ]);

    // Sanitize and validate header before format
    const scopeStr = answers.scope ? `(${answers.scope.trim().toLowerCase()})` : '';
    const breakingMark = answers.isBreaking ? '!' : '';
    let rawHeader = `${answers.type}${scopeStr}${breakingMark}: ${answers.description}`;
    let finalHeader = sanitizeCommitHeader(rawHeader);

    const validation = validateCommitHeader(finalHeader);
    if (!validation.valid) {
      console.log(chalk.yellow(`⚠️ Header warning: ${validation.reason}`));
      if (finalHeader.length > 72) {
        const prefixLen = (`${answers.type}${scopeStr}${breakingMark}: `).length;
        const maxDescLen = 72 - prefixLen;
        answers.description = answers.description.slice(0, maxDescLen).trim();
      }
    }

    const commitMsg = formatCommitMessage(answers);
    const result = await commitSpecificFiles(groupFilePaths, commitMsg);

    if (result.ok) {
      console.log(chalk.green(`✔ Committed: "${commitMsg.split('\n')[0]}"`));
    } else {
      console.log(chalk.red(`✖ Failed to commit: ${result.error}`));
    }
  }

  console.log(chalk.green.bold('\n🎉 All isolated changes committed successfully!'));
}