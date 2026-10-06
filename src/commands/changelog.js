import fs from 'fs/promises';
import { exec } from 'child_process';
import util from 'util';
import chalk from 'chalk';

const execAsync = util.promisify(exec);

export async function changelogCommand() {
  try {
    const { stdout } = await execAsync('git log --pretty=format:"%h|%s|%b"');
    const lines = stdout.split('\n');

    const changelog = { features: [], fixes: [], breaking: [] };

    lines.forEach(line => {
      if (!line) return;
      const [hash, subject, body] = line.split('|');
      
      if (subject.includes('!') || (body && body.includes('BREAKING CHANGE'))) {
        changelog.breaking.push(`* ${subject} (${hash})`);
      } else if (subject.startsWith('feat')) {
        changelog.features.push(`* ${subject.replace(/^feat(\([^)]+\))?:\s*/, '')} (${hash})`);
      } else if (subject.startsWith('fix')) {
        changelog.fixes.push(`* ${subject.replace(/^fix(\([^)]+\))?:\s*/, '')} (${hash})`);
      }
    });

    const date = new Date().toISOString().split('T')[0];
    let markdown = `## Unreleased (${date})\n\n`;

    if (changelog.breaking.length) markdown += `### 🚨 Breaking Changes\n${changelog.breaking.join('\n')}\n\n`;
    if (changelog.features.length) markdown += `### ✨ Features\n${changelog.features.join('\n')}\n\n`;
    if (changelog.fixes.length) markdown += `### 🐛 Bug Fixes\n${changelog.fixes.join('\n')}\n\n`;

    await fs.appendFile('CHANGELOG.md', markdown);
    console.log(chalk.green('✔ CHANGELOG.md updated successfully!'));

  } catch (error) {
    console.log(chalk.red('Failed to generate changelog.'));
  }
}