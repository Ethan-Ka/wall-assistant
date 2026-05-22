'use strict';

(function () {
  var ws;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ── Grid rendering ────────────────────────────────────

  function renderLayout(layout) {
    var grid = document.getElementById('grid');
    var g = layout.grid;
    grid.style.gridTemplateColumns = 'repeat(' + g.cols + ', 1fr)';
    grid.style.gridTemplateRows = 'repeat(' + g.rows + ', 1fr)';
    grid.innerHTML = '';
    layout.slots.forEach(function (slot) {
      grid.appendChild(createCard(slot));
    });
  }

  // Static SVG markup — no user data, safe to use as innerHTML
  var CAMERA_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 ' +
      '0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 ' +
      '002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 9.75v9A2.25 ' +
      '2.25 0 004.5 18.75z"/>' +
    '</svg>';

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  function svgEl(tag) {
    return document.createElementNS(SVG_NS, tag);
  }

  function createCard(slot) {
    var card = el('div', 'card');
    card.id = slot.id;
    card.dataset.slotType = slot.type;
    card.style.gridColumn = slot.col + ' / span ' + (slot.colSpan || 1);
    card.style.gridRow    = slot.row + ' / span ' + (slot.rowSpan || 1);

    if (slot.type === 'camera') {
      card.classList.add('camera-card');

      var placeholder = el('div', 'camera-placeholder');
      placeholder.innerHTML = CAMERA_SVG; // static constant — no user data

      var img = el('img', 'camera-img');
      img.src = '';
      img.alt = (slot.config && slot.config.name) || 'Camera';

      var label = el('div', 'camera-label');
      label.textContent = (slot.config && slot.config.name) || 'Camera';

      card.appendChild(placeholder);
      card.appendChild(img);
      card.appendChild(label);
      card.addEventListener('click', function () { openCameraExpand(slot.id); });

    } else if (slot.type === 'temperature') {
      card.classList.add('temp-card');

      var primary = el('div', 'temp-primary');
      var tempVal = el('div', 'temp-value'); tempVal.id = 'temp-value'; tempVal.textContent = '--°';
      var tempLbl = el('div', 'temp-label'); tempLbl.id = 'temp-label'; tempLbl.textContent = 'Outdoor';
      primary.appendChild(tempVal);
      primary.appendChild(tempLbl);

      var secondary = el('div', 'temp-secondary'); secondary.id = 'temp-secondary'; secondary.style.display = 'none';
      var secVal  = el('div', 'temp-secondary-value');  secVal.id  = 'temp-secondary-value';  secVal.textContent  = '--°';
      var secLbl  = el('div', 'temp-secondary-label');  secLbl.id  = 'temp-secondary-label';  secLbl.textContent  = 'Outdoor';
      secondary.appendChild(secVal);
      secondary.appendChild(secLbl);

      var cond = el('div', 'temp-condition'); cond.id = 'temp-condition'; cond.textContent = 'Loading…';
      var hilo = el('div', 'temp-hilo');      hilo.id = 'temp-hilo';

      card.appendChild(primary);
      card.appendChild(secondary);
      card.appendChild(cond);
      card.appendChild(hilo);

    } else if (slot.type === 'clock') {
      card.classList.add('clock-card');

      var time = el('div', 'clock-time'); time.id = 'clock-time'; time.textContent = '--:--';
      var date = el('div', 'clock-date'); date.id = 'clock-date';
      card.appendChild(time);
      card.appendChild(date);
      updateClock();

    } else if (slot.type === 'stocks') {
      card.classList.add('stocks-card');
      var stocksHeader = el('div', 'stocks-header');
      stocksHeader.textContent = 'Markets';
      var stocksList = el('div', 'stocks-list');
      stocksList.id = 'stocks-list-' + slot.id;
      card.appendChild(stocksHeader);
      card.appendChild(stocksList);

    } else if (slot.type === 'news') {
      card.classList.add('news-card');
      var newsHeader = el('div', 'news-header');
      newsHeader.textContent = 'Top Headlines';
      var newsWrap = el('div', 'news-scroll-wrap');
      var newsTrack = el('div', 'news-scroll-track');
      newsTrack.dataset.slotId = slot.id;
      newsWrap.appendChild(newsTrack);
      card.appendChild(newsHeader);
      card.appendChild(newsWrap);
    }

    return card;
  }

  // ── Camera expand overlay ─────────────────────────────

  var cameraData = {};

  var overlay    = document.getElementById('camera-overlay');
  var overlayImg = document.getElementById('camera-overlay-img');
  var overlayLbl = document.getElementById('camera-overlay-label');

  function openCameraExpand(slotId) {
    var data = cameraData[slotId];
    if (!data) return;
    overlayImg.src = data.url;
    overlayLbl.textContent = data.name;
    overlay.classList.add('active');
  }

  function closeCameraExpand() {
    overlay.classList.remove('active');
  }

  overlay.addEventListener('click', closeCameraExpand);
  document.getElementById('camera-overlay-close').addEventListener('click', function (e) {
    e.stopPropagation();
    closeCameraExpand();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeCameraExpand();
  });

  // ── Data update handlers ──────────────────────────────

  function formatF(val) {
    return val != null ? Math.round(val) + '°F' : '--°';
  }

  function updateTemperature(temp) {
    var valEl    = document.getElementById('temp-value');
    var labelEl  = document.getElementById('temp-label');
    var condEl   = document.getElementById('temp-condition');
    var secRow   = document.getElementById('temp-secondary');
    var secVal   = document.getElementById('temp-secondary-value');
    var secLabel = document.getElementById('temp-secondary-label');
    if (!valEl) return;

    var outdoor = temp.outdoor || temp;
    var indoor  = temp.indoor  || null;

    if (indoor) {
      valEl.textContent    = formatF(indoor.fahrenheit);
      labelEl.textContent  = 'Indoor';
      secVal.textContent   = formatF(outdoor.fahrenheit);
      secLabel.textContent = 'Outdoor';
      secRow.style.display = 'flex';
    } else {
      valEl.textContent    = formatF(outdoor.fahrenheit);
      labelEl.textContent  = 'Outdoor';
      secRow.style.display = 'none';
    }

    condEl.textContent = outdoor.condition || '';

    var hiloEl = document.getElementById('temp-hilo');
    if (hiloEl) {
      hiloEl.textContent = (outdoor.highF != null && outdoor.lowF != null)
        ? 'H:' + outdoor.highF + '°  L:' + outdoor.lowF + '°'
        : '';
    }
  }

  // ── Sparkline SVG (DOM-built — no innerHTML with user data) ──

  function buildSparkline(values, isUp) {
    if (!values || values.length < 2) return null;
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = max - min || 1;
    var W = 100, H = 32;

    var pts = values.map(function (v, i) {
      var x = (i / (values.length - 1)) * W;
      var y = H - ((v - min) / range) * (H - 2) - 1;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');

    var color = isUp ? '#1db954' : '#e9534f';

    var first = values[0], last = values[values.length - 1];
    var y0 = (H - ((first - min) / range) * (H - 2) - 1).toFixed(1);
    var y1 = (H - ((last  - min) / range) * (H - 2) - 1).toFixed(1);
    var fillPts = '0,' + H + ' ' + pts + ' ' + W.toFixed(1) + ',' + H;

    var svg = svgEl('svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');

    var poly = svgEl('polygon');
    poly.setAttribute('points', fillPts);
    poly.setAttribute('fill', color);
    poly.setAttribute('fill-opacity', '0.12');

    var line = svgEl('polyline');
    line.setAttribute('points', pts);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '1.8');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');

    svg.appendChild(poly);
    svg.appendChild(line);
    return svg;
  }

  function fmtPrice(price, symbol) {
    if (price == null) return '--';
    if (symbol === 'DOW' || symbol === 'S&P 500') {
      return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function clearEl(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function updateStocks(stocks) {
    document.querySelectorAll('[id^="stocks-list-"]').forEach(function (listEl) {
      clearEl(listEl);
      stocks.forEach(function (s) {
        var item = el('div', 'stocks-item');

        var header = el('div', 'stocks-item-header');
        var sym = el('span', 'stocks-symbol');
        sym.textContent = s.symbol;

        var isUp = s.changePct != null && s.changePct >= 0;
        var pct = el('span', 'stocks-change');
        if (s.changePct != null) {
          pct.textContent = (isUp ? '+' : '') + s.changePct.toFixed(2) + '%';
          pct.classList.add(isUp ? 'up' : 'down');
        } else {
          pct.textContent = '--';
        }
        header.appendChild(sym);
        header.appendChild(pct);

        var price = el('div', 'stocks-price');
        price.textContent = fmtPrice(s.price, s.symbol);

        var chart = el('div', 'stocks-chart');
        var sparkSvg = buildSparkline(s.sparkline, isUp);
        if (sparkSvg) chart.appendChild(sparkSvg);

        item.appendChild(header);
        item.appendChild(price);
        item.appendChild(chart);
        listEl.appendChild(item);
      });
    });
  }

  function updateHeadlines(headlines) {
    document.querySelectorAll('.news-scroll-track').forEach(function (track) {
      clearEl(track);
      if (!headlines || !headlines.length) {
        var empty = el('div', 'news-item');
        empty.textContent = 'No headlines available';
        track.appendChild(empty);
        return;
      }
      headlines.forEach(function (hl) {
        var title = typeof hl === 'string' ? hl : hl.title;
        var imageUrl = hl && hl.imageUrl ? hl.imageUrl : null;

        var item = el('div', 'news-item');
        if (!imageUrl) item.classList.add('news-item-no-img');

        if (imageUrl) {
          var img = el('img', 'news-item-img');
          img.alt = '';
          img.src = imageUrl; // URL from BBC RSS feed
          item.appendChild(img);
        }

        var titleEl = el('div', 'news-item-title');
        titleEl.textContent = title;
        item.appendChild(titleEl);
        track.appendChild(item);
      });
    });
  }

  function updateCameras(cameras) {
    cameras.forEach(function (cam) {
      var slotId = cam.slotId;
      var card   = slotId && document.getElementById(slotId);
      var img    = card && card.querySelector('.camera-img');
      var nameEl = card && card.querySelector('.camera-label');
      if (!img) return;
      if (cam.name && nameEl) nameEl.textContent = cam.name;
      if (cam.snapshotUrl) {
        img.src = cam.snapshotUrl;
        img.classList.add('loaded');
        cameraData[slotId] = { url: cam.snapshotUrl, name: cam.name || slotId };
      }
    });
  }

  function updateClock() {
    var now    = new Date();
    var h      = now.getHours().toString().padStart(2, '0');
    var m      = now.getMinutes().toString().padStart(2, '0');
    var timeEl = document.getElementById('clock-time');
    var dateEl = document.getElementById('clock-date');
    if (timeEl) timeEl.textContent = h + ':' + m;
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  }

  // ── WebSocket ─────────────────────────────────────────

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host);

    ws.addEventListener('message', function (evt) {
      try {
        var data = JSON.parse(evt.data);
        if (data.type === 'layout') renderLayout(data.layout);
        if (data.type === 'update') {
          if (data.temperature) updateTemperature(data.temperature);
          if (data.cameras)     updateCameras(data.cameras);
          if (data.stocks)      updateStocks(data.stocks);
          if (data.headlines)   updateHeadlines(data.headlines);
        }
      } catch (_) {}
    });

    ws.addEventListener('close', function () {
      setTimeout(connect, 2000);
    });
  }

  setInterval(updateClock, 1000);

  fetch('/api/layout')
    .then(function (r) { return r.json(); })
    .then(function (layout) { renderLayout(layout); })
    .catch(function () {});

  connect();

  var wakeLockSentinel = null; // eslint-disable-line no-unused-vars
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLockSentinel = lock;
    }).catch(function () {});
  }
  requestWakeLock();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
}());
