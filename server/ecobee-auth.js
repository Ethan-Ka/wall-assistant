'use strict';

/**
 * One-time Ecobee authorization CLI.
 * Prerequisites: register a developer app at https://www.ecobee.com/developers/
 *   (Login → Developer → Create New App, scope: smartRead)
 *   then add your API key to config.json: { "ecobee": { "apiKey": "..." } }
 *
 * Usage: node server/ecobee-auth.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const CONFIG_PATH = path.join(__dirname, '../config.json');
const BASE = 'https://api.ecobee.com';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log('\n=== Ecobee Authorization ===\n');
  console.log('Prerequisites:');
  console.log('  1. Log in at https://www.ecobee.com/developers/');
  console.log('  2. Create a new app (scope: smartRead)');
  console.log('  3. Add the API key to config.json under ecobee.apiKey\n');

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) {}

  const apiKey = (cfg.ecobee && cfg.ecobee.apiKey) || '';
  if (!apiKey) {
    console.error('Error: config.json is missing ecobee.apiKey. Add it and re-run this script.');
    process.exit(1);
  }
  console.log(`Using API key: ${apiKey.slice(0, 6)}...${apiKey.slice(-4)}\n`);

  // Step 1: Request a PIN
  console.log('Requesting authorization PIN from Ecobee...');
  const authRes = await fetch(
    `${BASE}/authorize?response_type=ecobeePin&client_id=${encodeURIComponent(apiKey)}&scope=smartRead`
  );
  if (!authRes.ok) {
    console.error(`Ecobee authorize request failed: HTTP ${authRes.status}`);
    process.exit(1);
  }
  const authJson = await authRes.json();
  if (authJson.error) {
    console.error('Ecobee error:', authJson.error_description || authJson.error);
    process.exit(1);
  }

  const pin = authJson.ecobeePin;
  const authCode = authJson.code;
  const expiresIn = authJson.expires_in || 9; // minutes

  console.log(`\nAuthorization PIN: ${pin}`);
  console.log(`(Expires in ~${expiresIn} minutes)\n`);
  console.log('Steps:');
  console.log('  1. Open the Ecobee web portal or mobile app');
  console.log('  2. Go to My Apps → Add Application');
  console.log(`  3. Enter the PIN: ${pin}`);
  console.log('  4. Click Authorize\n');

  await ask('Press Enter once you have authorized the app in Ecobee...');

  // Step 2: Exchange auth code for tokens
  console.log('\nExchanging PIN for access token...');
  const tokenRes = await fetch(
    `${BASE}/token?grant_type=ecobeePin&code=${encodeURIComponent(authCode)}&client_id=${encodeURIComponent(apiKey)}`,
    { method: 'POST' }
  );
  const tokenJson = await tokenRes.json();

  if (tokenJson.error) {
    console.error('\nAuthorization failed:', tokenJson.error_description || tokenJson.error);
    console.error('Make sure you authorized the PIN in the Ecobee app before pressing Enter.');
    process.exit(1);
  }

  const { access_token, refresh_token } = tokenJson;

  // Save to config.json
  if (!cfg.ecobee) cfg.ecobee = {};
  cfg.ecobee.accessToken = access_token;
  cfg.ecobee.refreshToken = refresh_token;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

  console.log('\nSuccess! Tokens saved to config.json.');
  console.log('Start the server with: node server/index.js\n');
  rl.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
