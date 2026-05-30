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

const GIT_TIMEOUT_MS = 60_000;

function git(...args) {
  return execFileSync(GIT, ['-c', 'safe.directory=*', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
  }).trim();
}

function ensureRemote() {
  let currentUrl = '';
  try {
    currentUrl = git('remote', 'get-url', 'origin');
  } catch {
    // origin doesn't exist
  }
  if (currentUrl === REMOTE_URL) return;
  if (currentUrl) {
    git('remote', 'set-url', 'origin', REMOTE_URL);
    console.log('[auto-update] updated origin URL to', REMOTE_URL);
  } else {
    git('remote', 'add', 'origin', REMOTE_URL);
    console.log('[auto-update] added origin remote:', REMOTE_URL);
  }
}

function ensureGitRepo() {
  let isRepo = false;
  try {
    git('rev-parse', '--git-dir');
    isRepo = true;
  } catch {
    // not a repo — initialize it
  }

  if (!isRepo) {
    console.log('[auto-update] initializing git repo...');
    git('init');
  }

  ensureRemote();

  if (!isRepo) {
    git('fetch', 'origin', BRANCH, '--quiet');
    git('checkout', '-B', BRANCH, `origin/${BRANCH}`);
    console.log('[auto-update] repo initialized from remote');
  }
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
