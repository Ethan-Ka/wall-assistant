'use strict';

const fs = require('fs');
const path = require('path');

const LAYOUT_FILE = path.join(__dirname, 'layout.json');

const DEFAULT_LAYOUT = {
  grid: { cols: 2, rows: 2 },
  slots: [
    { id: 'camera-0',   type: 'camera',      row: 1, col: 1, rowSpan: 1, colSpan: 1, config: { name: 'Front Door', index: 0 } },
    { id: 'camera-1',   type: 'camera',      row: 1, col: 2, rowSpan: 1, colSpan: 1, config: { name: 'Backyard',   index: 1 } },
    { id: 'temp',       type: 'temperature', row: 2, col: 1, rowSpan: 1, colSpan: 1, config: {} },
    { id: 'clock',      type: 'clock',       row: 2, col: 2, rowSpan: 1, colSpan: 1, config: {} },
  ],
};

function readLayout() {
  try {
    return JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8'));
  } catch (_) {
    return JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
  }
}

function writeLayout(layout) {
  const tmp = LAYOUT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(layout, null, 2));
  fs.renameSync(tmp, LAYOUT_FILE);
}

module.exports = { readLayout, writeLayout, DEFAULT_LAYOUT };
