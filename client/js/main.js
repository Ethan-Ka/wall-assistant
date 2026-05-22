'use strict';

(function () {
  const WS_PORT = 3000;
  let ws;

  function connect() {
    ws = new WebSocket('ws://' + location.hostname + ':' + WS_PORT);

    ws.addEventListener('message', function (evt) {
      try {
        var data = JSON.parse(evt.data);
        if (data.type === 'update') {
          if (data.temperature) updateTemperature(data.temperature);
          if (data.cameras) updateCameras(data.cameras);
        }
      } catch (_) {}
    });

    ws.addEventListener('close', function () {
      setTimeout(connect, 2000);
    });
  }

  function updateTemperature(temp) {
    var valEl = document.getElementById('temp-value');
    var condEl = document.getElementById('temp-condition');
    if (temp.fahrenheit != null) {
      valEl.textContent = Math.round(temp.fahrenheit) + '°F';
    } else {
      valEl.textContent = '--°';
    }
    condEl.textContent = temp.condition || '';
  }

  function updateCameras(cameras) {
    cameras.forEach(function (cam, i) {
      var img = document.getElementById('camera-' + i + '-img');
      var nameEl = document.getElementById('camera-' + i + '-name');
      if (!img) return;
      if (cam.name && nameEl) nameEl.textContent = cam.name;
      if (cam.snapshotUrl) {
        img.src = cam.snapshotUrl;
        img.classList.add('loaded');
      }
    });
  }

  function updateClock() {
    var now = new Date();
    var h = now.getHours().toString().padStart(2, '0');
    var m = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('clock-time').textContent = h + ':' + m;
    document.getElementById('clock-date').textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    });
  }

  updateClock();
  setInterval(updateClock, 1000);
  connect();

  // Wake lock keeps the screen on; requires HTTPS — silently skipped over HTTP
  if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').catch(function () {});
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
}());
