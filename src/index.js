import { program } from 'commander';
import { statusCommand } from './commands/status.js';
import { commitCommand } from './commands/commit.js';

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
    .action(commitCommand);

  program.parse(process.argv);
}//fix: resolve undefined error/