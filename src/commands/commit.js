import inquirer from 'inquirer';
import chalk from 'chalk';
import { formatCommitMessage } from '../utils/formatter.js';
import { commitSpecificFiles, getGitStatus, getGitDiff } from '../utils/git.js';
import { groupFilesByType, detectScope, generateDescription } from '../utils/detector.js';

export async function commitCommand() {
  const status = await getGitStatus();

  if (status.files.length === 0) {
    console.log(chalk.yellow('No changes detected to commit.'));
    return;
  }

  const diff = await getGitDiff();
  
  // Group the modified files by their predicted commit type
  const groupedFiles = groupFilesByType(status.files, diff);
  const groupCount = Object.keys(groupedFiles).length;

  console.log(chalk.cyan(`\n🤖 Auto-detected ${groupCount} different type(s) of changes. Preparing separate commits...\n`));

  // Loop through each group (e.g., 'feat', then 'docs')
  for (const [type, files] of Object.entries(groupedFiles)) {
    console.log(chalk.bgMagenta.bold(`\n --- Committing [${type}] Changes --- `));
    files.forEach(f => console.log(chalk.gray(`  • ${f.path}`)));

    // Generate scope & description for THIS specific group of files
    const detectedScope = detectScope(files);
    const detectedDescription = generateDescription(files, diff);

    const commitPrompts = [
      {
        type: 'select',
        name: 'type',
        message: 'Confirm the type of change for these files:',
        default: type,
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
    
    // Stage and commit ONLY the files belonging to this group
    const filePaths = files.map(f => f.path);
    const success = await commitSpecificFiles(filePaths, commitMsg);
    
    if (success) {
      console.log(chalk.green(`✔ Committed: "${commitMsg}"`));
    } else {
      console.log(chalk.red(`✖ Failed to commit [${type}] files.`));
    }
  }

  console.log(chalk.green.bold('\n🎉 All separated changes have been committed successfully! You can now run `git push`.'));
}