'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function currentCommit() {
  return git('rev-parse', 'HEAD');
}

function remoteCommit() {
  git('fetch', 'origin', 'main', '--quiet');
  return git('rev-parse', 'origin/main');
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
  git('pull', 'origin', 'main', '--ff-only', '--quiet');

  if (pkgJsonChanged()) {
    console.log('[auto-update] package.json changed, running npm install...');
    execFileSync('npm', ['install'], {
      cwd: path.join(ROOT, 'server'),
      stdio: 'inherit',
      shell: process.platform === 'win32',
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
  setTimeout(() => {
    checkForUpdates();
    setInterval(checkForUpdates, CHECK_INTERVAL_MS);
  }, 30_000);
}

module.exports = { start };
