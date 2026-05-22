'use strict';

(function () {
  var DEFAULT_LAYOUT = {
    grid: { cols: 2, rows: 2 },
    slots: [
      { id: 'camera-0', type: 'camera',      row: 1, col: 1, rowSpan: 1, colSpan: 1, config: { name: 'Front Door', index: 0 } },
      { id: 'camera-1', type: 'camera',      row: 1, col: 2, rowSpan: 1, colSpan: 1, config: { name: 'Backyard',   index: 1 } },
      { id: 'temp',     type: 'temperature', row: 2, col: 1, rowSpan: 1, colSpan: 1, config: {} },
      { id: 'clock',    type: 'clock',       row: 2, col: 2, rowSpan: 1, colSpan: 1, config: {} },
    ],
  };

  var WIDGET_ICONS  = { camera: '📹', temperature: '🌡️', clock: '🕐', stocks: '📈', news: '📰' };
  var WIDGET_LABELS = { camera: 'Camera', temperature: 'Temperature', clock: 'Clock', stocks: 'Markets', news: 'Headlines' };

  var layout       = null;
  var selectedCell = null; // { row, col }
  var dragSlotId   = null;

  function clearEl(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ── Load / save ───────────────────────────────────────

  function loadLayout() {
    fetch('/api/layout')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        layout = data;
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
      .catch(function () {
        showNotification('Save failed', 'error');
      });
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

  function syncControls() {
    document.getElementById('cols-input').value = layout.grid.cols;
    document.getElementById('rows-input').value = layout.grid.rows;
  }

  function onGridSizeChange() {
    var cols = clamp(parseInt(document.getElementById('cols-input').value, 10), 1, 6);
    var rows = clamp(parseInt(document.getElementById('rows-input').value, 10), 1, 6);
    layout.slots = layout.slots.filter(function (s) { return s.col <= cols && s.row <= rows; });
    layout.grid.cols = cols;
    layout.grid.rows = rows;
    if (selectedCell && (selectedCell.row > rows || selectedCell.col > cols)) {
      selectedCell = null;
    }
    renderGrid();
    renderConfigPanel();
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, isNaN(n) ? lo : n));
  }

  // ── Grid rendering ────────────────────────────────────

  function slotAt(row, col) {
    return layout.slots.find(function (s) { return s.row === row && s.col === col; }) || null;
  }

  function renderGrid() {
    var container = document.getElementById('grid-editor');
    container.style.gridTemplateColumns = 'repeat(' + layout.grid.cols + ', 1fr)';
    container.style.gridTemplateRows    = 'repeat(' + layout.grid.rows + ', 1fr)';
    clearEl(container);

    for (var r = 1; r <= layout.grid.rows; r++) {
      for (var c = 1; c <= layout.grid.cols; c++) {
        container.appendChild(buildCell(r, c, slotAt(r, c)));
      }
    }
  }

  function buildCell(row, col, slot) {
    var cell = document.createElement('div');
    cell.className = 'admin-cell';
    cell.dataset.row = row;
    cell.dataset.col = col;

    if (selectedCell && selectedCell.row === row && selectedCell.col === col) {
      cell.classList.add('selected');
    }

    if (slot) {
      cell.classList.add('has-widget');
      cell.setAttribute('draggable', 'true');
      cell.dataset.slotId = slot.id;

      var icon = document.createElement('div');
      icon.className = 'cell-icon';
      icon.textContent = WIDGET_ICONS[slot.type] || '?';

      var typeLabel = document.createElement('div');
      typeLabel.className = 'cell-type';
      typeLabel.textContent = WIDGET_LABELS[slot.type] || slot.type;

      cell.appendChild(icon);
      cell.appendChild(typeLabel);

      if (slot.type === 'camera' && slot.config && slot.config.name) {
        var nameDiv = document.createElement('div');
        nameDiv.className = 'cell-name';
        nameDiv.textContent = slot.config.name;
        cell.appendChild(nameDiv);
      }

      cell.addEventListener('dragstart', onDragStart);
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
    dragSlotId = evt.currentTarget.dataset.slotId;
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

    var oldRow = slotA.row;
    var oldCol = slotA.col;
    slotA.row  = targetRow;
    slotA.col  = targetCol;
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

    // Type selector
    panel.appendChild(makeFormGroup('Widget Type', function () {
      var sel = document.createElement('select');
      sel.id = 'cfg-type';
      [['camera', 'Camera'], ['temperature', 'Temperature'], ['clock', 'Clock'], ['stocks', 'Markets'], ['news', 'Headlines'], ['empty', 'Empty (remove)']].forEach(function (pair) {
        var o = document.createElement('option');
        o.value = pair[0];
        o.textContent = pair[1];
        if (pair[0] === currentType) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () { applyType(this.value); });
      return sel;
    }));

    // Camera-specific fields
    if (currentType === 'camera') {
      panel.appendChild(makeFormGroup('Camera Name', function () {
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.id = 'cfg-cam-name';
        inp.value = cfg.name || '';
        return inp;
      }));
      panel.appendChild(makeFormGroup('Ring Camera Index', function () {
        var inp = document.createElement('input');
        inp.type = 'number';
        inp.id = 'cfg-cam-index';
        inp.min = '0';
        inp.value = cfg.index != null ? cfg.index : 0;
        return inp;
      }));
    }

    if (slot) {
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
      removeBtn.addEventListener('click', function () {
        removeSlot(selectedCell.row, selectedCell.col);
      });
      panel.appendChild(removeBtn);
    }
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

  function applyType(newType) {
    if (!selectedCell) return;
    var slot = slotAt(selectedCell.row, selectedCell.col);

    if (newType === 'empty') { removeSlot(selectedCell.row, selectedCell.col); return; }

    if (slot) {
      if (slot.type !== newType) {
        slot.type   = newType;
        slot.config = newType === 'camera' ? { name: 'Camera', index: 0 } : {};
      }
    } else {
      layout.slots.push({
        id:      newType + '-' + Date.now(),
        type:    newType,
        row:     selectedCell.row,
        col:     selectedCell.col,
        rowSpan: 1,
        colSpan: 1,
        config:  newType === 'camera' ? { name: 'Camera', index: 0 } : {},
      });
    }
    renderGrid();
    renderConfigPanel();
  }

  function applyConfig() {
    if (!selectedCell) return;
    var slot = slotAt(selectedCell.row, selectedCell.col);
    if (!slot || slot.type !== 'camera') return;
    var nameEl  = document.getElementById('cfg-cam-name');
    var indexEl = document.getElementById('cfg-cam-index');
    if (nameEl)  slot.config.name  = nameEl.value.trim() || 'Camera';
    if (indexEl) slot.config.index = Math.max(0, parseInt(indexEl.value, 10) || 0);
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

  loadLayout();
}());
