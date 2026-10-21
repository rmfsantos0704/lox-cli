import { execFile, spawn } from 'child_process';
import util from 'util';
import fs from 'fs/promises';
import path from 'path';

const run = util.promisify(execFile);

// Hash of git's empty tree: lets us diff in a repo that has no commits yet.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_BUFFER = 64 * 1024 * 1024;
const SNIFF_BYTES = 64 * 1024;
const MAX_UNTRACKED_LINES = 400;

const debug = (err) => {
  if (process.env.LOX_DEBUG) console.error('[lox:git]', err?.stderr || err?.message || err);
};

const rootCache = new Map();

// Porcelain paths are relative to the repo root, so every command runs from there.
async function getRepoRoot() {
  const cwd = process.cwd();
  if (!rootCache.has(cwd)) {
    const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], { cwd });
    rootCache.set(cwd, stdout.trim());
  }
  return rootCache.get(cwd);
}

// execFile with an args array: no shell, so quotes, $, backticks and spaces in
// paths or commit messages can never be interpreted by a shell (also works on Windows).
async function git(args, opts = {}) {
  const cwd = await getRepoRoot();
  // --literal-pathspecs: a file called "a[1].js" or "*.js" is a file, not a glob.
  return run('git', ['--literal-pathspecs', '-c', 'core.quotepath=false', ...args], { cwd, maxBuffer: MAX_BUFFER, ...opts });
}

// Accepts file objects ({ path, origPath }) or plain path strings.
function toPaths(files = []) {
  const out = [];
  for (const f of files) {
    if (typeof f === 'string') out.push(f);
    else {
      out.push(f.path);
      if (f.origPath) out.push(f.origPath); // renames: the old path must be staged too
    }
  }
  return [...new Set(out)];
}

async function diffBase() {
  try {
    await git(['rev-parse', '--verify', '--quiet', 'HEAD']);
    return 'HEAD';
  } catch {
    return EMPTY_TREE; // repository has no commits yet
  }
}

const isConflict = (xy) => xy.includes('U') || xy === 'AA' || xy === 'DD';

// Returns { files, conflicts, error }. `error` is set when git itself failed
// (not a repository, git missing...) so callers can tell that apart from "no changes".
export async function getGitStatus() {
  let stdout;
  try {
    ({ stdout } = await git(['status', '--porcelain=v1', '-z', '-uall']));
  } catch (err) {
    const msg = String(err.stderr || err.message || '').trim();
    let error = msg;
    if (err.code === 'ENOENT') error = 'git was not found on your PATH.';
    else if (/not a git repository/i.test(msg)) error = 'This folder is not a git repository.';
    return { files: [], conflicts: [], error };
  }

  const parts = stdout.split('\0');
  const files = [];
  const conflicts = [];

  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue; // trailing empty chunk
    const xy = entry.slice(0, 2);
    const file = { status: xy.trim(), path: entry.slice(3) };
    // In -z mode a rename/copy is "XY new\0old\0"
    if (/[RC]/.test(xy)) file.origPath = parts[++i];
    (isConflict(xy) ? conflicts : files).push(file);
  }

  return { files, conflicts };
}

// Builds a unified diff for files git does not track yet, so they look like
// ordinary additions ('+' lines) to the classifier and the AI prompt.
async function syntheticAddition(rel) {
  const root = await getRepoRoot();
  const abs = path.join(root, rel);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return '';
  }
  if (!stat.isFile()) return '';

  const header = `diff --git a/${rel} b/${rel}\nnew file mode 100644\n`;
  if (stat.size === 0) return header;

  const fh = await fs.open(abs, 'r');
  let buf;
  try {
    buf = Buffer.alloc(Math.min(stat.size, SNIFF_BYTES));
    await fh.read(buf, 0, buf.length, 0);
  } finally {
    await fh.close();
  }
  if (buf.includes(0)) return `${header}Binary files /dev/null and b/${rel} differ\n`;

  let lines = buf.toString('utf8').split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  lines = lines.slice(0, MAX_UNTRACKED_LINES);
  return `${header}--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}\n`;
}

async function listUntracked(paths) {
  const args = ['ls-files', '--others', '--exclude-standard', '-z'];
  if (paths.length) args.push('--', ...paths);
  try {
    const { stdout } = await git(args);
    return stdout.split('\0').filter(Boolean);
  } catch (err) {
    debug(err);
    return [];
  }
}

// Diff of the given files against HEAD (-U0: only changed lines, no context),
// with untracked files appended as synthetic additions.
// { staged: true } diffs only what is in the index (used after `git add -p`).
export async function getGitDiff(files = [], { staged = false } = {}) {
  const paths = toPaths(files);
  const args = staged
    ? ['diff', '--cached', '-U0', '--no-color', '--no-ext-diff']
    : ['diff', await diffBase(), '-U0', '--no-color', '--no-ext-diff'];
  if (paths.length) args.push('--', ...paths);

  let out = '';
  try {
    out = (await git(args)).stdout;
  } catch (err) {
    debug(err);
  }

  if (!staged) {
    for (const rel of await listUntracked(paths)) {
      out += await syntheticAddition(rel);
    }
  }
  return out;
}

export async function getGitDiffStat(files = [], { staged = false } = {}) {
  const paths = toPaths(files);
  const args = staged
    ? ['diff', '--cached', '--stat', '--no-color', '--no-ext-diff']
    : ['diff', await diffBase(), '--stat', '--no-color', '--no-ext-diff'];
  if (paths.length) args.push('--', ...paths);

  let out = '';
  try {
    out = (await git(args)).stdout.trim();
  } catch (err) {
    debug(err);
  }

  const untracked = staged ? [] : await listUntracked(paths);
  if (untracked.length) {
    out += `${out ? '\n' : ''}${untracked.map(p => ` ${p} (new file)`).join('\n')}`;
  }
  return out;
}

// Reads a working-tree file by repo-relative path ('' if missing, binary-sized or unreadable).
export async function readRepoFile(rel) {
  try {
    const abs = path.join(await getRepoRoot(), rel);
    const stat = await fs.stat(abs);
    if (!stat.isFile() || stat.size > 1024 * 1024) return '';
    return await fs.readFile(abs, 'utf8');
  } catch {
    return '';
  }
}

// Every file git knows about or could add: tracked paths (as spelled in the index,
// so their letter case is what git really has) plus untracked, non-ignored files.
export async function listRepoFiles() {
  try {
    const { stdout } = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    return stdout.split('\0').filter(Boolean);
  } catch (err) {
    debug(err);
    return [];
  }
}

// Paths that currently have staged changes.
export async function getStagedPaths() {
  try {
    const { stdout } = await git(['diff', '--cached', '--name-only', '-z']);
    return stdout.split('\0').filter(Boolean);
  } catch (err) {
    debug(err);
    return [];
  }
}

export async function resetPaths(paths = []) {
  if (!paths.length) return;
  try {
    await git(['reset', '-q', '--', ...paths]);
  } catch (err) {
    debug(err);
  }
}

// Runs an interactive `git add -p` for the given files so the user can pick hunks.
// Untracked files are first marked intent-to-add, otherwise `add -p` skips them.
// `input` (tests only) is piped to git instead of the terminal.
export async function addPatch(files, { input } = {}) {
  const untracked = files.filter(f => f.status === '??').map(f => f.path);
  if (untracked.length) await git(['add', '-N', '--', ...untracked]);

  const cwd = await getRepoRoot();
  const paths = toPaths(files);
  return new Promise((resolve) => {
    const child = spawn('git', ['--literal-pathspecs', 'add', '-p', '--', ...paths], {
      cwd,
      stdio: input != null ? ['pipe', 'ignore', 'inherit'] : 'inherit'
    });
    if (input != null) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

// Commits exactly what is staged (used for the hunks picked with `git add -p`).
export async function commitStaged(commitMsg) {
  try {
    await git(['commit', '-m', commitMsg]);
    return { ok: true };
  } catch (err) {
    const text = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    return { ok: false, error: text || err.message };
  }
}

export async function getCurrentBranch() {
  try {
    const { stdout } = await git(['branch', '--show-current']);
    return stdout.trim();
  } catch {
    return '';
  }
}

// Stages and commits ONLY the given files. Anything else the user has staged is
// left alone (no `git reset`): `git commit -- <paths>` records just those paths.
// Returns { ok: true } or { ok: false, error } with git's real message
// (hook failure, missing user.name, nothing to commit...).
export async function commitSpecificFiles(files, commitMsg) {
  const paths = toPaths(files);
  if (paths.length === 0) return { ok: false, error: 'No files to commit.' };
  try {
    // Only `add` paths that still exist in the index or on disk. The old side of a
    // staged rename / a staged deletion is already recorded in the index, and
    // `git add` errors on it ("pathspec did not match"). `commit -- <paths>` still
    // receives every path, so those deletions are committed too.
    const { stdout } = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...paths]);
    const addable = [...new Set(stdout.split('\0').filter(Boolean))];
    if (addable.length) await git(['add', '-A', '--', ...addable]);
    await git(['commit', '-m', commitMsg, '--', ...paths]);
    return { ok: true };
  } catch (err) {
    const text = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    return { ok: false, error: text || err.message };
  }
}