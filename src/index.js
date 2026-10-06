import { program } from 'commander';
import { statusCommand } from './commands/status.js';
import { commitCommand } from './commands/commit.js';
import { logCommand } from './commands/log.js';
import { releaseCommand } from './commands/release.js';

export function run() {
program
    .name('lox')
    .description('CLI Tool to track changes and enforce conventional commits')
    .version('1.0.0');

  program
    .command('status')
    .description('Show the current git status of the project')
    .action(statusCommand);

program
  .command('commit')
  .description('Run the interactive conventional commit process')
  .option('-i, --interactive', 'Interactively select which modified files to stage')
  .action((options) => commitCommand(options));

  program
    .command('log')
    .description('Show the formatted conventional commit history')
    .action(logCommand);

    program
    .command('release')
    .description('Analyze commits and automatically bump version and tag release')
    .action(releaseCommand);

  program.parse(process.argv);
}