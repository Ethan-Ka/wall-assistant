'use strict';

(function () {
  var ws;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function isOlderIosSafari() {
    var ua = navigator.userAgent || '';
    var isIosDevice = /iP(ad|hone|od)/.test(ua) || (ua.indexOf('Macintosh') >= 0 && 'ontouchend' in document);
    if (!isIosDevice) return false;

    var versionMatch = ua.match(/Version\/(\d+)/);
    if (!versionMatch) return false;

    return parseInt(versionMatch[1], 10) < 26;
  }

  if (isOlderIosSafari()) {
    document.documentElement.classList.add('ios-safari-older');
  }

  // Populated each time the layout renders; drives per-widget config (clock format, temp units, etc.)
  var slotsByType = {}; // type -> first slot of that type
  var pendingClientErrors = [];
  var maxPendingClientErrors = 8;
  var reconnectTimer = null;
  var websocketErrorTimer = null;
  var websocketFailureReported = false;
  var STALE_THRESHOLD_MS = 20 * 60 * 1000; // 20 min ≈ 2 missed 10-min snapshot intervals
  var LOW_BATTERY_THRESHOLD = 15;

  // ── Grid rendering ────────────────────────────────────

  function renderLayout(layout) {
    var grid = document.getElementById('grid');
    var g    = layout.grid;

    var colSizes = g.colSizes || Array(g.cols).fill(1);
    var rowSizes = g.rowSizes || Array(g.rows).fill(1);
    grid.style.gridTemplateColumns = colSizes.map(function (v) { return v + 'fr'; }).join(' ');
    grid.style.gridTemplateRows    = rowSizes.map(function (v) { return v + 'fr'; }).join(' ');

    while (grid.firstChild) grid.removeChild(grid.firstChild);
    slotsByType = {};
    layout.slots.forEach(function (slot) {
      if (!slotsByType[slot.type]) slotsByType[slot.type] = slot;
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

  function isScrollableRegion(node) {
    while (node && node !== document.body) {
      if (node.classList && node.classList.contains('news-scroll-wrap')) return true;
      node = node.parentNode;
    }
    return false;
  }

  function bindTap(node, handler) {
    var moved = false;
    node.addEventListener('touchstart', function () { moved = false; }, { passive: true });
    node.addEventListener('touchmove', function () { moved = true; },  { passive: true });
    // click fires immediately on iOS when user-scalable=no (no 300ms delay),
    // and is unaffected by touch-action — more reliable than touchend on iOS 17.
    node.addEventListener('click', function () {
      if (moved) { moved = false; return; }
      handler();
    });
  }

  function installScrollLockFallback() {
    document.addEventListener('touchmove', function (e) {
      if (isScrollableRegion(e.target)) return;
      e.preventDefault();
    }, { passive: false });
  }

  function makeSkeleton(cls, style) {
    var node = el('div', cls ? 'skeleton ' + cls : 'skeleton');
    if (style) node.style.cssText = style;
    return node;
  }

  function queueClientError(source, message, detail) {
    pendingClientErrors.unshift({
      type: 'client-error',
      source: source,
      message: message,
      detail: detail,
      href: location.href,
      time: new Date().toISOString(),
    });
    if (pendingClientErrors.length > maxPendingClientErrors) {
      pendingClientErrors.length = maxPendingClientErrors;
    }
    flushClientErrors();
  }

  function flushClientErrors() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !pendingClientErrors.length) return;
    while (pendingClientErrors.length) {
      var entry = pendingClientErrors.pop();
      try {
        ws.send(JSON.stringify(entry));
      } catch (_) {
        pendingClientErrors.push(entry);
        break;
      }
    }
  }

  function reportClientError(source, message, detail) {
    queueClientError(source, message, detail);
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


      var video = el('video', 'camera-video');
      video.autoplay = true;
      video.muted    = true;
      video.setAttribute('playsinline', '');
      video.addEventListener('error', function () {
        var src = video.getAttribute('src');
        if (!src || src === '') return;
        reportClientError('camera', 'Live video failed to load', (slot.config && slot.config.name) || slot.id);
      });

      var label = el('div', 'camera-label');
      label.textContent = (slot.config && slot.config.name) || 'Camera';

      card.appendChild(placeholder);
      card.appendChild(img);
      card.appendChild(video);
      card.appendChild(label);
      card.onclick = function () {
        var d = cameraData[slot.id];
        if (d && d.lowBattery) return;
        openCameraExpand(slot.id);
      };

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
      stocksHeader.textContent = (slot.config && slot.config.title) || 'Markets';
      var stocksList = el('div', 'stocks-list');
      stocksList.id = 'stocks-list-' + slot.id;
      var stockCount = Math.max(2, Math.min(4, (slot.config && slot.config.symbols ? slot.config.symbols.split(',').length : 3)));
      for (var si = 0; si < stockCount; si++) {
        var stockSkeleton = el('div', 'stocks-item');
        var stockHead = el('div', 'stocks-item-header');
        stockHead.appendChild(makeSkeleton('', 'height: 0.9em; width: 42%; border-radius: 999px;'));
        stockHead.appendChild(makeSkeleton('', 'height: 0.9em; width: 22%; border-radius: 999px;'));
        stockSkeleton.appendChild(stockHead);
        stockSkeleton.appendChild(makeSkeleton('', 'height: 1.2em; width: 34%; margin-top: 4px; border-radius: 999px;'));
        stockSkeleton.appendChild(makeSkeleton('', 'height: 32px; width: 100%; margin-top: 8px; border-radius: 6px;'));
        stocksList.appendChild(stockSkeleton);
      }
      card.appendChild(stocksHeader);
      card.appendChild(stocksList);

    } else if (slot.type === 'news') {
      card.classList.add('news-card');
      var newsHeader = el('div', 'news-header');
      newsHeader.textContent = (slot.config && slot.config.title) || 'Top Headlines';
      var newsWrap = el('div', 'news-scroll-wrap');
      var newsTrack = el('div', 'news-scroll-track');
      newsTrack.dataset.slotId = slot.id;
      for (var ni = 0; ni < 4; ni++) {
        var newsItem = el('div', 'news-item news-item-no-img');
        newsItem.appendChild(makeSkeleton('', 'height: 100%; width: 100%; min-height: 64px; border-radius: 8px;'));
        newsTrack.appendChild(newsItem);
      }
      newsWrap.appendChild(newsTrack);
      card.appendChild(newsHeader);
      card.appendChild(newsWrap);

    } else if (slot.type === 'iss') {
      card.classList.add('iss-card');

      var issHdr = el('div', 'iss-header'); issHdr.textContent = 'ISS Tracker';

      var issPos = el('div', 'iss-position');
      var issLat = el('div', 'iss-coord iss-lat'); issLat.textContent = '--° N';
      var issLon = el('div', 'iss-coord iss-lon'); issLon.textContent = '--° W';
      issPos.appendChild(issLat); issPos.appendChild(issLon);

      var issStats = el('div', 'iss-stats');

      var altStat = el('div', 'iss-stat');
      var altVal  = el('div', 'iss-stat-value iss-alt-val'); altVal.textContent = '--';
      var altLbl  = el('div', 'iss-stat-label'); altLbl.textContent = 'km altitude';
      altStat.appendChild(altVal); altStat.appendChild(altLbl);

      var velStat = el('div', 'iss-stat');
      var velVal  = el('div', 'iss-stat-value iss-vel-val'); velVal.textContent = '--';
      var velLbl  = el('div', 'iss-stat-label'); velLbl.textContent = 'km/h';
      velStat.appendChild(velVal); velStat.appendChild(velLbl);

      var distStat = el('div', 'iss-stat');
      var distVal  = el('div', 'iss-stat-value iss-dist-val'); distVal.textContent = '--';
      var distLbl  = el('div', 'iss-stat-label'); distLbl.textContent = 'km from you';
      distStat.appendChild(distVal); distStat.appendChild(distLbl);

      issStats.appendChild(altStat); issStats.appendChild(velStat); issStats.appendChild(distStat);
      card.appendChild(issHdr); card.appendChild(issPos); card.appendChild(issStats);

      if (!slot.config || slot.config.showFlights !== 'false') {
        var flightsSec = el('div', 'iss-flights-section');
        var flightsHdr = el('div', 'iss-flights-header'); flightsHdr.textContent = 'Overhead';
        var flightsList = el('div', 'iss-flights-list');
        flightsList.appendChild(makeSkeleton('', 'height: 1em; width: 58%; margin: 2px 0 6px; border-radius: 999px;'));
        flightsList.appendChild(makeSkeleton('', 'height: 1em; width: 74%; margin: 2px 0; border-radius: 999px;'));
        flightsSec.appendChild(flightsHdr); flightsSec.appendChild(flightsList);
        card.appendChild(flightsSec);
      }

    } else if (slot.type === 'sports') {
      card.classList.add('sports-card');
      var sCfg = slot.config || {};

      var sportsLbl = el('div', 'sports-league-label');
      sportsLbl.textContent = ((sCfg.league || 'NFL') + (sCfg.team ? ' · ' + sCfg.team : '')).toUpperCase();

      var matchup = el('div', 'sports-matchup');

      var awayTeam  = el('div', 'sports-team');
      var awayAbbr  = el('div', 'sports-team-abbr sports-away-abbr'); awayAbbr.textContent = '--';
      var awayScore = el('div', 'sports-team-score sports-away-score');
      awayTeam.appendChild(awayAbbr); awayTeam.appendChild(awayScore);

      var sdivider = el('div', 'sports-divider'); sdivider.textContent = '@';

      var homeTeam  = el('div', 'sports-team');
      var homeAbbr  = el('div', 'sports-team-abbr sports-home-abbr'); homeAbbr.textContent = '--';
      var homeScore = el('div', 'sports-team-score sports-home-score');
      homeTeam.appendChild(homeAbbr); homeTeam.appendChild(homeScore);

      matchup.appendChild(awayTeam); matchup.appendChild(sdivider); matchup.appendChild(homeTeam);

      var sportsStatus = el('div', 'sports-status-text'); sportsStatus.textContent = 'Loading…';

      card.appendChild(sportsLbl); card.appendChild(matchup); card.appendChild(sportsStatus);

    } else if (slot.type === 'nowplaying') {
      card.classList.add('nowplaying-card');

      var npArtPh = el('div', 'nowplaying-art nowplaying-art-placeholder');
      npArtPh.textContent = '♪';

      var npArt = el('img', 'nowplaying-art nowplaying-art-img');
      npArt.src = ''; npArt.alt = 'Album Art'; npArt.style.display = 'none';

      var npInfo   = el('div', 'nowplaying-info');
      var npTrack  = el('div', 'nowplaying-track');  npTrack.textContent = 'Not Playing';
      var npArtist = el('div', 'nowplaying-artist');
      var npAlbum  = el('div', 'nowplaying-album');
      var npDevice = el('div', 'nowplaying-device');
      var npContext = el('div', 'nowplaying-context');
      var npBar    = el('div', 'nowplaying-bar');
      var npFill   = el('div', 'nowplaying-bar-fill'); npFill.style.width = '0%';
      npBar.appendChild(npFill);
      npInfo.appendChild(npTrack); npInfo.appendChild(npArtist);
      npInfo.appendChild(npAlbum); npInfo.appendChild(npDevice);
      npInfo.appendChild(npContext); npInfo.appendChild(npBar);

      card.appendChild(npArtPh); card.appendChild(npArt); card.appendChild(npInfo);
    }

    return card;
  }

  // ── HLS helpers ───────────────────────────────────────

  // Attach an HLS stream to a video element, using hls.js on non-Safari
  // or native src assignment on Safari (which supports HLS natively).
  function attachHls(videoEl, url) {
    detachHls(videoEl);
    videoEl.loop = false;
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      var hls = new Hls({ lowLatencyMode: false, debug: false });
      hls.loadSource(url);
      hls.attachMedia(videoEl);
      videoEl._hls = hls;
    } else {
      videoEl.src = url;
    }
    videoEl.play().catch(function () {});
  }

  function detachHls(videoEl) {
    if (videoEl._hls) { videoEl._hls.destroy(); videoEl._hls = null; }
    videoEl.src = '';
    videoEl.load();
  }

  // ── Camera expand overlay ─────────────────────────────

  // keyed by slotId — populated by updateCameras
  // { camIndex, name, lastUpdated, url (snapshot), motionClipUrl, streamUrl }
  var cameraData = {};

  var overlay       = document.getElementById('camera-overlay');
  var overlayImg    = document.getElementById('camera-overlay-img');
  var overlayVideo  = document.getElementById('camera-overlay-video');
  var overlayStatus = document.getElementById('camera-overlay-status');
  var overlayLbl    = document.getElementById('camera-overlay-label');
  var bodyScrollLock = null;
  var currentOverlaySlotId = null;

  var streamStartTime   = null;  // set when HLS stream is live; null otherwise
  var idleTimeoutId     = null;  // fires after IDLE_MS of no activity
  var idleCountdownId   = null;  // fires to auto-close after prompt appears
  var idleCountdownSecs = 0;     // remaining seconds shown on the bar
  var IDLE_MS           = 2 * 60 * 1000; // 2 minutes
  var IDLE_COUNTDOWN_S  = 30;            // seconds before auto-close

  function lockBodyScroll() {
    if (bodyScrollLock) return;
    var body = document.body;
    var scrollY = window.pageYOffset || window.scrollY || 0;

    bodyScrollLock = {
      scrollY: scrollY,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow
    };

    body.style.position = 'fixed';
    body.style.top = '-' + scrollY + 'px';
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
  }

  function unlockBodyScroll() {
    if (!bodyScrollLock) return;
    var body = document.body;
    var state = bodyScrollLock;

    body.style.position = state.position;
    body.style.top = state.top;
    body.style.left = state.left;
    body.style.right = state.right;
    body.style.width = state.width;
    body.style.overflow = state.overflow;

    bodyScrollLock = null;
    window.scrollTo(0, state.scrollY);
  }

  function formatStreamDuration() {
    if (!streamStartTime) return '';
    var secs = Math.floor((Date.now() - streamStartTime) / 1000);
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    return 'Live · ' + m + ':' + String(s).padStart(2, '0');
  }

  function showIdlePrompt() {
    var prompt = document.getElementById('camera-idle-prompt');
    var fill   = document.getElementById('camera-idle-bar-fill');
    idleCountdownSecs = IDLE_COUNTDOWN_S;
    if (fill) fill.style.width = '100%';
    prompt.classList.add('active');

    // Decrement the bar every second; auto-close when it hits zero
    idleCountdownId = setInterval(function () {
      idleCountdownSecs--;
      if (fill) fill.style.width = Math.max(0, (idleCountdownSecs / IDLE_COUNTDOWN_S) * 100) + '%';
      if (idleCountdownSecs <= 0) {
        clearInterval(idleCountdownId);
        idleCountdownId = null;
        closeCameraExpand();
      }
    }, 1000);
  }

  function hideIdlePrompt() {
    if (idleCountdownId) { clearInterval(idleCountdownId); idleCountdownId = null; }
    var prompt = document.getElementById('camera-idle-prompt');
    prompt.classList.remove('active');
    var fill = document.getElementById('camera-idle-bar-fill');
    if (fill) fill.style.width = '100%';
  }

  function resetIdleTimer() {
    hideIdlePrompt();
    clearTimeout(idleTimeoutId);
    if (overlay.classList.contains('active')) {
      idleTimeoutId = setTimeout(showIdlePrompt, IDLE_MS);
    }
  }

  function openCameraExpand(slotId) {
    var data = cameraData[slotId];
    if (!data || data.lowBattery) return;
    currentOverlaySlotId = slotId;
    streamStartTime = null;
    updateCameraLabel(overlayLbl, data);

    // Show snapshot immediately as background while stream starts
    overlayVideo.classList.remove('active');
    detachHls(overlayVideo);
    if (data.url) {
      overlayImg.style.display = '';
      overlayImg.src = data.url;
    } else {
      overlayImg.style.display = 'none';
    }

    overlayStatus.textContent = 'Starting stream…';
    overlayStatus.classList.add('visible');

    overlay.classList.add('active');
    resetIdleTimer();

    var camIndex = data.camIndex;
    fetch('/api/stream/' + camIndex + '/start', { method: 'POST' })
      .then(function (r) {
        return r.json().then(function (body) { return { ok: r.ok, body: body }; });
      })
      .then(function (resp) {
        if (currentOverlaySlotId !== slotId) return;
        if (!resp.ok) {
          overlayStatus.textContent = resp.body.error || 'Stream unavailable';
          // Keep status visible to show the error message
          return;
        }
        overlayStatus.classList.remove('visible');
        if (resp.body.hlsUrl) {
          overlayImg.style.display = 'none';
          overlayVideo.classList.add('active');
          attachHls(overlayVideo, resp.body.hlsUrl);
          streamStartTime = Date.now();
        }
        // On timeout, snapshot remains visible as fallback
      })
      .catch(function () {
        if (currentOverlaySlotId === slotId) overlayStatus.classList.remove('visible');
      });
  }

  function closeCameraExpand() {
    var closingSlotId = currentOverlaySlotId;
    hideIdlePrompt();
    clearTimeout(idleTimeoutId);
    idleTimeoutId = null;
    streamStartTime = null;
    overlay.classList.remove('active');
    overlayVideo.classList.remove('active');
    detachHls(overlayVideo);
    overlayImg.style.display = '';
    overlayStatus.classList.remove('visible');
    currentOverlaySlotId = null;

    // Stop the live stream to save battery
    if (closingSlotId && cameraData[closingSlotId]) {
      var camIdx = cameraData[closingSlotId].camIndex;
      fetch('/api/stream/' + camIdx + '/stop', { method: 'POST' }).catch(function () {});
    }
  }

  function formatCameraAge(updatedAt) {
    if (!updatedAt) return '';
    var timestamp = new Date(updatedAt).getTime();
    if (!isFinite(timestamp)) return '';

    var seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) {
      return seconds <= 1 ? '1s ago' : seconds + 's ago';
    }

    return Math.floor(seconds / 60) + 'm ago';
  }

  function updateCameraLabel(labelEl, data, ageOverride) {
    if (!labelEl || !data) return;
    var ageText = ageOverride !== undefined ? ageOverride : formatCameraAge(data.lastUpdated);
    while (labelEl.firstChild) labelEl.removeChild(labelEl.firstChild);

    var nameEl = el('span', 'camera-label-name');
    nameEl.textContent = data.name;
    labelEl.appendChild(nameEl);

    if (ageText) {
      var ageEl = el('span', 'camera-label-age');
      ageEl.textContent = ageText;
      labelEl.appendChild(ageEl);
    }

    if (data.battery != null) {
      var batEl = el('span', 'camera-label-battery');
      batEl.textContent = data.battery + '%';
      if (data.battery < LOW_BATTERY_THRESHOLD) batEl.classList.add('low');
      labelEl.appendChild(batEl);
    }
  }

  function refreshCameraAges() {
    Object.keys(cameraData).forEach(function (slotId) {
      var data = cameraData[slotId];
      var card = document.getElementById(slotId);
      if (card) {
        updateCameraLabel(card.querySelector('.camera-label'), data);
      }
    });

    if (currentOverlaySlotId && overlay.classList.contains('active')) {
      var ageOverride = streamStartTime ? formatStreamDuration() : undefined;
      updateCameraLabel(overlayLbl, cameraData[currentOverlaySlotId], ageOverride);
    }
  }

  overlay.onclick = function () { closeCameraExpand(); };
  document.getElementById('camera-overlay-close').onclick = function (e) {
    e.stopPropagation();
    closeCameraExpand();
  };
  document.getElementById('camera-idle-yes').onclick = function (e) {
    e.stopPropagation();
    resetIdleTimer();
  };
  // Any interaction resets the idle timer while the overlay is open
  document.addEventListener('click',      function () { if (currentOverlaySlotId) resetIdleTimer(); });
  document.addEventListener('touchstart', function () { if (currentOverlaySlotId) resetIdleTimer(); }, { passive: true });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeCameraExpand();
  });

  installScrollLockFallback();

  // ── Data update handlers ──────────────────────────────

  function formatTemp(fahrenheit, celsius, units) {
    if (units === 'celsius') {
      var c = celsius != null ? celsius : (fahrenheit != null ? (fahrenheit - 32) * 5 / 9 : null);
      return (c != null ? Math.round(c) : '--') + '°C';
    }
    return (fahrenheit != null ? Math.round(fahrenheit) : '--') + '°F';
  }

  function formatHiLo(highF, lowF, units) {
    if (highF == null || lowF == null) return '';
    if (units === 'celsius') {
      return 'H:' + Math.round((highF - 32) * 5 / 9) + '°  L:' + Math.round((lowF - 32) * 5 / 9) + '°';
    }
    return 'H:' + highF + '°  L:' + lowF + '°';
  }

  function updateTemperature(temp) {
    var valEl    = document.getElementById('temp-value');
    var labelEl  = document.getElementById('temp-label');
    var condEl   = document.getElementById('temp-condition');
    var secRow   = document.getElementById('temp-secondary');
    var secVal   = document.getElementById('temp-secondary-value');
    var secLabel = document.getElementById('temp-secondary-label');
    if (!valEl) return;

    var tempSlot = slotsByType['temperature'];
    var units    = (tempSlot && tempSlot.config && tempSlot.config.units) || 'fahrenheit';

    var outdoor = temp.outdoor || temp;
    var indoor  = temp.indoor  || null;

    if (indoor) {
      valEl.textContent    = formatTemp(indoor.fahrenheit, indoor.celsius, units);
      labelEl.textContent  = 'Indoor';
      secVal.textContent   = formatTemp(outdoor.fahrenheit, outdoor.celsius, units);
      secLabel.textContent = 'Outdoor';
      secRow.style.display = 'flex';
    } else {
      valEl.textContent    = formatTemp(outdoor.fahrenheit, outdoor.celsius, units);
      labelEl.textContent  = 'Outdoor';
      secRow.style.display = 'none';
    }

    condEl.textContent = outdoor.condition || '';

    var hiloEl = document.getElementById('temp-hilo');
    if (hiloEl) {
      var hiloText = formatHiLo(outdoor.highF, outdoor.lowF, units);
      // Append humidity and feels-like when available
      if (outdoor.humidity != null) {
        hiloText += (hiloText ? '  ' : '') + 'Hum: ' + outdoor.humidity + '%';
      }
      var feels = null;
      if (units === 'celsius') {
        feels = outdoor.feels_celsius != null ? Math.round(outdoor.feels_celsius) + '°C' : null;
      } else {
        feels = outdoor.feels_fahrenheit != null ? Math.round(outdoor.feels_fahrenheit) + '°F' : null;
      }
      if (feels) {
        hiloText += (hiloText ? '  ' : '') + 'Feels: ' + feels;
      }
      hiloEl.textContent = hiloText;
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

  // stocks is [{slotId, items}]
  function updateStocks(stocksArr) {
    stocksArr.forEach(function (entry) {
      var listEl = document.getElementById('stocks-list-' + entry.slotId);
      if (!listEl) return;
      clearEl(listEl);
      (entry.items || []).forEach(function (s) {
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

  // headlinesArr is [{slotId, items: [{title, imageUrl}]}]
  function updateHeadlines(headlinesArr) {
    headlinesArr.forEach(function (entry) {
      var track = document.querySelector('.news-scroll-track[data-slot-id="' + entry.slotId + '"]');
      if (!track) return;
      clearEl(track);
      var items = entry.items || [];
      if (!items.length) {
        var empty = el('div', 'news-item');
        empty.textContent = 'No headlines available';
        track.appendChild(empty);
        return;
      }
      // Duplicate list so the CSS translate(-50%) loop is seamless
      var doubled = items.concat(items);
      doubled.forEach(function (hl) {
        var title    = typeof hl === 'string' ? hl : hl.title;
        var imageUrl = hl && hl.imageUrl ? hl.imageUrl : null;
        var item = el('div', 'news-item');
        if (!imageUrl) item.classList.add('news-item-no-img');
        if (imageUrl) {
          var img = el('img', 'news-item-img');
          img.alt = ''; img.src = imageUrl;
          item.appendChild(img);
        }
        var titleEl = el('div', 'news-item-title'); titleEl.textContent = title;
        item.appendChild(titleEl);
        track.appendChild(item);
      });
      track.style.animationDuration = (items.length * 5) + 's';
      track.style.animationName = 'none';
      void track.offsetHeight;
      track.style.animationName = '';
    });
  }

  function updateCameras(cameras) {
    cameras.forEach(function (cam) {
      var slotId = cam.slotId;
      var card   = slotId && document.getElementById(slotId);
      if (!card) return;
      var img    = card.querySelector('.camera-img');
      var vid    = card.querySelector('.camera-video');
      var labelEl = card.querySelector('.camera-label');

      var prev = cameraData[slotId] || {};

      // Track the moment a live stream transitions to stopped so we can hold the
      // last video frame until a fresh snapshot arrives (avoids a flash of a
      // pre-stream snapshot image).  Cleared once we successfully show fresh data.
      var streamStoppedAt = (prev.streamUrl && !cam.streamUrl)
        ? Date.now()
        : (cam.streamUrl ? null : (prev.streamStoppedAt || null));

      // Always keep cameraData current so the expand overlay has an up-to-date snapshot URL
      cameraData[slotId] = {
        camIndex:        cam.camIndex != null ? cam.camIndex : (prev.camIndex != null ? prev.camIndex : 0),
        name:            cam.name || prev.name || slotId,
        lastUpdated:     cam.streamAge || cam.snapshotAge || prev.lastUpdated || null,
        url:             cam.snapshotUrl || prev.url || null,
        streamUrl:       cam.streamUrl || null,
        motionClipUrl:   cam.motionClipUrl || null,
        battery:         cam.battery != null ? cam.battery : (prev.battery != null ? prev.battery : null),
        lowBattery:      !!cam.lowBattery,
        streamStoppedAt: streamStoppedAt,
      };

      // Apply low-battery and stale visual states (mutually exclusive — low battery wins)
      if (cam.lowBattery) {
        card.classList.add('camera-low-battery');
        card.classList.remove('camera-stale');
      } else {
        card.classList.remove('camera-low-battery');
        var snapAgeMs = cam.snapshotAge ? Date.now() - new Date(cam.snapshotAge).getTime() : Infinity;
        if (!cam.isPlaceholder && cam.snapshotAge && snapAgeMs > STALE_THRESHOLD_MS) {
          card.classList.add('camera-stale');
        } else {
          card.classList.remove('camera-stale');
        }
      }

      if (cam.streamUrl) {
        // ── Live stream mode: show the current frame from the HLS source ──
        card.classList.remove('camera-offline');
        if (img) { img.style.display = 'none'; img.classList.remove('loaded'); }
        if (vid) {
          if (prev.streamUrl !== cam.streamUrl) {
            attachHls(vid, cam.streamUrl);
          }
          vid.classList.add('active');
        }

      } else if (cam.motionClipUrl) {
        // ── Motion clip mode: loop the recording until next scheduled snapshot ──
        card.classList.remove('camera-offline');
        if (img) { img.style.display = 'none'; img.classList.remove('loaded'); }
        if (vid) {
          // Compare against previous stored URL, not vid.src (which is always absolute).
          // detachHls first in case we are transitioning away from a live stream.
          if (prev.motionClipUrl !== cam.motionClipUrl) {
            detachHls(vid);
            vid.src  = cam.motionClipUrl;
            vid.loop = true;
            vid.play().catch(function () {});
          }
          vid.classList.add('active');
        }

      } else if (cam.snapshotUrl) {
        // ── Snapshot mode ──
        // If a stream just ended, hold the last video frame until a fresh snapshot
        // arrives (< 30 s old).  Give up after 60 s so a failed takeSnapshot
        // doesn't leave the card frozen on the last stream frame indefinitely.
        card.classList.remove('camera-offline');
        var snapAgeSinceNow = cam.snapshotAge
          ? Date.now() - new Date(cam.snapshotAge).getTime()
          : Infinity;
        var streamEndedRecently = !!streamStoppedAt &&
          (Date.now() - streamStoppedAt) < 60000;
        var snapIsFresh = !streamEndedRecently || snapAgeSinceNow < 30000;

        if (snapIsFresh) {
          if (vid && (prev.motionClipUrl || prev.streamUrl)) {
            // Video source was playing — properly clean up (including any HLS instance)
            vid.classList.remove('active');
            vid.loop = false;
            detachHls(vid);
          }
          if (img) {
            img.style.display = '';
            // Compare payload URLs (both relative) to avoid constant re-assignment
            if (prev.url !== cam.snapshotUrl) img.src = cam.snapshotUrl;
            img.classList.add('loaded');
          }
          cameraData[slotId].streamStoppedAt = null; // fresh snapshot shown — clear hold
        }
        // else: keep video element active showing the last stream frame

      } else {
        // ── No data yet (initial load, placeholder SVG served by server) ──
        card.classList.remove('camera-offline');
        if (vid) { vid.classList.remove('active'); }
        if (img) { img.classList.remove('loaded'); }
      }

      updateCameraLabel(labelEl, cameraData[slotId]);
    });

    refreshCameraAges();
  }

  function updateClock() {
    var clockSlot = slotsByType['clock'];
    var clockCfg  = (clockSlot && clockSlot.config) || {};
    var is12h   = clockCfg.format !== '24h';
    var showSec = clockCfg.showSeconds === 'true';

    var now = new Date();
    var h   = now.getHours();
    var m   = now.getMinutes();
    var s   = now.getSeconds();
    var ampm = '';

    if (is12h) {
      ampm = h >= 12 ? ' PM' : ' AM';
      h    = h % 12 || 12;
    }

    var timeStr = String(h).padStart(is12h ? 1 : 2, '0') + ':' + String(m).padStart(2, '0');
    if (showSec) timeStr += ':' + String(s).padStart(2, '0');
    if (ampm)    timeStr += ampm;

    var timeEl = document.getElementById('clock-time');
    var dateEl = document.getElementById('clock-date');
    if (timeEl) timeEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  }

  // ── ISS ───────────────────────────────────────────────

  function formatCoord(val, axis) {
    if (val == null) return '--';
    var dir = axis === 'NS' ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
    return Math.abs(val).toFixed(2) + '° ' + dir;
  }

  function updateISS(data) {
    if (!data) return;
    document.querySelectorAll('.iss-card').forEach(function (card) {
      var latEl = card.querySelector('.iss-lat');
      var lonEl = card.querySelector('.iss-lon');
      var altEl  = card.querySelector('.iss-alt-val');
      var velEl  = card.querySelector('.iss-vel-val');
      var distEl = card.querySelector('.iss-dist-val');
      if (latEl)  latEl.textContent  = formatCoord(data.latitude,  'NS');
      if (lonEl)  lonEl.textContent  = formatCoord(data.longitude, 'EW');
      if (altEl)  altEl.textContent  = data.altitudeKm  != null ? data.altitudeKm.toLocaleString()  : '--';
      if (velEl)  velEl.textContent  = data.speedKmh    != null ? data.speedKmh.toLocaleString()    : '--';
      if (distEl) distEl.textContent = data.distanceKm  != null ? data.distanceKm.toLocaleString()  : '--';

      var flightsList = card.querySelector('.iss-flights-list');
      if (!flightsList) return;
      clearEl(flightsList);
      var flights = data.flights || [];
      if (!flights.length) {
        var none = el('div', 'iss-flight-empty'); none.textContent = 'No flights overhead';
        flightsList.appendChild(none);
        return;
      }
      flights.forEach(function (f) {
        var row = el('div', 'iss-flight-row');
        var cs  = el('span', 'iss-flight-callsign'); cs.textContent = f.callsign;
        var alt = el('span', 'iss-flight-alt');
        alt.textContent = f.altitudeFt != null ? f.altitudeFt.toLocaleString() + ' ft' : '';
        row.appendChild(cs); row.appendChild(alt);
        flightsList.appendChild(row);
      });
    });
  }

  // ── Sports ────────────────────────────────────────────

  function updateSports(sportsArr) {
    if (!sportsArr) return;
    sportsArr.forEach(function (entry) {
      var card = document.getElementById(entry.slotId);
      if (!card) return;
      var game = entry.game;
      if (!game) return;

      var awayAbbr  = card.querySelector('.sports-away-abbr');
      var homeAbbr  = card.querySelector('.sports-home-abbr');
      var awayScore = card.querySelector('.sports-away-score');
      var homeScore = card.querySelector('.sports-home-score');
      var statusEl  = card.querySelector('.sports-status-text');

      if (game.status === 'no_game' || game.status === 'error') {
        if (awayAbbr)  awayAbbr.textContent  = '--';
        if (homeAbbr)  homeAbbr.textContent  = '--';
        if (awayScore) awayScore.textContent = '';
        if (homeScore) homeScore.textContent = '';
        if (statusEl)  statusEl.textContent  = game.status === 'no_game' ? 'No game today' : 'Unavailable';
        return;
      }

      var showScore = game.status === 'in_progress' || game.status === 'final';
      if (awayAbbr)  awayAbbr.textContent  = (game.away && game.away.name) || '--';
      if (homeAbbr)  homeAbbr.textContent  = (game.home && game.home.name) || '--';
      if (awayScore) awayScore.textContent = showScore ? ((game.away && game.away.score) || '0') : '';
      if (homeScore) homeScore.textContent = showScore ? ((game.home && game.home.score) || '0') : '';

      var statusText = '';
      if (game.status === 'in_progress') {
        statusText = game.clock ? game.period + ' · ' + game.clock : 'In Progress';
      } else if (game.status === 'final') {
        statusText = 'Final';
      } else if (game.status === 'scheduled') {
        var d = game.date ? new Date(game.date) : null;
        statusText = d
          ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
            ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : 'Scheduled';
      }
      if (statusEl) statusEl.textContent = statusText;
    });
  }

  // ── Now Playing ───────────────────────────────────────

  function updateNowPlaying(data) {
    if (!data) return;
    window.spotifyNowPlaying = data;
    document.querySelectorAll('.nowplaying-card').forEach(function (card) {
      var artImg  = card.querySelector('.nowplaying-art-img');
      var artPh   = card.querySelector('.nowplaying-art-placeholder');
      var trackEl  = card.querySelector('.nowplaying-track');
      var artistEl = card.querySelector('.nowplaying-artist');
      var albumEl  = card.querySelector('.nowplaying-album');
      var deviceEl = card.querySelector('.nowplaying-device');
      var contextEl = card.querySelector('.nowplaying-context');
      var barFill  = card.querySelector('.nowplaying-bar-fill');
      var client = data.client || data.device || null;
      var context = data.context || null;
      var hasTrack = !!(data.track || data.itemId || data.itemUri);

      if (!hasTrack) {
        if (artImg) artImg.style.display = 'none';
        if (artPh)  artPh.style.display  = '';
        if (trackEl)  trackEl.textContent  = 'Not Playing';
        if (artistEl) artistEl.textContent = '';
        if (albumEl)  albumEl.textContent  = '';
        if (deviceEl) deviceEl.textContent = '';
        if (contextEl) contextEl.textContent = '';
        if (barFill)  barFill.style.width  = '0%';
        return;
      }

      if (data.albumArt && artImg) {
        artImg.src = data.albumArt;
        artImg.style.display = '';
        if (artPh) artPh.style.display = 'none';
      } else {
        if (artImg) artImg.style.display = 'none';
        if (artPh)  artPh.style.display  = '';
      }

      if (trackEl)  trackEl.textContent  = data.track  || '';
      if (artistEl) artistEl.textContent = data.artist || '';
      if (albumEl)  albumEl.textContent  = data.album  || '';
      if (deviceEl) {
        deviceEl.textContent = client && client.name
          ? 'On ' + client.name + (client.type ? ' · ' + client.type : '')
          : '';
      }
      if (contextEl) {
        contextEl.textContent = context && context.type
          ? 'From ' + context.type.replace(/_/g, ' ')
          : '';
      }

      if (barFill && data.progressMs != null && data.durationMs) {
        var pct = Math.min(100, (data.progressMs / data.durationMs) * 100);
        barFill.style.width = pct.toFixed(1) + '%';
      }
    });
  }

  // ── WebSocket ─────────────────────────────────────────

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var socket = new WebSocket(proto + '//' + location.host);
    ws = socket;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (websocketErrorTimer) {
      clearTimeout(websocketErrorTimer);
      websocketErrorTimer = null;
    }
    websocketFailureReported = false;

    function clearTransientSocketState() {
      if (websocketErrorTimer) {
        clearTimeout(websocketErrorTimer);
        websocketErrorTimer = null;
      }
      websocketFailureReported = false;
    }

    function reportSocketFailure() {
      websocketErrorTimer = null;
      if (ws !== socket || socket.readyState === WebSocket.OPEN || websocketFailureReported) return;
      websocketFailureReported = true;
      reportClientError('websocket', 'Connection error', 'Realtime link failed');
    }

    socket.addEventListener('open', function () {
      if (ws !== socket) return;
      clearTransientSocketState();
      flushClientErrors();
    });

    socket.addEventListener('message', function (evt) {
      try {
        var data = JSON.parse(evt.data);
        if (data.type === 'layout') renderLayout(data.layout);
        if (data.type === 'update') {
          try { if (data.temperature) updateTemperature(data.temperature); } catch (err) { reportClientError('temperature', err.message || 'Update failed'); }
          try { if (data.cameras) updateCameras(data.cameras); } catch (err) { reportClientError('cameras', err.message || 'Update failed'); }
          try { if (data.stocks) updateStocks(data.stocks); } catch (err) { reportClientError('stocks', err.message || 'Update failed'); }
          try { if (data.headlines) updateHeadlines(data.headlines); } catch (err) { reportClientError('news', err.message || 'Update failed'); }
          try { if (data.iss) updateISS(data.iss); } catch (err) { reportClientError('iss', err.message || 'Update failed'); }
          try { if (data.sports) updateSports(data.sports); } catch (err) { reportClientError('sports', err.message || 'Update failed'); }
          try { if (data.spotify) updateNowPlaying(data.spotify); else if (data.nowplaying) updateNowPlaying(data.nowplaying); } catch (err) { reportClientError('spotify', err.message || 'Update failed'); }
        }
      } catch (err) {
        reportClientError('websocket', 'Bad payload from server', err.message || 'Invalid JSON');
      }
    });

    socket.addEventListener('error', function () {
      if (ws !== socket) return;
      if (websocketErrorTimer) return;
      websocketErrorTimer = setTimeout(reportSocketFailure, 5000);
    });

    socket.addEventListener('close', function () {
      if (ws !== socket) return;
      clearTransientSocketState();
      reconnectTimer = setTimeout(connect, 2000);
    });
  }

  setInterval(updateClock, 1000);
  setInterval(refreshCameraAges, 1000);

  fetch('/api/layout')
    .then(function (r) { return r.json(); })
    .then(function (layout) { renderLayout(layout); })
    .catch(function (err) {
      reportClientError('layout', 'Failed to load layout', err && err.message ? err.message : 'Request error');
    });

  window.addEventListener('error', function (evt) {
    reportClientError('window', evt.message || 'Unhandled error', evt.filename ? evt.filename + ':' + evt.lineno : '');
  });

  window.addEventListener('unhandledrejection', function (evt) {
    var reason = evt.reason;
    var message = reason && reason.message ? reason.message : String(reason || 'Unhandled promise rejection');
    reportClientError('promise', message, 'unhandled rejection');
  });

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
