import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import chalk from 'chalk';

const execAsync = util.promisify(exec);

export async function releaseCommand() {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    
    // 1. Read current version from package.json
    let pkgData, pkg;
    try {
      pkgData = await fs.readFile(pkgPath, 'utf8');
      pkg = JSON.parse(pkgData);
    } catch (err) {
      console.log(chalk.red('❌ Could not find or parse package.json in the current directory.'));
      return;
    }

    const currentVersion = pkg.version || '0.0.0';

    // 2. Find the last git tag
    let lastTag = '';
    try {
      const { stdout } = await execAsync('git describe --tags --abbrev=0');
      lastTag = stdout.trim();
    } catch (err) {
      console.log(chalk.yellow('No previous tags found. Analyzing all commits...'));
    }

    // 3. Get commits since the last tag (or all commits if no tag exists)
    const logCmd = lastTag 
      ? `git log ${lastTag}..HEAD --pretty=format:"%s|%b"` 
      : `git log --pretty=format:"%s|%b"`;

    const { stdout: commits } = await execAsync(logCmd);
    
    if (!commits.trim()) {
      console.log(chalk.cyan('✔ No new commits since last release. Nothing to do.'));
      return;
    }

    // 4. Analyze commits to determine the bump type
    let bumpType = 'none'; // 'major', 'minor', 'patch', or 'none'

    const lines = commits.split('\n');
    for (const line of lines) {
      if (!line) continue;
      const [subject, body] = line.split('|');
      const lowerBody = body ? body.toLowerCase() : '';

      // MAJOR: Breaking changes take highest priority
      if (subject.includes('!') || lowerBody.includes('breaking change')) {
        bumpType = 'major';
        break; // Max bump reached, we can stop evaluating
      }
      // MINOR: Features bump the minor version
      if (subject.startsWith('feat') && bumpType !== 'major') {
        bumpType = 'minor';
      }
      // PATCH: Bug fixes bump the patch version
      if (subject.startsWith('fix') && bumpType === 'none') {
        bumpType = 'patch';
      }
    }

    if (bumpType === 'none') {
      console.log(chalk.yellow('No features, fixes, or breaking changes found in recent commits. Skipping release.'));
      return;
    }

    // 5. Calculate the new version using standard SemVer rules
    let [major, minor, patch] = currentVersion.split('.').map(Number);
    
    if (bumpType === 'major') {
      major += 1;
      minor = 0;
      patch = 0;
    } else if (bumpType === 'minor') {
      minor += 1;
      patch = 0;
    } else if (bumpType === 'patch') {
      patch += 1;
    }
    
    const newVersion = `${major}.${minor}.${patch}`;

    console.log(chalk.gray(`Current version:  ${currentVersion}`));
    console.log(chalk.gray(`Detected bump:    ${bumpType.toUpperCase()}`));
    console.log(chalk.magenta.bold(`New version:      ${newVersion}\n`));

    // 6. Update package.json
    pkg.version = newVersion;
    // Keep standard 2-space indentation and add a trailing newline
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    // 7. Commit the bump and create a git tag
    console.log(chalk.cyan('Staging package.json...'));
    await execAsync('git add package.json');
    
    console.log(chalk.cyan('Committing release...'));
    await execAsync(`git commit -m "chore(release): bump version to ${newVersion}"`);
    
    console.log(chalk.cyan(`Creating git tag v${newVersion}...`));
    await execAsync(`git tag v${newVersion}`);

    console.log(chalk.green.bold(`\n🎉 Successfully released v${newVersion}!`));

  } catch (error) {
    console.log(chalk.red(`❌ Release failed: ${error.message}`));
  }
}

console.log(chalk.cyan('Pushing release and tags to GitHub...'));
console.log(chalk.cyan('Execute Command: "git push --follow-tag" after reviewing'));
