'use strict';

// TODO: Auth setup — call initRing(config) with a valid ring refreshToken from config.json.
// ring-client-api will handle token refresh automatically once initialized.
// See: https://github.com/dgreif/ring/tree/main/packages/ring-client-api

async function initRing(config) {
}

async function getRingSnapshot(cameraIndex) {
  return {
    name: 'Front Door',
    snapshotUrl: null,
    lastUpdated: new Date().toISOString(),
  };
}

module.exports = { initRing, getRingSnapshot };
