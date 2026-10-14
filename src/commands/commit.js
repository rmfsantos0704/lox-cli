import chalk from 'chalk';
import inquirer from 'inquirer';
import { getGitStatus, getGitDiff, getGitDiffStat, getCurrentBranch, commitSpecificFiles } from '../utils/git.js';
import { getConfig } from '../utils/config.js';
import { runChecks } from '../utils/checker.js';
import { groupFilesByType, detectScope, generateDescription, validateCommitHeader } from '../utils/detector.js';
import { formatCommitMessage, sanitizeScope } from '../utils/formatter.js';

const BRANCH_TYPE_ALIASES = { feature: 'feat', bugfix: 'fix', hotfix: 'fix' };
const BRANCH_RE = /^(feat|feature|fix|bugfix|hotfix|docs|style|refactor|test|chore|perf|build|ci|revert)\/([^/]+)/;

const TYPE_CHOICES = [
  { name: 'feat:     A new feature', value: 'feat' },
  { name: 'fix:      A bug fix', value: 'fix' },
  { name: 'docs:     Documentation only changes', value: 'docs' },
  { name: 'style:    Changes that do not affect the meaning of the code', value: 'style' },
  { name: 'refactor: A code change that neither fixes a bug nor adds a feature', value: 'refactor' },
  { name: 'test:     Adding missing tests or correcting existing tests', value: 'test' },
  { name: 'chore:    Changes to the build process or auxiliary tools', value: 'chore' },
  { name: 'perf:     A code change that improves performance', value: 'perf' },
  { name: 'build:    Changes that affect the build system or external dependencies', value: 'build' },
  { name: 'ci:       Changes to CI configuration files and scripts', value: 'ci' },
  { name: 'revert:   Reverts a previous commit', value: 'revert' }
];

const label = (f) => `${f.status} ${f.origPath ? `${f.origPath} -> ` : ''}${f.path}`;

function loadConfig() {
  try {
    return getConfig() || {};
  } catch (err) {
    console.log(chalk.red(`✖ Could not read .loxrc.json: ${err.message}`));
    console.log(chalk.gray('  Using default settings instead.'));
    return {};
  }
}

export async function commitCommand(options = {}) {
  const status = await getGitStatus();

  if (status.error) {
    console.log(chalk.red(`✖ ${status.error}`));
    process.exitCode = 1;
    return;
  }

  if (status.conflicts.length > 0) {
    console.log(chalk.red('✖ Merge conflicts must be resolved before committing:'));
    status.conflicts.forEach(f => console.log(chalk.red(`   • ${f.path}`)));
    process.exitCode = 1;
    return;
  }

  let filesToProcess = status.files;

  if (filesToProcess.length === 0) {
    console.log(chalk.yellow('No changes detected to commit.'));
    return;
  }

  if (options.interactive) {
    const { selectedFiles } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedFiles',
        message: 'Select the files you want to include in this commit run:',
        choices: filesToProcess.map(f => ({ name: label(f), value: f, checked: true })),
        validate: (ans) => (ans.length > 0 ? true : 'You must select at least one file.')
      }
    ]);
    filesToProcess = selectedFiles;
  }

  if (filesToProcess.length === 0) {
    console.log(chalk.yellow('No files selected for commit.'));
    return;
  }

  const config = loadConfig();
  if (config.runPreCommitChecks && config.checkCommand) {
    const passed = await runChecks(config.checkCommand);
    if (!passed) {
      console.log(chalk.red.bold('Commit aborted due to failing checks.'));
      process.exit(1);
    }
  }

  // Branch name auto-detection (feat/login-page, feature/x, bugfix/y ...)
  const branchName = await getCurrentBranch();
  const branchMatch = branchName.match(BRANCH_RE);
  const branchType = branchMatch ? (BRANCH_TYPE_ALIASES[branchMatch[1]] || branchMatch[1]) : null;
  const branchScope = branchMatch ? sanitizeScope(branchMatch[2]) : '';

  // Each file is classified from ITS OWN diff.
  const groupedFiles = await groupFilesByType(filesToProcess, (file) => getGitDiff([file]));
  const groupCount = Object.keys(groupedFiles).length;

  console.log(chalk.cyan(`\n🤖 Auto-detected ${groupCount} different commit group(s). Preparing commits...\n`));

  let committed = 0;
  let failed = 0;
  let skipped = 0;

  for (const [groupKey, files] of Object.entries(groupedFiles)) {
    const detectedType = groupKey.split(':')[0]; // 'fix:backend' -> 'fix'

    console.log(chalk.bgMagenta.bold(`\n --- Committing [${groupKey}] Changes --- `));
    files.forEach(f => console.log(chalk.gray(`   • ${label(f)}`)));

    const groupDiff = await getGitDiff(files);
    const groupStat = await getGitDiffStat(files);

    // The branch scope only applies to groups of the branch's own type.
    const branchApplies = branchType === detectedType;
    const defaultScope = (branchApplies && branchScope) || detectScope(files);
    const defaultDescription = await generateDescription(files, groupDiff, groupStat);

    let defaults = { type: detectedType, scope: defaultScope, description: defaultDescription, isBreaking: false };
    let commitMsg = null;
    let skip = false;

    // Ask -> format -> validate the REAL header -> (edit | commit anyway | skip)
    while (commitMsg === null && !skip) {
      const answers = await inquirer.prompt([
        { type: 'select', name: 'type', message: 'Confirm the type of change:', default: defaults.type, choices: TYPE_CHOICES },
        { type: 'input', name: 'scope', message: 'Enter the scope of this change [optional]:', default: defaults.scope },
        {
          type: 'input',
          name: 'description',
          message: 'Write a short description of the change:',
          default: defaults.description,
          validate: (input) => (input.trim().length > 0 ? true : 'Description cannot be empty.')
        },
        { type: 'confirm', name: 'isBreaking', message: 'Does this commit introduce a breaking change?', default: defaults.isBreaking },
        {
          type: 'input',
          name: 'breakingDesc',
          message: 'Describe the breaking change:',
          when: (a) => a.isBreaking,
          validate: (input) => (input.trim().length > 0 ? true : 'Breaking change description required.')
        }
      ]);

      const message = formatCommitMessage(answers);
      const header = message.split('\n')[0];
      const validation = validateCommitHeader(header);

      if (validation.valid) {
        commitMsg = message;
        break;
      }

      console.log(chalk.yellow(`⚠️ Header warning: ${validation.reason}`));
      console.log(chalk.gray(`   "${header}"`));
      const { action } = await inquirer.prompt([
        {
          type: 'select',
          name: 'action',
          message: 'What now?',
          choices: [
            { name: 'Edit the message again', value: 'edit' },
            { name: 'Commit anyway', value: 'anyway' },
            { name: 'Skip this group', value: 'skip' }
          ]
        }
      ]);

      if (action === 'anyway') commitMsg = message;
      else if (action === 'skip') skip = true;
      else defaults = { ...answers, isBreaking: !!answers.isBreaking };
    }

    if (skip) {
      skipped++;
      console.log(chalk.yellow(`↷ Skipped [${groupKey}]. Those files are still uncommitted.`));
      continue;
    }

    const result = await commitSpecificFiles(files, commitMsg);
    if (result.ok) {
      committed++;
      console.log(chalk.green(`✔ Committed: "${commitMsg.split('\n')[0]}"`));
    } else {
      failed++;
      console.log(chalk.red(`✖ Failed to commit [${groupKey}]:`));
      console.log(chalk.red(`  ${String(result.error).split('\n').join('\n  ')}`));
    }
  }

  const parts = [`${committed} committed`];
  if (failed) parts.push(`${failed} failed`);
  if (skipped) parts.push(`${skipped} skipped`);

  if (failed) {
    process.exitCode = 1;
    console.log(chalk.yellow(`\nDone with problems: ${parts.join(', ')}.`));
  } else if (skipped) {
    console.log(chalk.yellow(`\nDone: ${parts.join(', ')}.`));
  } else {
    console.log(chalk.green.bold('\n🎉 All isolated changes committed successfully!'));
  }
}