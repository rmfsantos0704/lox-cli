import { exec } from 'child_process';
import util from 'util';
import chalk from 'chalk';

const execAsync = util.promisify(exec);

export async function logCommand() {
  try {
    // Custom Git Log format: %h (hash) | %cr (relative date) | %s (subject)
    const { stdout } = await execAsync('git log -n 15 --pretty=format:"%h|%cr|%s"');
    
    if (!stdout.trim()) {
      console.log(chalk.yellow('No commits found in this repository.'));
      return;
    }

    console.log(chalk.cyan.bold('\n📜 LOX Commit History (Last 15)\n'));

    const lines = stdout.split('\n');
    lines.forEach(line => {
      const [hash, date, message] = line.split('|');
      
      // Parse conventional commit syntax: type(scope)!: description
      const match = message.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?(!?):\s*(.+)$/);
      
      let formattedMessage = message;
      if (match) {
        const type = match[1];
        const scope = match[2] ? chalk.gray(`(${match[2]})`) : '';
        const breaking = match[3] ? chalk.bgRed.white.bold(' ! ') : '';
        const desc = match[4];

        let typeColor = chalk.white;
        if (type === 'feat') typeColor = chalk.green;
        else if (type === 'fix') typeColor = chalk.red;
        else if (type === 'docs') typeColor = chalk.blue;
        else if (type === 'style') typeColor = chalk.magenta;
        else if (type === 'refactor') typeColor = chalk.yellow;
        else if (type === 'test') typeColor = chalk.cyan;
        else if (type === 'chore') typeColor = chalk.gray;

        formattedMessage = `${typeColor.bold(type)}${scope}${breaking}: ${chalk.white(desc)}`;
      }

      console.log(`${chalk.yellow(hash)} ${chalk.gray(`[${date}]`)} ${formattedMessage}`);
    });
    console.log('');
  } catch (error) {
    console.log(chalk.red('Failed to retrieve git history. Are you in a git repository?'));
  }
}