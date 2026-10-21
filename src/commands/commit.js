import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  getGitStatus, getGitDiff, getGitDiffStat, getCurrentBranch,
  commitSpecificFiles, commitStaged, readRepoFile, listRepoFiles,
  getStagedPaths, addPatch, resetPaths
} from '../utils/git.js';
import {
  findGroupDependencies, mergeGroups, orderGroups, findStrayUntracked, findCaseMismatches
} from '../utils/deps.js';
import { getConfig } from '../utils/config.js';
import { runChecks } from '../utils/checker.js';
import {
  groupFilesByType, detectScope, generateDescription, describeGroup, analyzeGroup, validateCommitHeader
} from '../utils/detector.js';
import { formatCommitMessage, sanitizeScope } from '../utils/formatter.js';

const BRANCH_TYPE_ALIASES = { feature: 'feat', bugfix: 'fix', hotfix: 'fix' };
const BRANCH_RE = /^(feat|feature|fix|bugfix|hotfix|docs|style|refactor|test|chore|perf|build|ci|revert)\/([^/]+)/;

// Used only when the model gives no answer: on a fix/ branch, plain code defaults to "fix".
const BRANCH_OVERRIDES = new Set(['fix', 'refactor', 'perf']);

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
const pathsOf = (files) => new Set(files.flatMap(f => [f.path, f.origPath].filter(Boolean)));

function loadConfig() {
  try {
    return getConfig() || {};
  } catch (err) {
    console.log(chalk.red(`✖ Could not read .loxrc.json: ${err.message}`));
    console.log(chalk.gray('  Using default settings instead.'));
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Checks on the groups before anything is committed                    */
/* ------------------------------------------------------------------ */

// New code files that nothing in this run imports: usually a scratch file or a
// forgotten import. The user decides whether to leave them out.
async function dropStrayFiles(groups) {
  const stray = await findStrayUntracked(groups, readRepoFile);
  if (stray.length === 0) return groups;

  console.log(chalk.yellow('⚠️ New files that nothing in this commit run imports:'));
  stray.forEach(f => console.log(chalk.yellow(`   • ${f.path}`)));

  const { leaveOut } = await inquirer.prompt([
    { type: 'confirm', name: 'leaveOut', message: 'Leave these files out of this commit run?', default: false }
  ]);
  if (!leaveOut) return groups;

  const drop = new Set(stray.map(f => f.path));
  const out = {};
  for (const [key, files] of Object.entries(groups)) {
    const kept = files.filter(f => !drop.has(f.path));
    if (kept.length) out[key] = kept;
  }
  return out;
}

// If one group imports a file that changes in another group, committing them
// separately (or in the wrong order) leaves a commit that can't run on its own.
async function resolveDependencies(groups) {
  if (Object.keys(groups).length < 2) return groups;

  const edges = await findGroupDependencies(groups, readRepoFile);
  if (edges.length === 0) return groups;

  console.log(chalk.yellow('⚠️ Some groups depend on files that are in a different group:'));
  const seen = new Set();
  for (const e of edges) {
    const id = `${e.from}>${e.to}`;
    if (seen.has(id)) continue;
    seen.add(id);
    console.log(chalk.yellow(`   • [${e.from}] ${e.file} imports ${e.imports} [${e.to}]`));
  }

  const { choice } = await inquirer.prompt([
    {
      type: 'select',
      name: 'choice',
      message: 'How should these be committed?',
      choices: [
        { name: 'Merge them into one commit (every commit works on its own)', value: 'merge' },
        { name: 'Keep separate commits, dependencies first', value: 'ordered' }
      ]
    }
  ]);

  if (choice === 'merge') return mergeGroups(groups, edges);

  const { groups: ordered, cyclic } = orderGroups(groups, edges);
  if (cyclic.length > 0) {
    console.log(chalk.yellow(`   Import cycle between: ${cyclic.join(', ')}. These cannot be ordered safely; consider merging them.`));
  }
  return ordered;
}

// Imports whose letter case differs from the file git actually has. They work on
// Windows/macOS and break on Linux, so warn (nothing is changed automatically).
async function warnCaseMismatches(groups) {
  const mismatches = await findCaseMismatches(groups, readRepoFile, await listRepoFiles());
  if (mismatches.length === 0) return;

  console.log(chalk.yellow('⚠️ These imports only work because your OS ignores letter case:'));
  mismatches.forEach(m => console.log(chalk.yellow(`   • ${m.file} imports "${m.spec}" but git has "${m.actual}"`)));
  console.log(chalk.yellow('   They will break on Linux (CI, servers). Fix the import or rename the file.'));
}

async function reviewGroups(groups) {
  let out = await dropStrayFiles(groups);
  if (Object.keys(out).length === 0) return out;
  out = await resolveDependencies(out);
  await warnCaseMismatches(out);
  return out;
}

/* ------------------------------------------------------------------ */
/* One commit message                                                   */
/* ------------------------------------------------------------------ */

// Ask -> format -> validate the REAL header -> (edit | commit anyway | skip).
async function askMessage(initial) {
  let defaults = initial;
  while (true) {
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
        type: 'confirm',
        name: 'includeBody',
        message: 'Add the per-file summary above as the commit body?',
        default: true,
        when: () => !!defaults.body
      },
      {
        type: 'input',
        name: 'breakingDesc',
        message: 'Describe the breaking change:',
        when: (a) => a.isBreaking,
        validate: (input) => (input.trim().length > 0 ? true : 'Breaking change description required.')
      }
    ]);

    const message = formatCommitMessage({ ...answers, body: answers.includeBody === false ? '' : defaults.body });
    const header = message.split('\n')[0];
    const validation = validateCommitHeader(header);
    if (validation.valid) return { message };

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

    if (action === 'anyway') return { message };
    if (action === 'skip') return { skip: true };
    defaults = { ...answers, body: defaults.body, isBreaking: !!answers.isBreaking };
  }
}

/* ------------------------------------------------------------------ */
/* Mixed groups (a fix AND a feature) -> git add -p                     */
/* ------------------------------------------------------------------ */

// Returns { action: 'together' } | { action: 'skip' } | { action: 'split', picked: files[] }.
async function offerSplit(analysis, files, ctx) {
  console.log(chalk.yellow('⚠️ This group seems to mix a bug fix with a new feature:'));
  analysis.changes.forEach(c => {
    console.log(chalk.yellow(`   • ${c.type}: ${c.summary || '(no summary)'}${c.file ? ` (${c.file})` : ''}`));
  });

  const groupPaths = pathsOf(files);
  let allowSplit = true;

  while (true) {
    const choices = [
      ...(allowSplit ? [{ name: 'Split it with git add -p (pick the hunks for the first commit)', value: 'split' }] : []),
      { name: 'Commit everything together', value: 'together' },
      { name: 'Skip this group', value: 'skip' }
    ];
    const { splitAction } = await inquirer.prompt([
      { type: 'select', name: 'splitAction', message: 'How should this be committed?', choices }
    ]);
    if (splitAction !== 'split') return { action: splitAction };

    // The commit takes exactly what is staged, so nothing else may be staged.
    const foreign = (await getStagedPaths()).filter(p => !groupPaths.has(p));
    if (foreign.length > 0) {
      console.log(chalk.red('✖ You have other staged files, so a split could commit them by accident:'));
      foreign.forEach(p => console.log(chalk.red(`   • ${p}`)));
      console.log(chalk.red('  Unstage them first (git restore --staged <file>) to use the split.'));
      allowSplit = false;
      continue;
    }

    await addPatch(files, { input: ctx.options.addPatchInput });

    const stagedNow = new Set(await getStagedPaths());
    const fresh = await getGitStatus();
    const picked = fresh.files.filter(f =>
      groupPaths.has(f.path) && (stagedNow.has(f.path) || (f.origPath && stagedNow.has(f.origPath))));

    if (picked.length === 0) {
      await resetPaths(files.filter(f => f.status === '??').map(f => f.path)); // undo intent-to-add
      console.log(chalk.yellow('Nothing was staged, so there is nothing to split.'));
      allowSplit = false;
      continue;
    }
    return { action: 'split', picked };
  }
}

/* ------------------------------------------------------------------ */
/* One commit group                                                     */
/* ------------------------------------------------------------------ */

async function processJob(job, ctx) {
  const { key: groupKey, files, staged = false } = job;
  const tally = { committed: 0, failed: 0, skipped: 0, requeue: [] };
  const detectedType = groupKey.split(':')[0]; // 'fix:backend' -> 'fix'

  console.log(chalk.bgMagenta.bold(`\n --- Committing [${groupKey}] ${staged ? 'Selected Hunks' : 'Changes'} --- `));
  files.forEach(f => console.log(chalk.gray(`   • ${label(f)}`)));

  const diffOpts = { staged };
  const groupDiff = await getGitDiff(files, diffOpts);
  const groupStat = await getGitDiffStat(files, diffOpts);

  // Big groups: EVERY file is read and summarized (a title plus one bullet per file).
  // Small groups get a single combined description further down.
  const big = await describeGroup(files, groupDiff);

  // Files whose type the path settles (docs, tests, CI...) are not sent to the model.
  // Everything else is code: the model reads the change and picks feat, fix or chore.
  const analysis = detectedType === 'feat'
    ? (big?.analysis ?? await analyzeGroup(files, groupDiff, groupStat))
    : null;

  if (analysis?.mixed && !staged) {
    const decision = await offerSplit(analysis, files, ctx);

    if (decision.action === 'skip') {
      tally.skipped++;
      console.log(chalk.yellow(`↷ Skipped [${groupKey}]. Those files are still uncommitted.`));
      return tally;
    }

    if (decision.action === 'split') {
      const sub = await processJob({ key: groupKey, files: decision.picked, staged: true }, ctx);
      tally.committed += sub.committed;
      tally.failed += sub.failed;
      tally.skipped += sub.skipped;

      const groupPaths = [...pathsOf(files)];
      if (sub.committed > 0) {
        // Whatever is left of this group goes through the normal flow again.
        const leftover = (await getGitStatus()).files.filter(f => pathsOf(files).has(f.path));
        if (leftover.length > 0) tally.requeue.push({ key: groupKey, files: leftover });
      } else {
        await resetPaths(groupPaths); // put the index back the way it was
        console.log(chalk.yellow('   The selected hunks were unstaged again. Your files are unchanged.'));
      }
      return tally;
    }
    // 'together' falls through to a normal commit of the whole group
  }

  const branchOverride = detectedType === 'feat' && BRANCH_OVERRIDES.has(ctx.branchType) ? ctx.branchType : null;
  const defaultType = analysis?.type || branchOverride || detectedType;

  // The branch scope only applies to groups of the branch's own type.
  const defaultScope = (ctx.branchType === defaultType && ctx.branchScope) || detectScope(files);
  const defaultDescription = big?.description ?? await generateDescription(files, groupDiff, groupStat);
  const body = big?.body ?? '';

  if (body) {
    console.log(chalk.gray('   Summary of every file (can be added as the commit body):'));
    body.split('\n').forEach(l => console.log(chalk.gray(`     ${l}`)));
  }

  const asked = await askMessage({
    type: defaultType, scope: defaultScope, description: defaultDescription, body, isBreaking: false
  });

  if (asked.skip) {
    tally.skipped++;
    console.log(chalk.yellow(`↷ Skipped [${groupKey}]. Those files are still uncommitted.`));
    return tally;
  }

  const result = staged ? await commitStaged(asked.message) : await commitSpecificFiles(files, asked.message);
  if (result.ok) {
    tally.committed++;
    console.log(chalk.green(`✔ Committed: "${asked.message.split('\n')[0]}"`));
  } else {
    tally.failed++;
    console.log(chalk.red(`✖ Failed to commit [${groupKey}]:`));
    console.log(chalk.red(`  ${String(result.error).split('\n').join('\n  ')}`));
  }
  return tally;
}

/* ------------------------------------------------------------------ */
/* The command                                                          */
/* ------------------------------------------------------------------ */

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

  // Directories/paths only decide which files travel together; each file is
  // classified from ITS OWN diff, and the model picks the type for code groups.
  let groupedFiles = await groupFilesByType(filesToProcess, (file) => getGitDiff([file]));
  groupedFiles = await reviewGroups(groupedFiles);

  if (Object.keys(groupedFiles).length === 0) {
    console.log(chalk.yellow('Nothing left to commit.'));
    return;
  }

  console.log(chalk.cyan(`\n🤖 Auto-detected ${Object.keys(groupedFiles).length} different commit group(s). Preparing commits...\n`));

  const ctx = { branchType, branchScope, options };
  const queue = Object.entries(groupedFiles).map(([key, files]) => ({ key, files }));
  const totals = { committed: 0, failed: 0, skipped: 0 };

  while (queue.length > 0) {
    const result = await processJob(queue.shift(), ctx);
    totals.committed += result.committed;
    totals.failed += result.failed;
    totals.skipped += result.skipped;
    queue.unshift(...result.requeue); // leftovers of a split run next, in order
  }

  const parts = [`${totals.committed} committed`];
  if (totals.failed) parts.push(`${totals.failed} failed`);
  if (totals.skipped) parts.push(`${totals.skipped} skipped`);

  if (totals.failed) {
    process.exitCode = 1;
    console.log(chalk.yellow(`\nDone with problems: ${parts.join(', ')}.`));
  } else if (totals.skipped) {
    console.log(chalk.yellow(`\nDone: ${parts.join(', ')}.`));
  } else {
    console.log(chalk.green.bold('\n🎉 All isolated changes committed successfully!'));
  }
}