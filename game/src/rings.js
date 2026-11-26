// The gold navigation rings that mark each leg's route, plus a light beacon
// column over the next ring so the pilot can always find it.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

/** Ring waypoints for a leg: a gentle curve from one strip to the next. */
export function planRingCourse(from, to, count) {
  const mx = (from.x + to.x) / 2;
  const mz = (from.z + to.z) / 2;
  // Bow the route sideways so it is a curve, not a straight line.
  const dx = to.x - from.x; const dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const bow = len * 0.16;
  const cx = mx + (-dz / len) * bow;
  const cz = mz + (dx / len) * bow;
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i + 1) / (count + 1);
    // Quadratic bezier from -> control -> to.
    const x = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * cx + t * t * to.x;
    const z = (1 - t) * (1 - t) * from.z + 2 * (1 - t) * t * cz + t * t * to.z;
    const ground = heightAt(x, z);
    // Rings stay low enough to reach shortly after takeoff: 75 m over the
    // ground below, or 70 m over the departure strip, whichever is higher.
    const alt = Math.max(ground + 75, from.elevation + 70);
    points.push(new THREE.Vector3(x, alt, z));
  }
  // The final approach must arrive ALONG the destination runway, not across
  // it: the last two rings sit on the extended centreline, on the side the
  // route arrives from, so the plane is lined up before it descends.
  const arrivalX = (to.x - from.x) / len;
  const arrivalZ = (to.z - from.z) / len;
  const h = (to.heading * Math.PI) / 180;
  const dirX = Math.sin(h); const dirZ = -Math.cos(h);
  const dot = dirX * arrivalX + dirZ * arrivalZ;
  const landX = dot >= 0 ? dirX : -dirX;
  const landZ = dot >= 0 ? dirZ : -dirZ;
  const finals = [
    { d: 800, alt: 62 },
    { d: 450, alt: 45 },
  ];
  for (let k = 0; k < finals.length; k += 1) {
    const idx = count - 2 + k;
    if (idx < 0 || idx >= points.length) continue;
    const { d, alt } = finals[k];
    const px = to.x - landX * d;
    const pz = to.z - landZ * d;
    const ground = heightAt(px, pz);
    points[idx] = new THREE.Vector3(px, Math.max(ground + 45, to.elevation + alt), pz);
  }
  return points;
}

export class RingCourse {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'rings';
    scene.add(this.group);
    this.rings = [];
    this.nextIndex = 0;
    this.beacon = null;
  }

  /** Lay out fresh rings for a leg; returns the waypoint list. */
  setCourse(waypoints) {
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
    }
    this.rings = [];
    this.nextIndex = 0;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc23a });
    const doneMat = new THREE.MeshBasicMaterial({ color: 0x7ac74f });
    const geo = new THREE.TorusGeometry(26, 1.7, 10, 40);
    for (const point of waypoints) {
      const ring = new THREE.Mesh(geo, ringMat.clone());
      ring.position.copy(point);
      // Face the ring along the route: look at the next waypoint.
      ring.name = 'nav-ring';
      this.group.add(ring);
      this.rings.push({ mesh: ring, pos: point, passed: false, mat: ringMat, doneMat });
    }
    // Orient each ring toward the following one.
    for (let i = 0; i < this.rings.length; i += 1) {
      const target = this.rings[i + 1] ? this.rings[i + 1].pos : this.rings[i].pos;
      this.rings[i].mesh.lookAt(target.x, target.y, target.z);
    }
    // Beacon column over the next ring.
    if (this.beacon) this.group.remove(this.beacon);
    const beaconGeo = new THREE.CylinderGeometry(2.2, 2.2, 400, 8, 1, true);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffc23a, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false,
    });
    this.beacon = new THREE.Mesh(beaconGeo, beaconMat);
    this.beacon.name = 'ring-beacon';
    this.group.add(this.beacon);
    this.updateBeacon();
    return waypoints;
  }

  updateBeacon() {
    if (!this.beacon) return;
    const next = this.rings[this.nextIndex];
    if (!next) {
      this.beacon.visible = false;
      return;
    }
    this.beacon.visible = true;
    this.beacon.position.set(next.pos.x, next.pos.y + 200, next.pos.z);
  }

  get nextRing() {
    return this.rings[this.nextIndex] || null;
  }

  get passedCount() {
    return this.nextIndex;
  }

  get totalCount() {
    return this.rings.length;
  }

  get allPassed() {
    return this.nextIndex >= this.rings.length;
  }

  /** Check whether the plane just flew through the next ring. */
  checkPass(planePos) {
    const next = this.nextRing;
    if (!next) return false;
    const d = planePos.distanceTo(next.pos);
    if (d < 24) {
      next.passed = true;
      next.mesh.material = next.doneMat;
      this.nextIndex += 1;
      this.updateBeacon();
      return true;
    }
    return false;
  }

  /** Pulse the next ring so it draws the eye. */
  update(dt, time) {
    const next = this.nextRing;
    if (next) {
      const s = 1 + Math.sin(time * 3) * 0.045;
      next.mesh.scale.set(s, s, s);
    }
  }
}
