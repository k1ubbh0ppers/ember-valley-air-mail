// The mail plane: a little high-wing single-propeller aircraft built from
// primitives, plus its arcade flight model (throttle, bank, pitch, stall,
// fuel, damage, takeoffs and landings).
import * as THREE from 'three';
import { PLANE, WORLD } from './config.js';
import { heightAt, stripAt } from './terrain.js';

/** Paint the "EMBER AIR MAIL / EM-257" titles onto a canvas texture. */
function makeTitleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = '#b03a2a';
  ctx.font = 'bold 52px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EMBER AIR MAIL', 256, 48);
  ctx.fillStyle = '#3a3a3a';
  ctx.font = 'bold 34px Georgia, serif';
  ctx.fillText('EM-257', 256, 100);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

/** Build the visible aircraft and return its group plus animated parts. */
export function buildPlaneMesh() {
  const group = new THREE.Group();
  group.name = 'mail-plane';
  const cream = new THREE.MeshLambertMaterial({ color: 0xf0e6cc });
  const red = new THREE.MeshLambertMaterial({ color: 0xb03a2a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2e2a26 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x2a4a5a, shininess: 90 });

  // Fuselage: cylinder along Z, nose cone, tail cone.
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.55, 5.6, 12), cream);
  fuselage.rotation.x = Math.PI / 2;
  group.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.1, 12), red);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -3.3;
  group.add(nose);
  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 12), cream);
  tailCone.rotation.x = -Math.PI / 2;
  tailCone.position.z = 3.5;
  group.add(tailCone);

  // Cabin windows and the red cheatline.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 1.9), glass);
  cabin.position.set(0, 0.45, -0.6);
  group.add(cabin);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.28, 5.4), red);
  stripe.position.set(0, -0.1, 0);
  group.add(stripe);

  // Titles on both flanks.
  const titleTex = makeTitleTexture();
  const titleMat = new THREE.MeshBasicMaterial({ map: titleTex, transparent: true });
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), titleMat);
    plate.position.set(side * 0.88, 0.15, 0.4);
    plate.rotation.y = side * Math.PI / 2;
    group.add(plate);
  }

  // High wing with a touch of dihedral, tailplane and fin.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.22, 1.9), cream);
  wing.position.set(0, 0.95, -0.3);
  wing.rotation.z = 0;
  group.add(wing);
  const wingTipL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 1.9), red);
  wingTipL.position.set(-5.6, 0.95, -0.3);
  group.add(wingTipL);
  const wingTipR = wingTipL.clone();
  wingTipR.position.x = 5.6;
  group.add(wingTipR);
  const tailplane = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 1.1), cream);
  tailplane.position.set(0, 0.35, 3.9);
  group.add(tailplane);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 1.3), red);
  fin.position.set(0, 0.9, 3.9);
  group.add(fin);

  // Propeller: spinner + two blades, spun by the flight model.
  const prop = new THREE.Group();
  prop.position.set(0, 0, -3.95);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 10), red);
  spinner.rotation.x = -Math.PI / 2;
  prop.add(spinner);
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0x1e1a16 });
  for (const angle of [0, Math.PI]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.6, 0.08), bladeMat);
    blade.rotation.z = angle;
    prop.add(blade);
  }
  group.add(prop);

  // Fixed gear: two legs, wheels and a tail wheel.
  const legMat = new THREE.MeshLambertMaterial({ color: 0x44403a });
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 6), legMat);
    leg.position.set(side * 0.8, -1.15, -0.6);
    leg.rotation.z = side * 0.25;
    group.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 1.05, -1.75, -0.6);
    group.add(wheel);
  }

  // Navigation lights: red left, green right, white tail.
  const navLights = [];
  const navDefs = [
    [0xff2a2a, -5.75, 0.95, -0.3], [0x2aff5a, 5.75, 0.95, -0.3], [0xffffff, 0, 0.5, 4.4],
  ];
  for (const [color, x, y, z] of navDefs) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshBasicMaterial({ color }),
    );
    lamp.position.set(x, y, z);
    group.add(lamp);
    navLights.push(lamp);
  }

  // Soft blob shadow that follows the plane over the ground.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.name = 'plane-shadow';
  group.add(shadow);

  return { group, prop, navLights, shadow };
}

/**
 * Arcade flight model. Position is metres, heading 0 = north (-Z), pitch up
 * positive, roll positive = bank right. `input` carries roll/pitch (-1..1),
 * throttle (0..1), flaps and brakes. `events` is called with plain objects:
 * {type:'touchdown'|'hard-landing'|'crash', ...}.
 */
export class FlightModel {
  constructor() {
    this.reset(-1350, -350, 90);
  }

  reset(x, z, headingDeg) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.pos.y = heightAt(x, z) + PLANE.gearHeight;
    this.heading = (headingDeg * Math.PI) / 180;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.vspeed = 0;
    this.throttle = 0;
    this.fuel = PLANE.tankCapacity;
    this.damage = 0;
    this.onGround = true;
    this.flaps = false;
    this.gForce = 1;
    this.stalled = false;
    this.propAngle = 0;
    this.distanceFlown = 0;
  }

  get stallSpeed() {
    return this.flaps ? PLANE.stallSpeed - 4 : PLANE.stallSpeed;
  }

  get altitudeAGL() {
    return Math.max(0, this.pos.y - heightAt(this.pos.x, this.pos.z));
  }

  get airspeedKts() {
    return this.speed * 1.944;
  }

  get headingDeg() {
    return ((this.heading * 180) / Math.PI % 360 + 360) % 360;
  }

  forwardVector() {
    return new THREE.Vector3(
      Math.sin(this.heading) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.heading) * Math.cos(this.pitch),
    );
  }

  step(dt, input, wind, events) {
    const wasGround = this.onGround;
    // Throttle follows the lever directly (keyboard adjusts it, autopilot sets it).
    this.throttle = Math.max(0, Math.min(1, input.throttle));
    if (this.fuel <= 0) this.throttle = 0;
    this.flaps = !!input.flaps;

    const stall = this.stallSpeed;
    const liftFactor = Math.min(1.15, (this.speed * this.speed) / (stall * stall));
    this.stalled = !this.onGround && this.speed < stall * 0.98;

    if (this.onGround) {
      // Rolling: throttle accelerates, brakes and drag slow us down.
      const accel = this.throttle * 15 - this.speed * 0.12 - (input.brakes ? 9 : 0);
      this.speed = Math.max(0, this.speed + accel * dt);
      // Gentle steering on the ground.
      this.heading += input.roll * 0.25 * dt * Math.min(1, this.speed / 10);
      this.pitch = 0;
      this.roll = 0;
      this.vspeed = 0;
      const fwd = this.forwardVector();
      this.pos.addScaledVector(fwd, this.speed * dt);
      this.pos.y = heightAt(this.pos.x, this.pos.z) + PLANE.gearHeight;
      if (this.speed > PLANE.takeoffSpeed && input.pitch < -0.25) {
        this.onGround = false;
        this.pitch = 0.08;
        events.push({ type: 'takeoff' });
      }
    } else {
      // In the air: bank turns us, pitch climbs or descends, speed chases the throttle.
      const effectiveness = this.stalled ? 0.35 : 1;
      const bankTarget = input.roll * 0.62 * effectiveness;
      this.roll += (bankTarget - this.roll) * Math.min(1, 2.2 * dt);
      const turnRate = (9.81 * Math.tan(this.roll)) / Math.max(18, this.speed);
      this.heading += turnRate * dt;
      // Rudder: a gentle heading nudge without banking.
      this.heading += (input.rudder || 0) * 0.14 * dt * Math.min(1, this.speed / 25);
      const pitchTarget = this.stalled ? -0.22 : input.pitch * -0.32 * effectiveness;
      this.pitch += (pitchTarget - this.pitch) * Math.min(1, 1.6 * dt);
      let targetSpeed = this.throttle * PLANE.maxSpeed;
      targetSpeed += Math.max(0, -Math.sin(this.pitch)) * 26; // diving picks up speed
      targetSpeed -= Math.max(0, Math.sin(this.pitch)) * 22; // climbing bleeds it
      this.speed += (targetSpeed - this.speed) * Math.min(1, 0.32 * dt);
      const sink = (1 - liftFactor) * 10;
      this.vspeed = this.speed * Math.sin(this.pitch) * Math.max(0.35, liftFactor) - sink;
      const fwd = this.forwardVector();
      const horizontal = this.speed * Math.cos(this.pitch);
      this.pos.x += Math.sin(this.heading) * horizontal * dt;
      this.pos.z += -Math.cos(this.heading) * horizontal * dt;
      this.pos.y += this.vspeed * dt;
      this.distanceFlown += this.speed * dt;
      // Wind drift.
      this.pos.x += wind.x * dt;
      this.pos.z += wind.z * dt;
      // G load: banked turns and hard pitch pull Gs.
      this.gForce = 1 + Math.abs(Math.tan(this.roll)) * 0.85 + Math.abs(this.vspeed) * 0.008;
    }

    // Fuel burn follows the throttle.
    if (this.throttle > 0) {
      this.fuel = Math.max(0, this.fuel - ((0.2 + this.throttle * 0.95) * dt) / PLANE.fuelSecondsAtFull);
    }
    // Overspeed strains the airframe.
    if (!this.onGround && this.speed > 108) {
      this.damage = Math.min(1, this.damage + 0.02 * dt);
    }

    // Ground and water contact.
    const groundH = heightAt(this.pos.x, this.pos.z);
    if (!this.onGround && this.pos.y <= groundH + PLANE.gearHeight) {
      const strip = stripAt(this.pos.x, this.pos.z);
      const gentle = this.vspeed > PLANE.crashVspeed && Math.abs(this.roll) < 0.35;
      if (strip && gentle && this.speed > 10) {
        this.onGround = true;
        this.pos.y = groundH + PLANE.gearHeight;
        this.pitch = 0;
        this.roll = 0;
        if (this.vspeed < PLANE.hardLandingVspeed) {
          this.damage = Math.min(1, this.damage + 0.3);
          events.push({ type: 'hard-landing', vspeed: this.vspeed, strip: strip.id });
        } else {
          events.push({ type: 'touchdown', vspeed: this.vspeed, strip: strip.id });
        }
        this.vspeed = 0;
      } else if (this.pos.y <= groundH + 0.4) {
        events.push({ type: 'crash', reason: 'terrain', vspeed: this.vspeed });
      } else if (this.vspeed < -2) {
        // Descending into rough ground that is no strip: a crash, not a graze.
        events.push({ type: 'crash', reason: 'terrain', vspeed: this.vspeed });
      } else {
        // Skimming the ground without a strip under us: force the issue.
        this.pos.y = groundH + PLANE.gearHeight;
      }
    }
    // Ditching in the river or the lake.
    if (!this.onGround && this.pos.y < WORLD.waterLevel && groundH < WORLD.waterLevel - 2) {
      events.push({ type: 'crash', reason: 'water', vspeed: this.vspeed });
    }
    if (this.damage >= 1) {
      events.push({ type: 'crash', reason: 'airframe', vspeed: this.vspeed });
    }
    // Prop spins with the throttle; shadow hugs the ground below.
    this.propAngle += (2 + this.throttle * 55) * dt;
    return wasGround;
  }
}
