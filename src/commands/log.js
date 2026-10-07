import { exec } from 'child_process';
import util from 'util';
import chalk from 'chalk';

const execAsync = util.promisify(exec);

export async function logCommand() {
  try {
    // Added %cI for strict ISO timestamp (e.g., 2026-10-06T20:45:00+08:00)
    const { stdout } = await execAsync('git log -n 15 --pretty=format:"%h|%s|%cI"');
    
    if (!stdout.trim()) {
      console.log(chalk.yellow('No commits found.'));
      return;
    }

    console.log(chalk.bold.magenta('\n📜 Recent Commits:\n'));

    const commits = stdout.split('\n');
    commits.forEach(commit => {
      const [hash, message, dateIso] = commit.split('|');
      
      // Convert the ISO date string into a readable local date and time
      const dateObj = new Date(dateIso);
      const dateStr = dateObj.toLocaleString(undefined, {
        month: 'short', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      // Colorize the conventional commit prefix
      let coloredMessage = message;
      const typeMatch = message.match(/^(feat|fix|docs|style|refactor|test|chore)(\([^)]+\))?:/);
      
      if (typeMatch) {
        const type = typeMatch[1];
        let color = chalk.white;
        if (type === 'feat') color = chalk.green;
        else if (type === 'fix') color = chalk.red;
        else if (type === 'docs') color = chalk.blue;
        else if (type === 'refactor') color = chalk.yellow;
        else if (type === 'chore') color = chalk.gray;
        
        coloredMessage = message.replace(typeMatch[0], color.bold(typeMatch[0]));
      }

      // Output format: hash [date time] message
      console.log(`${chalk.yellow(hash)} ${chalk.gray(`[${dateStr}]`)} ${coloredMessage}`);
    });
    console.log();
  } catch (error) {
    console.log(chalk.red('❌ Failed to retrieve git log.'));
  }
}

// Convert the ISO date string into a readable local date and time