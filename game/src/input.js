// Keyboard and mouse input. W/S move the throttle lever, Up/Down arrows pitch,
// Left/Right arrows (or A/D) bank and turn, Q/E rudder (a gentle heading
// nudge), F flaps, B brakes, C camera, P pause, R restart, M mute, Enter
// starts. Mouse drag on the canvas looks around; clicks work the buttons.
export class Input {
  constructor(canvas, onFirstGesture) {
    this.keys = new Set();
    this.edgeSet = new Set();
    this.throttle = 0;
    this.gestureDone = false;
    this.onFirstGesture = onFirstGesture;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.lookDelta = { x: 0, y: 0 };
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      this.markGesture();
      this.keys.add(e.code);
      if (!e.repeat) this.edgeSet.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerdown', (e) => {
      this.markGesture();
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.lookDelta.x += e.clientX - this.lastX;
      this.lookDelta.y += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => { this.dragging = false; });
  }

  markGesture() {
    if (!this.gestureDone) {
      this.gestureDone = true;
      if (this.onFirstGesture) this.onFirstGesture();
    }
  }

  pressed(code) {
    return this.keys.has(code);
  }

  /** Consume a key press once (for toggles like pause and camera). */
  consume(code) {
    if (this.keys.has(code)) {
      this.keys.delete(code);
      return true;
    }
    return false;
  }

  /** True once per physical key press (key repeat does not retrigger). */
  edge(code) {
    if (this.edgeSet.has(code)) {
      this.edgeSet.delete(code);
      return true;
    }
    return false;
  }

  /** Build the flight input for this frame from the held keys. */
  readFlight(dt) {
    // W/S work the throttle lever; arrows fly the plane.
    if (this.pressed('KeyW')) this.throttle += 0.55 * dt;
    if (this.pressed('KeyS')) this.throttle -= 0.55 * dt;
    this.throttle = Math.max(0, Math.min(1, this.throttle));
    let roll = 0;
    if (this.pressed('KeyA') || this.pressed('ArrowLeft')) roll -= 1;
    if (this.pressed('KeyD') || this.pressed('ArrowRight')) roll += 1;
    // Rudder: a small heading nudge without banking.
    let rudder = 0;
    if (this.pressed('KeyQ')) rudder -= 1;
    if (this.pressed('KeyE')) rudder += 1;
    // Up arrow pulls the nose up (negative pitch input = climb).
    let pitch = 0;
    if (this.pressed('ArrowUp') || this.pressed('KeyI')) pitch -= 1;
    if (this.pressed('ArrowDown') || this.pressed('KeyK')) pitch += 1;
    return {
      roll,
      pitch,
      rudder,
      throttle: this.throttle,
      flaps: this.pressed('KeyF'),
      brakes: this.pressed('KeyB'),
    };
  }

  takeLookDelta() {
    const d = this.lookDelta;
    this.lookDelta = { x: 0, y: 0 };
    return d;
  }
}
