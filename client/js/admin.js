'use strict';

(function () {
  var DEFAULT_LAYOUT = {
    grid: { cols: 2, rows: 2, colSizes: [1, 1], rowSizes: [1, 1] },
    slots: [
      { id: 'camera-0', type: 'camera',      row: 1, col: 1, rowSpan: 1, colSpan: 1, config: { name: 'Front Door', index: 0 } },
      { id: 'camera-1', type: 'camera',      row: 1, col: 2, rowSpan: 1, colSpan: 1, config: { name: 'Backyard',   index: 1 } },
      { id: 'temp',     type: 'temperature', row: 2, col: 1, rowSpan: 1, colSpan: 1, config: {} },
      { id: 'clock',    type: 'clock',       row: 2, col: 2, rowSpan: 1, colSpan: 1, config: {} },
    ],
  };

  // ── Widget metadata ───────────────────────────────────

  var WIDGET_ICONS = {
    camera: '📹', temperature: '🌡️', clock: '🕐', stocks: '📈',
    news: '📰', iss: '🛰️', sports: '🏟️', nowplaying: '🎵',
  };

  var WIDGET_LABELS = {
    camera: 'Camera', temperature: 'Temperature', clock: 'Clock',
    stocks: 'Markets', news: 'Headlines', iss: 'ISS Tracker',
    sports: 'Sports', nowplaying: 'Now Playing',
  };

  var WIDGET_TYPES = [
    ['camera',      'Camera'],
    ['temperature', 'Temperature'],
    ['clock',       'Clock'],
    ['stocks',      'Markets'],
    ['news',        'Headlines'],
    ['iss',         'ISS Tracker'],
    ['sports',      'Sports'],
    ['nowplaying',  'Now Playing'],
    ['empty',       'Empty (remove)'],
  ];

  // ── Config schemas ────────────────────────────────────
  // Each field: { key, label, type ('text'|'number'|'select'), def, min?, max?, options? }

  var ringCameras = []; // populated from /api/cameras on load

  var CONFIG_SCHEMAS = {
    camera: [
      { key: 'name',  label: 'Camera Name',  type: 'text', def: 'Camera' },
      { key: 'index', label: 'Camera',       type: 'camera-select', def: 0 },
    ],
    temperature: [
      { key: 'units', label: 'Units', type: 'select', def: 'fahrenheit',
        options: [['fahrenheit', 'Fahrenheit (°F)'], ['celsius', 'Celsius (°C)']] },
    ],
    clock: [
      { key: 'format', label: 'Time Format', type: 'select', def: '12h',
        options: [['12h', '12-hour'], ['24h', '24-hour']] },
      { key: 'showSeconds', label: 'Show Seconds', type: 'select', def: 'false',
        options: [['false', 'No'], ['true', 'Yes']] },
    ],
    stocks: [
      { key: 'symbols', label: 'Stocks to show', type: 'stock-multi', def: 'AAPL,NVDA,JPM,^DJI,^SPX' },
      { key: 'title',   label: 'Widget Title',              type: 'text', def: 'Markets' },
    ],
    news: [
      { key: 'feedUrl', label: 'RSS Feed URL',  type: 'text', def: 'https://feeds.bbci.co.uk/news/rss.xml' },
      { key: 'title',   label: 'Widget Title',  type: 'text', def: 'Top Headlines' },
    ],
    iss: [
      { key: 'radius',      label: 'Overhead Radius (miles)', type: 'number', def: 100, min: 10, max: 500 },
      { key: 'showFlights', label: 'Show Nearby Flights', type: 'select', def: 'true',
        options: [['true', 'Yes'], ['false', 'No']] },
    ],
    sports: [
      { key: 'sport',  label: 'Sport', type: 'select', def: 'football',
        options: [['football','Football'],['basketball','Basketball'],['baseball','Baseball'],
                  ['hockey','Hockey'],['soccer','Soccer']] },
      { key: 'league', label: 'League (e.g. nfl, nba, mlb)', type: 'text',   def: 'nfl' },
      { key: 'team',   label: 'Team Code (e.g. SF, LAL)',     type: 'text',   def: '' },
    ],
    nowplaying: [],
  };

  var STOCK_CHOICES = [
    { value: 'AAPL', label: 'AAPL' },
    { value: 'NVDA', label: 'NVDA' },
    { value: 'JPM', label: 'JPM' },
    { value: '^DJI', label: 'Dow Jones (^DJI)' },
    { value: '^SPX', label: 'S&P 500 (^SPX)' },
    { value: '^IXIC', label: 'NASDAQ (^IXIC)' },
    { value: 'MSFT', label: 'MSFT' },
    { value: 'TSLA', label: 'TSLA' },
  ];

  function defaultConfig(type) {
    var schema = CONFIG_SCHEMAS[type] || [];
    var cfg = {};
    schema.forEach(function (f) { cfg[f.key] = f.def; });
    return cfg;
  }

  // ── State ─────────────────────────────────────────────

  var layout       = null;
  var selectedCell = null; // { row, col }
  var dragSlotId   = null;

  function clearEl(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ── Load / save ───────────────────────────────────────

  function loadLayout() {
    fetch('/api/layout')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        layout = data;
        // Ensure grid has colSizes/rowSizes
        if (!layout.grid.colSizes) layout.grid.colSizes = Array(layout.grid.cols).fill(1);
        if (!layout.grid.rowSizes) layout.grid.rowSizes = Array(layout.grid.rows).fill(1);
        syncControls();
        renderGrid();
        renderConfigPanel();
      })
      .catch(function () {
        layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
        syncControls();
        renderGrid();
        renderConfigPanel();
      });
  }

  function saveLayout() {
    fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(layout),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('server error');
        showNotification('Layout saved', 'success');
      })
      .catch(function () { showNotification('Save failed', 'error'); });
  }

  function resetLayout() {
    if (!confirm('Reset to the default 2×2 layout? Unsaved changes will be lost.')) return;
    layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
    selectedCell = null;
    syncControls();
    renderGrid();
    renderConfigPanel();
  }

  // ── Header controls ───────────────────────────────────

  function parseSizes(str, count) {
    var parts = (str || '').split(',').map(function (v) { return Math.max(0.1, parseFloat(v.trim()) || 1); });
    while (parts.length < count) parts.push(1);
    return parts.slice(0, count);
  }

  function syncControls() {
    document.getElementById('cols-input').value = layout.grid.cols;
    document.getElementById('rows-input').value = layout.grid.rows;
    document.getElementById('col-sizes-input').value = (layout.grid.colSizes || []).join(', ');
    document.getElementById('row-sizes-input').value = (layout.grid.rowSizes || []).join(', ');
  }

  function onGridSizeChange() {
    var cols = clamp(parseInt(document.getElementById('cols-input').value, 10), 1, 6);
    var rows = clamp(parseInt(document.getElementById('rows-input').value, 10), 1, 6);

    var colSizes = (layout.grid.colSizes || []).slice();
    var rowSizes = (layout.grid.rowSizes || []).slice();
    while (colSizes.length < cols) colSizes.push(1);
    while (rowSizes.length < rows) rowSizes.push(1);
    colSizes = colSizes.slice(0, cols);
    rowSizes = rowSizes.slice(0, rows);

    layout.slots = layout.slots.filter(function (s) { return s.col <= cols && s.row <= rows; });
    layout.grid.cols     = cols;
    layout.grid.rows     = rows;
    layout.grid.colSizes = colSizes;
    layout.grid.rowSizes = rowSizes;

    if (selectedCell && (selectedCell.row > rows || selectedCell.col > cols)) selectedCell = null;
    syncControls();
    renderGrid();
    renderConfigPanel();
  }

  function onSizesChange() {
    var cols = layout.grid.cols;
    var rows = layout.grid.rows;
    layout.grid.colSizes = parseSizes(document.getElementById('col-sizes-input').value, cols);
    layout.grid.rowSizes = parseSizes(document.getElementById('row-sizes-input').value, rows);
    renderGrid();
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, isNaN(n) ? lo : n));
  }

  // ── Grid rendering ────────────────────────────────────

  function slotAt(row, col) {
    return layout.slots.find(function (s) { return s.row === row && s.col === col; }) || null;
  }

  // Returns a set of "row,col" keys for cells covered by a span but not the anchor
  function buildClaimedSet() {
    var claimed = {};
    layout.slots.forEach(function (s) {
      var cs = s.colSpan || 1;
      var rs = s.rowSpan || 1;
      for (var dr = 0; dr < rs; dr++) {
        for (var dc = 0; dc < cs; dc++) {
          if (dr === 0 && dc === 0) continue;
          claimed[(s.row + dr) + ',' + (s.col + dc)] = true;
        }
      }
    });
    return claimed;
  }

  function renderGrid() {
    var container = document.getElementById('grid-editor');
    var colSizes  = layout.grid.colSizes || Array(layout.grid.cols).fill(1);
    var rowSizes  = layout.grid.rowSizes || Array(layout.grid.rows).fill(1);
    container.style.gridTemplateColumns = colSizes.map(function (v) { return v + 'fr'; }).join(' ');
    container.style.gridTemplateRows    = rowSizes.map(function (v) { return v + 'fr'; }).join(' ');
    clearEl(container);

    var claimed = buildClaimedSet();
    for (var r = 1; r <= layout.grid.rows; r++) {
      for (var c = 1; c <= layout.grid.cols; c++) {
        if (claimed[r + ',' + c]) continue; // cell is covered by a neighboring span
        container.appendChild(buildCell(r, c, slotAt(r, c)));
      }
    }
  }

  function buildCell(row, col, slot) {
    var cell = document.createElement('div');
    cell.className = 'admin-cell';
    cell.dataset.row = row;
    cell.dataset.col = col;

    var cs = slot ? (slot.colSpan || 1) : 1;
    var rs = slot ? (slot.rowSpan || 1) : 1;
    // Explicit placement is required because we skip covered cells from the DOM
    cell.style.gridColumn = col + ' / span ' + cs;
    cell.style.gridRow    = row + ' / span ' + rs;

    if (selectedCell && selectedCell.row === row && selectedCell.col === col) {
      cell.classList.add('selected');
    }

    if (slot) {
      cell.classList.add('has-widget');
      var isSpanned = cs > 1 || rs > 1;
      if (!isSpanned) {
        cell.setAttribute('draggable', 'true');
        cell.addEventListener('dragstart', onDragStart);
      }

      var icon = document.createElement('div');
      icon.className = 'cell-icon';
      icon.textContent = WIDGET_ICONS[slot.type] || '?';

      var typeLabel = document.createElement('div');
      typeLabel.className = 'cell-type';
      typeLabel.textContent = WIDGET_LABELS[slot.type] || slot.type;

      cell.appendChild(icon);
      cell.appendChild(typeLabel);

      if (slot.config && slot.config.name) {
        var nameDiv = document.createElement('div');
        nameDiv.className = 'cell-name';
        nameDiv.textContent = slot.config.name;
        cell.appendChild(nameDiv);
      }

      if (cs > 1 || rs > 1) {
        var spanBadge = document.createElement('div');
        spanBadge.className = 'cell-span-badge';
        spanBadge.textContent = cs + '×' + rs;
        cell.appendChild(spanBadge);
      }
    } else {
      cell.classList.add('empty');
      var emptyLbl = document.createElement('div');
      emptyLbl.className = 'empty-cell-label';
      emptyLbl.textContent = 'Empty';
      cell.appendChild(emptyLbl);
    }

    cell.addEventListener('click',     function () { selectCell(row, col); });
    cell.addEventListener('dragover',  onDragOver);
    cell.addEventListener('drop',      function (e) { onDrop(e, row, col); });
    cell.addEventListener('dragenter', function () { cell.classList.add('drag-over'); });
    cell.addEventListener('dragleave', function () { cell.classList.remove('drag-over'); });

    return cell;
  }

  // ── Drag-and-drop ─────────────────────────────────────

  function onDragStart(evt) {
    var r = parseInt(evt.currentTarget.dataset.row, 10);
    var c = parseInt(evt.currentTarget.dataset.col, 10);
    var s = slotAt(r, c);
    dragSlotId = s ? s.id : null;
    evt.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(evt) {
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'move';
  }

  function onDrop(evt, targetRow, targetCol) {
    evt.preventDefault();
    evt.currentTarget.classList.remove('drag-over');
    if (!dragSlotId) return;

    var slotA = layout.slots.find(function (s) { return s.id === dragSlotId; });
    var slotB = slotAt(targetRow, targetCol);
    if (!slotA || (slotA.row === targetRow && slotA.col === targetCol)) return;
    // Don't swap spanned slots — position math is complex with different span sizes
    if ((slotA.colSpan || 1) > 1 || (slotA.rowSpan || 1) > 1) return;
    if (slotB && ((slotB.colSpan || 1) > 1 || (slotB.rowSpan || 1) > 1)) return;

    var oldRow = slotA.row;
    var oldCol = slotA.col;
    slotA.row = targetRow;
    slotA.col = targetCol;
    if (slotB) { slotB.row = oldRow; slotB.col = oldCol; }

    if (selectedCell && selectedCell.row === oldRow && selectedCell.col === oldCol) {
      selectedCell = { row: targetRow, col: targetCol };
    }
    dragSlotId = null;
    renderGrid();
    renderConfigPanel();
  }

  // ── Cell selection + config panel ────────────────────

  function selectCell(row, col) {
    selectedCell = { row: row, col: col };
    renderGrid();
    renderConfigPanel();
  }

  function makeFormGroup(labelText, inputFactory) {
    var group = document.createElement('div');
    group.className = 'form-group';
    var lbl = document.createElement('label');
    lbl.textContent = labelText;
    var input = inputFactory();
    group.appendChild(lbl);
    group.appendChild(input);
    return group;
  }

  function makeSchemaField(f, currentVal) {
    return makeFormGroup(f.label, function () {
      if (f.type === 'stock-multi') {
        var wrapper = document.createElement('div');
        wrapper.id = 'cfg-field-' + f.key;
        wrapper.className = 'checkbox-group';

        var rawValue = currentVal !== undefined ? String(currentVal) : f.def;
        var allValues = rawValue.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
        var selectedValues = [];
        var customValues = [];

        if (allValues.length === 0) {
          allValues = String(f.def).split(',').map(function (v) { return v.trim(); }).filter(Boolean);
        }

        allValues.forEach(function (value) {
          if (STOCK_CHOICES.some(function (choice) { return choice.value === value; })) selectedValues.push(value);
          else customValues.push(value);
        });

        STOCK_CHOICES.forEach(function (choice) {
          var label = document.createElement('label');
          label.className = 'checkbox-item';

          var input = document.createElement('input');
          input.type = 'checkbox';
          input.value = choice.value;
          input.checked = selectedValues.indexOf(choice.value) !== -1;

          var text = document.createElement('span');
          text.textContent = choice.label;

          label.appendChild(input);
          label.appendChild(text);
          wrapper.appendChild(label);
        });

        var customLabel = document.createElement('label');
        customLabel.className = 'checkbox-custom-label';
        customLabel.textContent = 'Custom tickers';

        var customInput = document.createElement('input');
        customInput.type = 'text';
        customInput.id = 'cfg-field-' + f.key + '-custom';
        customInput.placeholder = 'e.g. AMD, META, ^VIX';
        customInput.value = customValues.join(', ');

        wrapper.appendChild(customLabel);
        wrapper.appendChild(customInput);

        return wrapper;
      }
      if (f.type === 'select') {
        var sel = document.createElement('select');
        sel.id = 'cfg-field-' + f.key;
        var valStr = String(currentVal !== undefined ? currentVal : f.def);
        f.options.forEach(function (opt) {
          var o = document.createElement('option');
          o.value = opt[0];
          o.textContent = opt[1];
          if (opt[0] === valStr) o.selected = true;
          sel.appendChild(o);
        });
        return sel;
      }
      if (f.type === 'camera-select') {
        var sel = document.createElement('select');
        sel.id = 'cfg-field-' + f.key;
        var currentIndex = currentVal !== undefined ? Number(currentVal) : f.def;
        if (ringCameras.length === 0) {
          var o = document.createElement('option');
          o.value = currentIndex;
          o.textContent = 'Camera ' + currentIndex + ' (not connected)';
          sel.appendChild(o);
        } else {
          ringCameras.forEach(function (cam) {
            var o = document.createElement('option');
            o.value = cam.index;
            o.textContent = cam.name + ' (' + cam.kind + ')';
            if (cam.index === currentIndex) o.selected = true;
            sel.appendChild(o);
          });
        }
        sel.addEventListener('change', function () {
          var selectedIndex = parseInt(this.value, 10);
          var chosen = ringCameras.find(function (c) { return c.index === selectedIndex; });
          var nameEl = document.getElementById('cfg-field-name');
          if (chosen && nameEl) nameEl.value = chosen.name;
        });
        return sel;
      }
      var inp = document.createElement('input');
      inp.type = f.type === 'number' ? 'number' : 'text';
      inp.id   = 'cfg-field-' + f.key;
      if (f.min != null) inp.min = String(f.min);
      if (f.max != null) inp.max = String(f.max);
      inp.value = currentVal !== undefined ? currentVal : f.def;
      return inp;
    });
  }

  function renderConfigPanel() {
    var panel = document.getElementById('config-content');
    clearEl(panel);

    if (!selectedCell) {
      var hint = document.createElement('div');
      hint.className = 'config-placeholder';
      hint.textContent = 'Click a cell to configure it';
      panel.appendChild(hint);
      return;
    }

    var slot = slotAt(selectedCell.row, selectedCell.col);
    var currentType = slot ? slot.type : 'empty';
    var cfg = (slot && slot.config) || {};

    // ── Widget type selector ──────────────────────────
    panel.appendChild(makeFormGroup('Widget Type', function () {
      var sel = document.createElement('select');
      sel.id = 'cfg-type';
      WIDGET_TYPES.forEach(function (pair) {
        var o = document.createElement('option');
        o.value = pair[0];
        o.textContent = pair[1];
        if (pair[0] === currentType) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () { applyType(this.value); });
      return sel;
    }));

    if (!slot) return;

    // ── Span controls (all widget types) ─────────────
    var maxCols = layout.grid.cols - selectedCell.col + 1;
    var maxRows = layout.grid.rows - selectedCell.row + 1;

    panel.appendChild(makeFormGroup('Width (cols)', function () {
      var inp = document.createElement('input');
      inp.type  = 'number'; inp.id = 'cfg-colspan';
      inp.min   = '1'; inp.max = String(maxCols);
      inp.value = slot.colSpan || 1;
      return inp;
    }));

    panel.appendChild(makeFormGroup('Height (rows)', function () {
      var inp = document.createElement('input');
      inp.type  = 'number'; inp.id = 'cfg-rowspan';
      inp.min   = '1'; inp.max = String(maxRows);
      inp.value = slot.rowSpan || 1;
      return inp;
    }));

    // ── Type-specific fields from CONFIG_SCHEMAS ─────
    var schema = CONFIG_SCHEMAS[currentType] || [];
    schema.forEach(function (f) {
      panel.appendChild(makeSchemaField(f, cfg[f.key]));
    });

    // ── Action buttons ────────────────────────────────
    var applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary';
    applyBtn.style.cssText = 'width:100%;margin-top:8px';
    applyBtn.textContent = 'Apply Changes';
    applyBtn.addEventListener('click', applyConfig);
    panel.appendChild(applyBtn);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger';
    removeBtn.style.cssText = 'width:100%;margin-top:8px';
    removeBtn.textContent = 'Remove Widget';
    removeBtn.addEventListener('click', function () { removeSlot(selectedCell.row, selectedCell.col); });
    panel.appendChild(removeBtn);
  }

  function applyType(newType) {
    if (!selectedCell) return;
    var slot = slotAt(selectedCell.row, selectedCell.col);

    if (newType === 'empty') { removeSlot(selectedCell.row, selectedCell.col); return; }

    if (slot) {
      if (slot.type !== newType) {
        slot.type   = newType;
        slot.config = defaultConfig(newType);
      }
    } else {
      layout.slots.push({
        id:      newType + '-' + Date.now(),
        type:    newType,
        row:     selectedCell.row,
        col:     selectedCell.col,
        rowSpan: 1,
        colSpan: 1,
        config:  defaultConfig(newType),
      });
    }
    renderGrid();
    renderConfigPanel();
  }

  function applyConfig() {
    if (!selectedCell) return;
    var slot = slotAt(selectedCell.row, selectedCell.col);
    if (!slot) return;

    // Spans
    var csEl = document.getElementById('cfg-colspan');
    var rsEl = document.getElementById('cfg-rowspan');
    if (csEl) slot.colSpan = clamp(parseInt(csEl.value, 10), 1, layout.grid.cols - slot.col + 1);
    if (rsEl) slot.rowSpan = clamp(parseInt(rsEl.value, 10), 1, layout.grid.rows - slot.row + 1);

    // Type-specific fields
    var schema = CONFIG_SCHEMAS[slot.type] || [];
    schema.forEach(function (f) {
      var inputEl = document.getElementById('cfg-field-' + f.key);
      if (!inputEl) return;
      if (f.type === 'number') {
        slot.config[f.key] = parseFloat(inputEl.value) || f.def;
      } else if (f.type === 'camera-select') {
        slot.config[f.key] = parseInt(inputEl.value, 10);
      } else if (f.type === 'stock-multi') {
        var checked = Array.prototype.slice.call(inputEl.querySelectorAll('input[type="checkbox"]:checked'));
        var selected = checked.map(function (box) { return box.value; });
        var customEl = document.getElementById('cfg-field-' + f.key + '-custom');
        var customValues = customEl ? customEl.value.split(',').map(function (v) { return v.trim(); }).filter(Boolean) : [];
        var combined = selected.concat(customValues).filter(function (value, index, array) {
          return array.indexOf(value) === index;
        });
        slot.config[f.key] = combined.length ? combined.join(',') : f.def;
      } else {
        slot.config[f.key] = inputEl.value;
      }
    });

    renderGrid();
    renderConfigPanel();
  }

  function removeSlot(row, col) {
    layout.slots = layout.slots.filter(function (s) { return !(s.row === row && s.col === col); });
    selectedCell = null;
    renderGrid();
    renderConfigPanel();
  }

  // ── Notification ──────────────────────────────────────

  var notifTimer;
  function showNotification(msg, type) {
    var notif = document.getElementById('notification');
    notif.textContent = msg;
    notif.className = 'notification ' + type + ' visible';
    clearTimeout(notifTimer);
    notifTimer = setTimeout(function () { notif.classList.remove('visible'); }, 2500);
  }

  // ── Init ──────────────────────────────────────────────

  document.getElementById('save-btn').addEventListener('click', saveLayout);
  document.getElementById('reset-btn').addEventListener('click', resetLayout);
  document.getElementById('cols-input').addEventListener('change', onGridSizeChange);
  document.getElementById('rows-input').addEventListener('change', onGridSizeChange);
  document.getElementById('col-sizes-input').addEventListener('change', onSizesChange);
  document.getElementById('row-sizes-input').addEventListener('change', onSizesChange);

  // ── Import / Export modal ─────────────────────────────

  var modal         = document.getElementById('layout-modal');
  var modalTitle    = document.getElementById('modal-title');
  var modalHint     = document.getElementById('modal-hint');
  var modalTextarea = document.getElementById('modal-textarea');
  var modalCopy     = document.getElementById('modal-copy');
  var modalApply    = document.getElementById('modal-apply');
  var modalCancel   = document.getElementById('modal-cancel');
  var modalClose    = document.getElementById('modal-close');

  function openModal(mode) {
    if (mode === 'export') {
      modalTitle.textContent = 'Export Layout';
      modalHint.textContent  = 'Copy the JSON below to save or share this layout.';
      modalTextarea.value    = JSON.stringify(layout, null, 2);
      modalTextarea.readOnly = true;
      modalCopy.hidden  = false;
      modalApply.hidden = true;
      modal.hidden = false;
      modalTextarea.select();
    } else {
      modalTitle.textContent = 'Import Layout';
      modalHint.textContent  = 'Paste a previously exported layout JSON and click Apply.';
      modalTextarea.value    = '';
      modalTextarea.readOnly = false;
      modalCopy.hidden  = true;
      modalApply.hidden = false;
      modal.hidden = false;
      modalTextarea.focus();
    }
  }

  function closeModal() { modal.hidden = true; }

  document.getElementById('export-btn').addEventListener('click', function () { openModal('export'); });
  document.getElementById('import-btn').addEventListener('click', function () { openModal('import'); });
  modalClose.addEventListener('click', closeModal);
  modalCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

  modalCopy.addEventListener('click', function () {
    navigator.clipboard.writeText(modalTextarea.value)
      .then(function () { showNotification('Copied to clipboard', 'success'); closeModal(); })
      .catch(function () { modalTextarea.select(); showNotification('Select + copy manually', 'error'); });
  });

  modalApply.addEventListener('click', function () {
    var raw = modalTextarea.value.trim();
    var parsed;
    try { parsed = JSON.parse(raw); } catch (_) {
      showNotification('Invalid JSON', 'error'); return;
    }
    if (!parsed || typeof parsed.grid !== 'object' || !Array.isArray(parsed.slots)) {
      showNotification('Not a valid layout (needs grid + slots)', 'error'); return;
    }
    if (!parsed.grid.colSizes) parsed.grid.colSizes = Array(parsed.grid.cols).fill(1);
    if (!parsed.grid.rowSizes) parsed.grid.rowSizes = Array(parsed.grid.rows).fill(1);
    layout = parsed;
    selectedCell = null;
    syncControls();
    renderGrid();
    renderConfigPanel();
    closeModal();
    showNotification('Layout imported — click Save to persist', 'success');
  });

  function renderDevices(list) {
    var container = document.getElementById('devices-list');
    clearEl(container);
    if (!list || !list.length) {
      var ph = document.createElement('div');
      ph.className = 'devices-placeholder';
      ph.textContent = 'No Ring cameras detected';
      container.appendChild(ph);
      return;
    }
    list.forEach(function (camera) {
      var row = document.createElement('div');
      row.className = 'device-row';

      var name = document.createElement('div');
      name.className = 'device-name';
      name.textContent = camera.name || ('Camera ' + camera.index);

      var kind = document.createElement('div');
      kind.className = 'device-kind';
      kind.textContent = camera.kind || 'unknown';

      var dropped = document.createElement('div');
      var count = camera.dropped || 0;
      dropped.className = 'device-dropped' + (count === 0 ? ' none' : '');
      dropped.textContent = count + ' dropped';

      row.appendChild(name);
      row.appendChild(kind);
      row.appendChild(dropped);

      if (camera.battery != null) {
        var bat = document.createElement('div');
        bat.className = 'device-battery' + (camera.lowBattery ? ' low' : '');
        bat.textContent = camera.battery + '% battery' + (camera.lowBattery ? ' — suspended' : '');
        row.appendChild(bat);
      }

      container.appendChild(row);
    });
  }

  function loadCameras() {
    fetch('/api/cameras')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        ringCameras = list;
        renderDevices(list);
        renderConfigPanel();
      })
      .catch(function () {
        renderDevices([]);
      });
  }

  function loadConfig() {
    fetch('/api/config')
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        var input = document.getElementById('update-interval-input');
        if (input && cfg.updateIntervalMs) input.value = cfg.updateIntervalMs;
      })
      .catch(function () {});
  }

  document.getElementById('save-interval-btn').addEventListener('click', function () {
    var input = document.getElementById('update-interval-input');
    var ms = parseInt(input && input.value, 10);
    if (isNaN(ms) || ms < 1000 || ms > 60000) {
      showNotification('Interval must be 1000–60000 ms', 'error');
      return;
    }
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updateIntervalMs: ms }),
    })
      .then(function (r) { return r.json(); })
      .then(function () { showNotification('Update interval applied', 'success'); })
      .catch(function () { showNotification('Failed to apply interval', 'error'); });
  });

  loadCameras();
  setInterval(loadCameras, 30000);
  loadConfig();

  loadLayout();
}());
