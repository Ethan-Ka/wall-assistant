'use strict';

// One-time CLI: node server/ring-auth.js
// Prompts for Ring email, password, and 2FA code, then writes the
// refresh token into config.json so the main server can use it.

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { RingRestClient } = require('ring-client-api/rest-client');

const CONFIG_PATH = path.join(__dirname, '../config.json');

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans.trim()); }));
}

function saveToken(token) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}
  if (!cfg.ring) cfg.ring = {};
  cfg.ring.refreshToken = token;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

async function main() {
  console.log('Ring one-time authentication — saves a refresh token to config.json.\n');

  const email    = await ask('Ring email: ');
  const password = await ask('Ring password: ');

  const client = new RingRestClient({ email, password });

  let auth;
  try {
    auth = await client.getCurrentAuth();
  } catch (_) {
    if (!client.promptFor2fa) throw _;
    console.log('\n' + client.promptFor2fa);
    const code = await ask('2FA code: ');
    auth = await client.getAuth(code);
  }

  const token = auth.refresh_token;
  saveToken(token);
  console.log('\nSuccess! Refresh token saved to config.json.');
  console.log('Start the server with: node server/index.js');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
