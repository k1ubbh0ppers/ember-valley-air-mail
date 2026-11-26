// Deterministic screenshot staging and the autopilot. The autopilot flies the
// real flight model toward the next ring (or the destination strip on final),
// so a staged frame is what real play looks like — same code path, no
// special-case rendering. ?shot=cover|approach|strip|title picks a scene.
import * as THREE from 'three';

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * One autopilot decision: returns the same input shape the keyboard reader
 * returns, so the flight model cannot tell the difference.
 */
export function autopilotInput(plane, mission) {
  if (plane.onGround) {
    // Takeoff roll: full throttle, pull up once fast enough.
    return {
      roll: 0,
      pitch: plane.speed > 32 ? -1 : 0,
      rudder: 0,
      throttle: 1,
      flaps: false,
      brakes: false,
    };
  }

  const onFinal = mission.rings.allPassed;
  let desiredHeading;
  let desiredAlt;
  let throttle;
  let flaps = false;

  if (onFinal) {
    // Final: get onto the extended centreline first (intercept point 500 m
    // out), then align with the runway and descend the glide slope.
    const strip = mission.toStrip;
    const runwayHeading = (strip.heading * Math.PI) / 180;
    const dirX = Math.sin(runwayHeading); const dirZ = -Math.cos(runwayHeading);
    // Landing direction: the runway direction closest to the current heading.
    const d1 = Math.abs(wrapAngle(runwayHeading - plane.heading));
    const d2 = Math.abs(wrapAngle(runwayHeading + Math.PI - plane.heading));
    const sgn = d1 <= d2 ? 1 : -1;
    const landX = dirX * sgn; const landZ = dirZ * sgn;
    const apX = strip.x - landX * 500;
    const apZ = strip.z - landZ * 500;
    const distAP = Math.hypot(apX - plane.pos.x, apZ - plane.pos.z);
    const distStrip = Math.hypot(strip.x - plane.pos.x, strip.z - plane.pos.z);
    if (distAP > 200 && distStrip > 600) {
      desiredHeading = Math.atan2(apX - plane.pos.x, -(apZ - plane.pos.z));
      desiredAlt = strip.elevation + 55;
      throttle = 0.6;
      flaps = false;
    } else {
      desiredHeading = Math.atan2(landX, -landZ);
      desiredAlt = strip.elevation + Math.max(6, distStrip * 0.085);
      throttle = 0.34;
      flaps = distStrip < 700;
      if (plane.speed < 40) throttle = 0.6;
      if (distStrip < 260 && plane.altitudeAGL < 16) {
        // Flare: arrest the descent, do not climb away.
        throttle = 0.12;
        desiredAlt = plane.pos.y - 2.5;
      }
    }
  } else {
    const target = mission.rings.nextRing.pos;
    const dx = target.x - plane.pos.x;
    const dz = target.z - plane.pos.z;
    desiredHeading = Math.atan2(dx, -dz);
    desiredAlt = target.y;
    throttle = 0.72;
    if (plane.speed < 42) throttle = 0.9;
    else if (plane.speed > 72) throttle = 0.55;
    // Climbing hard to a ring: full power until fast enough to climb well.
    if (desiredAlt - plane.pos.y > 40 && plane.speed < 55) throttle = 1;
  }

  const headingErr = wrapAngle(desiredHeading - plane.heading);
  // A big heading error means we missed a ring and must turn back: slow
  // down and bank harder than the keyboard ever asks for, so the turn is
  // tight enough to stay inside the valley.
  const hardTurn = Math.abs(headingErr) > 1.0;
  const roll = hardTurn
    ? clamp(headingErr * 2.2, -1.4, 1.4)
    : clamp(headingErr * 1.8, -1, 1);
  if (hardTurn) throttle = Math.min(throttle, 0.5);
  const altErr = desiredAlt - plane.pos.y;
  const pitch = clamp(-altErr * 0.03, -1, 1);
  return { roll, pitch, rudder: 0, throttle, flaps, brakes: false };
}

/** Step the world forward with the autopilot for `seconds` of sim time. */
export function flyForward(game, seconds) {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) {
    const input = autopilotInput(game.plane, game.mission);
    game.stepWorld(dt, input);
    if (game.state === 'crashed' || game.state === 'daydone') break;
  }
}

/**
 * Stage one named screenshot scene. `game` is the object main.js builds
 * (plane, mission, rings, sky, camera, hud, renderer, scene, stepWorld,
 * startLeg, setScreen). Runs the real sim forward, then leaves the frame
 * standing for the screenshot.
 */
export function stageShot(game, name) {
  const { plane, mission, rings, sky, chase, hud } = game;
  if (name === 'title') {
    game.startLeg(0);
    plane.reset(-1350, -350, 90);
    plane.throttle = 0;
    sky.setPreset('morning');
    // No rings or beacon in the title frame: the card is the subject.
    rings.nextIndex = rings.totalCount;
    rings.updateBeacon();
    game.syncPlaneMesh();
    // Low camera near the parked plane, aimed below and to the side of it,
    // so the aircraft reads in the clear strip above the title card.
    const strip = mission.fromStrip;
    const e = strip.elevation;
    const heading = (strip.heading * Math.PI) / 180;
    const fx = Math.sin(heading); const fz = -Math.cos(heading);
    const rx = Math.cos(heading); const rz = Math.sin(heading);
    chase.placeForShot(
      new THREE.Vector3(strip.x - fx * 65 - rx * 18, e + 10, strip.z - fz * 65 - rz * 18),
      new THREE.Vector3(strip.x - rx * 20, e - 30, strip.z - rz * 20),
    );
    hud.showOnly('screen-title');
    game.renderFrame();
    return;
  }

  if (name === 'cover') {
    game.startLeg(0);
    sky.setPreset('morning');
    // We join the course at ring 3: mark the first two as flown.
    rings.nextIndex = 2;
    rings.updateBeacon();
    const ring = rings.rings[2];
    const prev = rings.rings[1];
    const dir = new THREE.Vector3().subVectors(ring.pos, prev.pos).normalize();
    plane.reset(ring.pos.x - dir.x * 300, ring.pos.z - dir.z * 300, 0);
    plane.pos.y = ring.pos.y;
    plane.heading = Math.atan2(dir.x, -dir.z);
    plane.speed = 58;
    plane.throttle = 0.72;
    plane.onGround = false;
    game.setScreen('flying');
    flyForward(game, 5.5);
    game.renderFrame();
    return;
  }

  if (name === 'approach') {
    game.startLeg(2);
    sky.setPreset('dusk');
    // Fly the final itself: all rings are already behind us.
    rings.nextIndex = rings.totalCount;
    rings.updateBeacon();
    const strip = mission.toStrip;
    // Approach from the valley side (east), flying west down the runway
    // axis — the far side is rim mountains, no sane approach comes from there.
    plane.reset(strip.x + 820, strip.z, 270);
    plane.pos.y = strip.elevation + 105;
    plane.speed = 46;
    plane.throttle = 0.35;
    plane.onGround = false;
    plane.flaps = true;
    game.setScreen('flying');
    flyForward(game, 9);
    game.renderFrame();
    return;
  }

  // 'strip': parked after a delivery at Pinewatch, toast up, village behind.
  game.startLeg(0);
  sky.setPreset('morning');
  const strip = mission.toStrip;
  const heading = (strip.heading * Math.PI) / 180;
  const fx = Math.sin(heading); const fz = -Math.cos(heading);
  plane.reset(strip.x, strip.z, strip.heading);
  plane.throttle = 0;
  plane.speed = 0;
  rings.nextIndex = rings.totalCount;
  rings.updateBeacon();
  game.setScreen('flying');
  game.syncPlaneMesh();
  game.hud.update({ plane: game.plane, mission: game.mission, wind: game.wind });
  hud.toast('DELIVERED · PINEWATCH  +620 PTS', 9000);
  // Beauty shot: back off to the side so the whole aircraft reads against
  // the runway and the village (placeForShot moves the real camera too —
  // no render loop runs in ?shot= mode).
  const rx = Math.cos(heading); const rz = Math.sin(heading);
  chase.placeForShot(
    new THREE.Vector3(
      strip.x - fx * 30 + rx * -18, strip.elevation + 9, strip.z - fz * 30 + rz * -18,
    ),
    new THREE.Vector3(strip.x + fx * 10, strip.elevation + 2, strip.z + fz * 10),
  );
  game.renderFrame();
}
