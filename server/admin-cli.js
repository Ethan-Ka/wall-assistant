'use strict';

const http = require('http');

function printUsage() {
  console.log('Usage: node server/admin-cli.js [--host HOST] [--port PORT] <command>');
  console.log('');
  console.log('Commands:');
  console.log('  status                           Show current config');
  console.log('  lockdown on|off|toggle           Toggle lockdown mode');
  console.log('  lockdown window <start> <end>    Set lockdown window (HH:MM 24h)');
  console.log('  lockdown window clear            Clear lockdown window');
  console.log('  update-interval <ms>             Set update interval (1000-60000)');
  console.log('  motion-loops <count>             Set motion clip loops (1-20)');
  console.log('  offline-retry <ms>               Set offline retry (60000-14400000)');
  console.log('  help                             Show this help');
  console.log('');
  console.log('Examples:');
  console.log('  node server/admin-cli.js status');
  console.log('  node server/admin-cli.js lockdown toggle');
  console.log('  node server/admin-cli.js lockdown window 22:00 06:00');
  console.log('  node server/admin-cli.js update-interval 5000');
}

function parseArgs(argv) {
  const args = [];
  let host = 'localhost';
  let port = 3000;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--host' && argv[i + 1]) {
      host = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--host=')) {
      host = arg.slice('--host='.length);
      continue;
    }
    if (arg === '--port' && argv[i + 1]) {
      port = parseInt(argv[i + 1], 10);
      i += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      port = parseInt(arg.slice('--port='.length), 10);
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      return { help: true };
    }
    args.push(arg);
  }

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('Invalid --port value');
  }

  return { host, port, args, json, help: false };
}

function requestJson(host, port, method, path, body) {
  const payload = body ? JSON.stringify(body) : '';
  const headers = {
    'Content-Type': 'application/json',
  };
  if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

  return new Promise((resolve, reject) => {
    const req = http.request({
      host,
      port,
      method,
      path,
      headers,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = raw;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (_) {}

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          err.body = parsed;
          return reject(err);
        }

        resolve(parsed);
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function formatWindow(cfg) {
  const start = cfg.lockdownStart || '';
  const end = cfg.lockdownEnd || '';
  if (!start && !end) return 'any time';
  if (start && end) return `${start}-${end}`;
  return `${start || '??'}-${end || '??'}`;
}

function printConfig(cfg, asJson) {
  if (asJson) {
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }
  console.log(`lockdown: ${cfg.lockdownEnabled ? 'on' : 'off'} (window ${formatWindow(cfg)})`);
  console.log(`updateIntervalMs: ${cfg.updateIntervalMs}`);
  console.log(`motionClipLoops: ${cfg.motionClipLoops}`);
  console.log(`offlineRetryMs: ${cfg.offlineRetryMs}`);
}

async function getConfig(host, port) {
  return requestJson(host, port, 'GET', '/api/config');
}

async function updateConfig(host, port, patch, asJson) {
  const updated = await requestJson(host, port, 'POST', '/api/config', patch);
  printConfig(updated, asJson);
}

async function run() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printUsage();
    return;
  }

  const { host, port, args, json } = parsed;
  if (!args.length) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const command = args[0];
  const rest = args.slice(1);

  if (command === 'status' || command === 'config') {
    const cfg = await getConfig(host, port);
    printConfig(cfg, json);
    return;
  }

  if (command === 'lockdown') {
    const action = rest[0] || 'status';
    if (action === 'status') {
      const cfg = await getConfig(host, port);
      printConfig(cfg, json);
      return;
    }
    if (action === 'on' || action === 'off') {
      await updateConfig(host, port, { lockdownEnabled: action === 'on' }, json);
      return;
    }
    if (action === 'toggle') {
      const cfg = await getConfig(host, port);
      await updateConfig(host, port, { lockdownEnabled: !cfg.lockdownEnabled }, json);
      return;
    }
    if (action === 'window') {
      const windowAction = rest[1];
      if (!windowAction) {
        const cfg = await getConfig(host, port);
        printConfig(cfg, json);
        return;
      }
      if (windowAction === 'clear') {
        await updateConfig(host, port, { lockdownStart: '', lockdownEnd: '' }, json);
        return;
      }
      const start = rest[1];
      const end = rest[2];
      if (!start || !end) {
        throw new Error('lockdown window requires <start> and <end>');
      }
      await updateConfig(host, port, { lockdownStart: start, lockdownEnd: end }, json);
      return;
    }
    throw new Error(`Unknown lockdown action: ${action}`);
  }

  if (command === 'update-interval') {
    const ms = parseInt(rest[0], 10);
    if (!Number.isFinite(ms)) throw new Error('update-interval requires a number');
    await updateConfig(host, port, { updateIntervalMs: ms }, json);
    return;
  }

  if (command === 'motion-loops') {
    const loops = parseInt(rest[0], 10);
    if (!Number.isFinite(loops)) throw new Error('motion-loops requires a number');
    await updateConfig(host, port, { motionClipLoops: loops }, json);
    return;
  }

  if (command === 'offline-retry') {
    const ms = parseInt(rest[0], 10);
    if (!Number.isFinite(ms)) throw new Error('offline-retry requires a number');
    await updateConfig(host, port, { offlineRetryMs: ms }, json);
    return;
  }

  if (command === 'help') {
    printUsage();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

run().catch((err) => {
  const detail = err && err.body && err.body.error ? `: ${err.body.error}` : '';
  console.error(`Admin CLI error${detail}`);
  if (err && err.message && !detail) {
    console.error(err.message);
  }
  process.exitCode = 1;
});
