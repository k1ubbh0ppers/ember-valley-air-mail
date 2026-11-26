// The chase camera (and a cockpit view on C). The camera chases the plane
// with damped lag and never snaps, so it never fights the pilot.
import * as THREE from 'three';

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.position = new THREE.Vector3(-1350, 120, -320);
    this.lookTarget = new THREE.Vector3(-1350, 80, -350);
    this.lookOffset = { x: 0, y: 0 };
  }

  toggle() {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
    return this.mode;
  }

  /** Nudge the view target with the mouse drag (look around a little). */
  addLook(dx, dy) {
    this.lookOffset.x = Math.max(-0.5, Math.min(0.5, this.lookOffset.x + dx * 0.002));
    this.lookOffset.y = Math.max(-0.3, Math.min(0.3, this.lookOffset.y + dy * 0.002));
  }

  resetLook() {
    this.lookOffset.x = 0;
    this.lookOffset.y = 0;
  }

  update(dt, plane) {
    const fwd = plane.forwardVector();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const k = 1 - Math.exp(-3.2 * dt); // damping: no snapping, no lag fights
    if (this.mode === 'cockpit') {
      const desired = plane.pos.clone()
        .addScaledVector(fwd, 1.1)
        .addScaledVector(up, 1.05);
      this.position.lerp(desired, 1 - Math.exp(-14 * dt));
      const target = plane.pos.clone()
        .addScaledVector(fwd, 60)
        .addScaledVector(up, -1.5 + this.lookOffset.y * 20)
        .addScaledVector(right, this.lookOffset.x * 20);
      this.lookTarget.lerp(target, 1 - Math.exp(-14 * dt));
    } else {
      const desired = plane.pos.clone()
        .addScaledVector(fwd, -12)
        .addScaledVector(up, 4.2)
        .addScaledVector(right, this.lookOffset.x * 6);
      this.position.lerp(desired, k);
      const target = plane.pos.clone()
        .addScaledVector(fwd, 26)
        .addScaledVector(up, 0.5 + this.lookOffset.y * 10);
      this.lookTarget.lerp(target, 1 - Math.exp(-6 * dt));
    }
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookTarget);
    // A touch of speed feel: widen the view slightly at full throttle.
    const targetFov = this.mode === 'cockpit' ? 70 : 62 + plane.throttle * 6;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, 2 * dt);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Place the camera for a staged shot (title screen overlook). */
  placeForShot(position, target) {
    this.position.copy(position);
    this.lookTarget.copy(target);
    this.camera.position.copy(position);
    this.camera.lookAt(target);
  }
}
