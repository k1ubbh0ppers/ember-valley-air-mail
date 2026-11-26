// Ember Valley Air Mail: bootstrap, game loop and screen state machine.
// One mail day = three legs (Morning Post, Fragile Parcel, Dusk Medical Run).
// ?shot=cover|approach|strip|title stages a deterministic screenshot scene
// instead of starting the interactive loop.
import * as THREE from 'three';
import { LEGS, STRIPS } from './config.js';
import { buildTerrain, heightAt } from './terrain.js';
import { buildSky } from './sky.js';
import { buildPlaneMesh, FlightModel } from './plane.js';
import { RingCourse } from './rings.js';
import { MissionDay } from './missions.js';
import { Hud } from './hud.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { SoundBank } from './audio.js';
import { stageShot, autopilotInput } from './shots.js';

const stripById = new Map(STRIPS.map((s) => [s.id, s]));

class Game {
  constructor() {
    this.state = 'title';
    this.staging = false;
    this.time = 0;
    this.bestDay = 0;
    this.transitionTimer = 0;
    this.muted = false;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    document.getElementById('app').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 9000);

    buildTerrain(this.scene);
    this.sky = buildSky(this.scene, this.renderer);
    this.sky.setPreset('morning');

    const built = buildPlaneMesh();
    this.planeMesh = built.group;
    this.planeMesh.rotation.order = 'YXZ';
    this.planeProp = built.prop;
    // The blob shadow lives in the scene, not on the plane, so it stays flat.
    this.planeShadow = built.shadow;
    this.planeMesh.remove(this.planeShadow);
    this.scene.add(this.planeShadow);
    this.scene.add(this.planeMesh);

    this.plane = new FlightModel();
    this.rings = new RingCourse(this.scene);
    this.mission = new MissionDay(this.rings, (e) => this.onMissionEvent(e));
    this.chase = new ChaseCamera(this.camera);
    this.audio = new SoundBank();
    this.input = new Input(this.renderer.domElement, () => this.audio.init());
    this.hud = new Hud({
      onStart: () => this.startDay(),
      onFly: () => this.beginFlying(),
      onResume: () => this.resume(),
      onRestart: () => this.startDay(),
      onCamera: () => this.toggleCamera(),
      onMute: () => this.toggleMute(),
    });
    this.hud.setBest(0);
    this.hud.setCameraLabel('chase');
    this.hud.setMuteLabel(false);

    window.addEventListener('resize', () => this.onResize());
    this.placePlaneAtStrip('ember');
    this.hud.showOnly('screen-title');
    window.__ember = { game: this, version: 'ember-valley-air-mail/1' };
  }

  get wind() {
    return this.mission.leg ? this.mission.leg.wind : { x: 0, z: 0 };
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  placePlaneAtStrip(stripId) {
    const strip = stripById.get(stripId);
    this.plane.reset(strip.x, strip.z, strip.heading);
    this.syncPlaneMesh();
    this.chase.position.set(
      strip.x - Math.sin((strip.heading * Math.PI) / 180) * -13.5,
      strip.elevation + 6,
      strip.z + Math.cos((strip.heading * Math.PI) / 180) * 13.5,
    );
  }

  startDay() {
    clearTimeout(this.transitionTimer);
    this.mission.legIndex = 0;
    this.mission.totalScore = 0;
    this.mission.deliveredLegs = [];
    this.mission.finished = false;
    this.startLeg(0);
  }

  startLeg(index) {
    clearTimeout(this.transitionTimer);
    const leg = this.mission.startLeg(index);
    this.placePlaneAtStrip(leg.from);
    this.sky.setPreset(leg.preset);
    this.input.throttle = 0;
    this.state = 'brief';
    this.hud.showBrief(leg, this.mission.fromStrip.name, this.mission.toStrip.name);
  }

  beginFlying() {
    this.state = 'flying';
    this.hud.showOnly(null);
    this.hud.toast(`${this.mission.leg.name.toUpperCase()} — FLY THE GOLD RINGS, THEN LAND AT ${this.mission.toStrip.name.toUpperCase()}`);
    this.audio.init();
  }

  setScreen(screen) {
    if (screen === 'flying') {
      this.state = 'flying';
      this.hud.showOnly(null);
    }
  }

  resume() {
    this.state = 'flying';
    this.hud.showOnly(null);
  }

  toggleCamera() {
    const mode = this.chase.toggle();
    this.hud.setCameraLabel(mode);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.audio.setMuted(this.muted);
    this.hud.setMuteLabel(this.muted);
  }

  onMissionEvent(event) {
    if (event.type === 'ring') {
      this.hud.toast(`RING ${event.passed}/${event.total}`);
      this.audio.chime();
    } else if (event.type === 'rings-remaining') {
      this.hud.toast(`${event.left} RING${event.left === 1 ? '' : 'S'} STILL TO FLY — TAKE OFF AGAIN`);
    } else if (event.type === 'landed-wrong-strip') {
      this.hud.toast(`WRONG STRIP — THE MAIL GOES ELSEWHERE`);
    } else if (event.type === 'parcel-broken') {
      this.hud.toast(`THE PARCEL BROKE — ${event.g.toFixed(1)}G WAS TOO MUCH`);
      this.audio.beep();
    } else if (event.type === 'leg-complete') {
      this.hud.toast(`DELIVERED · ${event.summary.name.toUpperCase()}  +${event.summary.score} PTS`);
    }
  }

  /** One fixed physics step plus visuals. Returns a mission outcome or null. */
  stepWorld(dt, input) {
    const events = [];
    this.plane.step(dt, input, this.wind, events);
    let outcome = null;
    for (const event of events) {
      if (event.type === 'takeoff') {
        this.hud.toast('AIRBORNE');
      } else if (event.type === 'touchdown') {
        this.audio.thud();
      } else if (event.type === 'hard-landing') {
        this.audio.thud();
        this.hud.toast('HARD LANDING — THE GEAR COMPLAINED');
      }
      const result = this.mission.handlePlaneEvent(event, this.plane);
      if (result && result.outcome === 'delivered') {
        outcome = result;
        if (!this.staging) this.onDelivered(result.summary, result.hard);
      } else if (result && result.outcome === 'crashed') {
        outcome = result;
        if (!this.staging) this.onCrashed(result.reason, result.vspeed);
      }
    }
    if (this.state === 'flying' || this.staging) {
      this.mission.update(this.plane);
      const timeout = this.mission.tick(dt, this.plane);
      if (timeout === 'timeout' && !this.staging) {
        outcome = { outcome: 'crashed', reason: 'timeout', vspeed: this.plane.vspeed };
        this.onCrashed('timeout', this.plane.vspeed);
      }
    }
    this.syncPlaneMesh();
    this.rings.update(dt, this.time);
    this.sky.update(dt, this.time);
    this.chase.update(dt, this.plane);
    if (this.state === 'flying' || this.staging) {
      this.hud.update({ plane: this.plane, mission: this.mission, wind: this.wind });
    }
    this.audio.update(this.plane.throttle, this.plane.airspeedKts, this.plane.onGround);
    if (this.plane.stalled && this.state === 'flying') {
      if (Math.floor(this.time * 4) !== Math.floor((this.time - dt) * 4)) this.audio.beep();
    }
    return outcome;
  }

  syncPlaneMesh() {
    const p = this.plane;
    this.planeMesh.position.copy(p.pos);
    this.planeMesh.rotation.set(p.pitch, p.heading, -p.roll);
    this.planeProp.rotation.z = p.propAngle;
    const groundH = heightAt(p.pos.x, p.pos.z);
    this.planeShadow.position.set(p.pos.x, groundH + 0.4, p.pos.z);
    const fade = Math.max(0, 1 - p.altitudeAGL / 260);
    this.planeShadow.material.opacity = 0.22 * fade;
    const s = 1 + p.altitudeAGL / 220;
    this.planeShadow.scale.set(s, s, s);
  }

  onDelivered(summary, hard) {
    this.state = 'delivered';
    this.audio.jingle();
    this.hud.centreMessage(hard ? 'DELIVERED — ROUGH, BUT DELIVERED' : 'DELIVERED');
    if (this.mission.finished) {
      this.transitionTimer = setTimeout(() => {
        if (this.state !== 'delivered') return;
        this.state = 'daydone';
        if (this.mission.totalScore > this.bestDay) this.bestDay = this.mission.totalScore;
        this.hud.setBest(this.bestDay);
        this.hud.showDay(this.mission.totalScore, this.mission.deliveredLegs);
      }, 2000);
    } else {
      this.transitionTimer = setTimeout(() => {
        if (this.state !== 'delivered') return;
        this.startLeg(this.mission.legIndex + 1);
      }, 2200);
    }
  }

  onCrashed(reason, vspeed) {
    if (this.state === 'crashed') return;
    this.state = 'crashed';
    this.audio.crashSound();
    this.hud.showCrash(reason, vspeed);
  }

  /** Run one leg headlessly with the autopilot; used to prove the game is winnable. */
  debugFlyLeg(legIndex) {
    this.staging = true;
    this.mission.legIndex = 0;
    this.mission.totalScore = 0;
    this.mission.deliveredLegs = [];
    this.mission.finished = false;
    this.mission.startLeg(legIndex);
    const leg = this.mission.leg;
    this.placePlaneAtStrip(leg.from);
    this.state = 'flying';
    const dt = 1 / 60;
    let outcome = null;
    let steps = 0;
    const trace = [];
    const maxSteps = Math.round(720 / dt);
    while (steps < maxSteps) {
      const input = autopilotInput(this.plane, this.mission);
      outcome = this.stepWorld(dt, input) || outcome;
      steps += 1;
      if (steps % 300 === 0) {
        trace.push({
          t: Math.round(steps * dt),
          x: Math.round(this.plane.pos.x),
          y: Math.round(this.plane.pos.y),
          z: Math.round(this.plane.pos.z),
          speed: Math.round(this.plane.speed),
          agl: Math.round(this.plane.altitudeAGL),
          heading: Math.round(this.plane.headingDeg),
          ring: this.mission.rings.nextRing
            ? `${this.mission.rings.passedCount}/${this.mission.rings.totalCount}`
            : 'final',
          throttle: Math.round(this.plane.throttle * 100) / 100,
        });
      }
      if (outcome && (outcome.outcome === 'delivered' || outcome.outcome === 'crashed')) break;
      if (this.mission.legTimeLeft <= 0) {
        outcome = { outcome: 'crashed', reason: 'timeout', vspeed: this.plane.vspeed };
        break;
      }
    }
    this.staging = false;
    return {
      leg: leg.id,
      outcome: outcome ? outcome.outcome : 'unfinished',
      reason: outcome ? outcome.reason : null,
      timeSeconds: Math.round(steps * dt),
      rings: `${this.mission.rings.passedCount}/${this.mission.rings.totalCount}`,
      score: this.mission.totalScore,
      fuelLeft: Math.round(this.plane.fuel * 100) / 100,
      distanceFlownKm: Math.round(this.plane.distanceFlown / 100) / 10,
      trace,
    };
  }

  renderFrame() {
    this.renderer.render(this.scene, this.camera);
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, Math.max(0.001, (now - (this.lastNow || now)) / 1000));
    this.lastNow = now;
    this.time += dt;

    // Edge-triggered toggles.
    if (this.input.edge('KeyP') && this.state === 'flying') {
      this.state = 'paused';
      this.hud.showOnly('screen-pause');
    } else if (this.input.edge('KeyP') && this.state === 'paused') {
      this.resume();
    }
    if (this.input.edge('KeyC') && this.state === 'flying') this.toggleCamera();
    if (this.input.edge('KeyM')) this.toggleMute();
    if (this.input.edge('KeyR') && (this.state === 'crashed' || this.state === 'flying' || this.state === 'daydone')) {
      this.startDay();
    }
    if (this.input.edge('Enter')) {
      if (this.state === 'title') this.startDay();
      else if (this.state === 'brief') this.beginFlying();
      else if (this.state === 'crashed' || this.state === 'daydone') this.startDay();
    }

    if (this.state === 'flying') {
      const input = this.input.readFlight(dt);
      const look = this.input.takeLookDelta();
      this.chase.addLook(look.x, look.y);
      // Fixed substeps keep the flight model stable at any frame rate.
      let remaining = dt;
      while (remaining > 0.0001) {
        const step = Math.min(remaining, 1 / 60);
        this.stepWorld(step, input);
        remaining -= step;
        if (this.state !== 'flying') break;
      }
      if (this.state === 'flying') this.chase.resetLook();
    } else {
      // Parked screens still get a living valley behind them.
      this.rings.update(dt, this.time);
      this.sky.update(dt, this.time);
      this.chase.update(dt, this.plane);
    }
    this.renderFrame();
  }
}

function main() {
  const game = new Game();
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (shot) {
    game.staging = true;
    stageShot(game, shot);
    game.staging = false;
    // A few frames so clouds, light and the HUD settle before the capture.
    for (let i = 0; i < 3; i += 1) game.renderFrame();
    window.__shotReady = true;
    return;
  }
  game.lastNow = performance.now();
  requestAnimationFrame((t) => game.loop(t));
}

main();
