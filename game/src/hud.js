// The HUD: airspeed, altitude, compass tape, vertical speed, throttle and
// fuel bars, G-meter, mission panel, toasts, and the title/pause/crash/
// day-complete screens. All DOM so the numbers stay crisp in screenshots.
export class Hud {
  constructor(callbacks) {
    this.cb = callbacks; // {onStart, onFly, onResume, onRestart, onCamera, onMute}
    this.el = {};
    for (const id of [
      'hud', 'airspeed', 'altitude', 'vspeed', 'throttle-fill', 'throttle-pct',
      'fuel-fill', 'fuel-pct', 'g-meter', 'wind', 'mission-name', 'mission-dest',
      'mission-dist', 'mission-time', 'toasts', 'screen-title', 'screen-brief',
      'brief-title', 'brief-text', 'screen-pause', 'screen-crash', 'crash-reason',
      'screen-day', 'day-rows', 'day-total', 'best-score', 'camera-btn', 'mute-btn',
      'stall-warn', 'fuel-warn', 'centre-msg',
    ]) {
      this.el[id] = document.getElementById(id);
    }
    this.horizon = document.getElementById('horizon').getContext('2d');
    this.compass = document.getElementById('compass').getContext('2d');
    this.last = {};
    this.wireButtons();
  }

  wireButtons() {
    const bind = (id, fn) => {
      const node = document.getElementById(id);
      if (node) node.addEventListener('click', fn);
    };
    bind('start-btn', () => this.cb.onStart());
    bind('fly-btn', () => this.cb.onFly());
    bind('resume-btn', () => this.cb.onResume());
    bind('restart-btn', () => this.cb.onRestart());
    bind('crash-restart-btn', () => this.cb.onRestart());
    bind('day-restart-btn', () => this.cb.onRestart());
    bind('camera-btn', () => this.cb.onCamera());
    bind('mute-btn', () => this.cb.onMute());
  }

  setText(key, value) {
    if (this.last[key] !== value) {
      this.last[key] = value;
      const node = this.el[key];
      if (node) node.textContent = value;
    }
  }

  setBar(key, fraction, pctKey, pctText) {
    const node = this.el[key];
    if (node) node.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    if (pctKey) this.setText(pctKey, pctText);
  }

  /** Draw the artificial horizon: sky/ground split by pitch and roll. */
  drawHorizon(roll, pitch) {
    const ctx = this.horizon;
    const w = 150; const h = 150;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 70, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-roll);
    const offset = Math.max(-60, Math.min(60, pitch * 120));
    ctx.fillStyle = '#7fb2e0';
    ctx.fillRect(-80, -80 + offset, 160, 80);
    ctx.fillStyle = '#7a5a38';
    ctx.fillRect(-80, offset, 160, 80);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-80, offset);
    ctx.lineTo(80, offset);
    ctx.stroke();
    ctx.restore();
    // Fixed aircraft symbol.
    ctx.strokeStyle = '#ffd23a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 26, h / 2); ctx.lineTo(w / 2 - 8, h / 2);
    ctx.moveTo(w / 2 + 8, h / 2); ctx.lineTo(w / 2 + 26, h / 2);
    ctx.moveTo(w / 2, h / 2 - 4); ctx.lineTo(w / 2, h / 2 + 4);
    ctx.stroke();
  }

  /** Draw the heading compass tape, centred on the current heading. */
  drawCompass(headingDeg) {
    const ctx = this.compass;
    const w = 300; const h = 34;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 16, 26, 0.72)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -60; d <= 60; d += 5) {
      const raw = Math.round(headingDeg + d);
      const deg = ((raw % 360) + 360) % 360;
      const x = w / 2 + d * 2.4;
      if (deg % 45 === 0) {
        ctx.fillStyle = '#ffd23a';
        ctx.fillText(labels[deg] || String(deg), x, 12);
        ctx.fillRect(x - 1, 24, 2, 8);
      } else if (deg % 15 === 0) {
        ctx.fillStyle = '#cfe0ee';
        ctx.fillText(String(deg).padStart(3, '0'), x, 12);
        ctx.fillRect(x - 1, 24, 2, 6);
      } else {
        ctx.fillStyle = '#7a8a9a';
        ctx.fillRect(x - 0.5, 26, 1, 5);
      }
    }
    // Centre caret.
    ctx.fillStyle = '#ffd23a';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 6, 0); ctx.lineTo(w / 2 + 6, 0); ctx.lineTo(w / 2, 8);
    ctx.closePath();
    ctx.fill();
  }

  /** Refresh every live instrument from the current flight state. */
  update(state) {
    const { plane, mission, wind } = state;
    this.setText('airspeed', `${Math.round(plane.airspeedKts)}`);
    this.setText('altitude', `${Math.round(plane.altitudeAGL)}`);
    this.setText('vspeed', `${plane.vspeed >= 0 ? '+' : ''}${Math.round(plane.vspeed * 1.97 * 10) / 10}`);
    this.setBar('throttle-fill', plane.throttle, 'throttle-pct', `${Math.round(plane.throttle * 100)}%`);
    this.setBar('fuel-fill', plane.fuel, 'fuel-pct', `${Math.round(plane.fuel * 100)}%`);
    this.setText('g-meter', plane.gForce.toFixed(1));
    this.el['g-meter'].style.color = plane.gForce > 2.2 ? '#ff6a4a' : '#e8f0f8';
    const windDir = Math.round(((Math.atan2(wind.x, -wind.z) * 180) / Math.PI + 360) % 360);
    const windSpeed = Math.round(Math.hypot(wind.x, wind.z) * 1.94);
    this.setText('wind', `WIND ${windDir}° ${windSpeed}KT`);
    this.drawHorizon(plane.roll, plane.pitch);
    this.drawCompass(plane.headingDeg);
    this.el['stall-warn'].style.visibility = plane.stalled ? 'visible' : 'hidden';
    this.el['fuel-warn'].style.visibility = plane.fuel > 0 && plane.fuel < 0.15 ? 'visible' : 'hidden';
    if (mission) {
      const leg = mission.leg;
      this.setText('mission-name', `${mission.legIndex + 1}/3 · ${leg.name.toUpperCase()}`);
      const next = mission.rings.nextRing;
      const dest = mission.rings.allPassed
        ? `LAND AT ${mission.toStrip.name.toUpperCase()}`
        : `RING ${mission.rings.passedCount + 1}/${mission.rings.totalCount}`;
      this.setText('mission-dest', dest);
      let dist = 0;
      if (next) dist = Math.round(plane.pos.distanceTo(next.pos) / 100) / 10;
      else {
        const dx = plane.pos.x - mission.toStrip.x;
        const dz = plane.pos.z - mission.toStrip.z;
        dist = Math.round(Math.hypot(dx, dz) / 100) / 10;
      }
      this.setText('mission-dist', `${dist} KM`);
      const t = Math.max(0, Math.ceil(mission.legTimeLeft));
      this.setText('mission-time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
      this.el['mission-time'].style.color = t < 60 ? '#ff6a4a' : '#e8f0f8';
    }
  }

  toast(text, ms = 3600) {
    const node = document.createElement('div');
    node.className = 'toast';
    node.textContent = text;
    this.el.toasts.appendChild(node);
    while (this.el.toasts.children.length > 3) this.el.toasts.removeChild(this.el.toasts.firstChild);
    setTimeout(() => {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, ms);
  }

  centreMessage(text, ms = 2600) {
    this.el['centre-msg'].textContent = text;
    this.el['centre-msg'].style.opacity = '1';
    clearTimeout(this.centreTimer);
    this.centreTimer = setTimeout(() => { this.el['centre-msg'].style.opacity = '0'; }, ms);
  }

  showOnly(screenId) {
    for (const id of ['screen-title', 'screen-brief', 'screen-pause', 'screen-crash', 'screen-day']) {
      this.el[id].classList.toggle('hidden', id !== screenId);
    }
    const inGame = screenId === null;
    this.el.hud.classList.toggle('hidden', !inGame);
    if (screenId) this.el[screenId].classList.remove('hidden');
  }

  showBrief(leg, fromName, toName) {
    this.el['brief-title'].textContent = `LEG ${leg.id === 'morning-post' ? 1 : leg.id === 'fragile-parcel' ? 2 : 3} — ${leg.name}`;
    this.el['brief-text'].textContent = `${leg.brief} Route: ${fromName} → ${toName}. Time limit ${Math.floor(leg.timeLimit / 60)}:${String(leg.timeLimit % 60).padStart(2, '0')}.`;
    this.showOnly('screen-brief');
  }

  showCrash(reason, vspeed) {
    const reasons = {
      terrain: 'You struck the mountainside.',
      water: 'You ditched in the river.',
      airframe: 'The airframe gave up under the strain.',
      timeout: 'Out of time — the mail is late.',
    };
    this.el['crash-reason'].textContent = `${reasons[reason] || 'You crashed.'} Vertical speed ${Math.round(vspeed)} m/s. The mail is soaked — try the leg again.`;
    this.showOnly('screen-crash');
  }

  showDay(total, legs) {
    this.el['day-rows'].innerHTML = legs.map((leg) => (
      `<div class="day-row"><span>${leg.name}</span><span>${leg.score} PTS</span></div>`
    )).join('');
    this.el['day-total'].textContent = `${total} PTS`;
    this.showOnly('screen-day');
  }

  setBest(score) {
    this.setText('best-score', `BEST DAY ${score} PTS`);
  }

  setCameraLabel(mode) {
    this.el['camera-btn'].textContent = mode === 'chase' ? 'CAM: CHASE' : 'CAM: COCKPIT';
  }

  setMuteLabel(muted) {
    this.el['mute-btn'].textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
  }
}
