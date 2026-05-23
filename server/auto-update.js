'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REMOTE_URL = 'https://github.com/Ethan-Ka/wall-assistant.git';
const BRANCH = 'main';
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const IS_WIN = process.platform === 'win32';
const GIT = 'git';
const NPM = 'npm';

function git(...args) {
  return execFileSync(GIT, ['-c', 'safe.directory=*', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
}

function ensureGitRepo() {
  try {
    git('rev-parse', '--git-dir');
    return; // already a repo
  } catch {
    // not a repo — initialize and wire up the remote
  }

  console.log('[auto-update] initializing git repo and fetching remote...');
  git('init');
  try {
    git('remote', 'add', 'origin', REMOTE_URL);
  } catch {
    git('remote', 'set-url', 'origin', REMOTE_URL);
  }
  git('fetch', 'origin', BRANCH, '--quiet');
  git('checkout', '-B', BRANCH, `origin/${BRANCH}`);
  console.log('[auto-update] repo initialized from remote');
}

function currentCommit() {
  return git('rev-parse', 'HEAD');
}

function remoteCommit() {
  git('fetch', 'origin', BRANCH, '--quiet');
  return git('rev-parse', `origin/${BRANCH}`);
}

function pkgJsonChanged() {
  try {
    const diff = git('diff', 'HEAD~1', 'HEAD', '--', 'server/package.json');
    return diff.length > 0;
  } catch {
    return false;
  }
}

function applyUpdate() {
  console.log('[auto-update] pulling latest changes...');
  git('reset', '--hard', `origin/${BRANCH}`);

  if (pkgJsonChanged()) {
    console.log('[auto-update] package.json changed, running npm install...');
    execFileSync(NPM, ['install'], {
      cwd: path.join(ROOT, 'server'),
      stdio: 'inherit',
    });
  }

  console.log('[auto-update] update applied, restarting...');
  process.exit(0);
}

function checkForUpdates() {
  try {
    const local = currentCommit();
    const remote = remoteCommit();
    if (local !== remote) {
      console.log(`[auto-update] new commit detected (${remote.slice(0, 7)}), updating...`);
      applyUpdate();
    }
  } catch (err) {
    console.warn(`[auto-update] check failed: ${err.message}`);
  }
}

function start() {
  try {
    ensureGitRepo();
  } catch (err) {
    console.warn(`[auto-update] failed to initialize repo: ${err.message}`);
    return;
  }

  setTimeout(() => {
    checkForUpdates();
    setInterval(checkForUpdates, CHECK_INTERVAL_MS);
  }, 30_000);
}

module.exports = { start };
