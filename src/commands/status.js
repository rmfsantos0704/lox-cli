import chalk from 'chalk';
import { getGitStatus, getGitDiff } from '../utils/git.js';
import { groupFilesByType } from '../utils/detector.js';

export async function statusCommand() {
  const status = await getGitStatus();

  if (status.files.length === 0) {
    console.log(chalk.green('✔ Working tree is clean. Nothing to commit.'));
    return;
  }

  const globalDiff = await getGitDiff();
  const groupedFiles = groupFilesByType(status.files, globalDiff);

  console.log(chalk.cyan.bold(`\n📊 LOX Status Preview:`));
  console.log(chalk.gray(`Found ${status.files.length} changed file(s), categorized into ${Object.keys(groupedFiles).length} commit group(s).\n`));

  for (const [type, files] of Object.entries(groupedFiles)) {
    // Apply visual flair based on Conventional Commit type
    let typeColor = chalk.white;
    if (type === 'feat') typeColor = chalk.green;
    else if (type === 'fix') typeColor = chalk.red;
    else if (type === 'docs') typeColor = chalk.blue;
    else if (type === 'style') typeColor = chalk.magenta;
    else if (type === 'refactor') typeColor = chalk.yellow;
    else if (type === 'test') typeColor = chalk.cyan;
    else if (type === 'chore') typeColor = chalk.gray;

    console.log(typeColor.bold(`[${type}]`));
    
    files.forEach(f => {
      // Colorize the Git status indicator (M = Modified, A/? = Added, D = Deleted)
      const statusIcon = f.status.includes('M') ? chalk.yellow('M') 
                       : f.status.includes('A') || f.status.includes('?') ? chalk.green('A') 
                       : f.status.includes('D') ? chalk.red('D') : chalk.gray(f.status);
      
      console.log(`  ${statusIcon} ${chalk.white(f.path)}`);
    });
    console.log(''); 
  }
  
  console.log(chalk.gray('Run ') + chalk.cyan('lox commit') + chalk.gray(' to process these changes.\n'));
}