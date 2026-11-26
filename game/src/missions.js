// The mail day: three legs, each with its own rings, time limit and weather.
// Tracks delivery, scoring and the fragile parcel; the plane's own events
// (touchdown, hard landing, crash) arrive through handlePlaneEvent.
import { LEGS, SCORING, STRIPS, PLANE } from './config.js';
import { planRingCourse } from './rings.js';

const stripById = new Map(STRIPS.map((s) => [s.id, s]));

export class MissionDay {
  constructor(ringCourse, onEvent) {
    this.rings = ringCourse;
    this.onEvent = onEvent; // (event) => void, events: leg-start, ring, delivered, leg-complete, day-complete, parcel-broken
    this.legIndex = 0;
    this.legTimeLeft = 0;
    this.legElapsed = 0;
    this.legScore = 0;
    this.totalScore = 0;
    this.parcelBroken = false;
    this.deliveredLegs = [];
    this.finished = false;
  }

  get leg() {
    return LEGS[this.legIndex];
  }

  get fromStrip() {
    return stripById.get(this.leg.from);
  }

  get toStrip() {
    return stripById.get(this.leg.to);
  }

  /** Set up a leg: rings, timer, preset. Returns the leg definition. */
  startLeg(index) {
    this.legIndex = index;
    const leg = this.leg;
    const waypoints = planRingCourse(this.fromStrip, this.toStrip, leg.rings);
    this.rings.setCourse(waypoints);
    this.legTimeLeft = leg.timeLimit;
    this.legElapsed = 0;
    this.legScore = 0;
    this.parcelBroken = false;
    this.onEvent({ type: 'leg-start', leg });
    return leg;
  }

  /** Advance the timer; returns 'timeout' when the leg's time runs out. */
  tick(dt, plane) {
    if (this.finished) return null;
    this.legTimeLeft -= dt;
    this.legElapsed += dt;
    if (this.leg.fragile && !this.parcelBroken && plane.gForce > PLANE.fragileG) {
      this.parcelBroken = true;
      this.onEvent({ type: 'parcel-broken', g: plane.gForce });
    }
    if (this.legTimeLeft <= 0) {
      this.legTimeLeft = 0;
      return 'timeout';
    }
    return null;
  }

  /** Called every frame while flying: ring passes and HUD data. */
  update(plane) {
    if (this.finished) return;
    if (this.rings.checkPass(plane.pos)) {
      this.legScore += SCORING.ringBonus;
      this.onEvent({ type: 'ring', passed: this.rings.passedCount, total: this.rings.totalCount });
    }
  }

  /** Score the landing and close the leg; returns the leg summary. */
  completeLeg(plane, landingVspeed) {
    const leg = this.leg;
    let score = SCORING.deliveryBase + this.legScore;
    score += Math.round(SCORING.timeBonusMax * Math.max(0, this.legTimeLeft / leg.timeLimit));
    const softness = Math.max(0, Math.min(1, 1 - Math.abs(landingVspeed) / 6));
    score += Math.round(SCORING.softLandingMax * softness);
    score += Math.round(SCORING.fuelBonusMax * plane.fuel);
    if (leg.fragile && !this.parcelBroken) score += SCORING.fragileBonus;
    if (!this.rings.allPassed) score -= 100 * (this.rings.totalCount - this.rings.passedCount);
    score = Math.max(50, score);
    this.totalScore += score;
    const summary = {
      leg: leg.id,
      name: leg.name,
      score,
      time: this.legElapsed,
      rings: `${this.rings.passedCount}/${this.rings.totalCount}`,
      landingVspeed,
      fuelLeft: plane.fuel,
      parcelIntact: !(leg.fragile && this.parcelBroken),
    };
    this.deliveredLegs.push(summary);
    this.onEvent({ type: 'leg-complete', summary });
    if (this.legIndex >= LEGS.length - 1) {
      this.finished = true;
      this.onEvent({ type: 'day-complete', total: this.totalScore, legs: this.deliveredLegs });
    }
    return summary;
  }

  /** React to the plane's own events; returns 'delivered' | 'crashed' | null. */
  handlePlaneEvent(event, plane) {
    if (this.finished) return null;
    if (event.type === 'touchdown' || event.type === 'hard-landing') {
      if (event.strip === this.leg.to) {
        if (this.rings.allPassed) {
          const summary = this.completeLeg(plane, event.vspeed);
          return { outcome: 'delivered', summary, hard: event.type === 'hard-landing' };
        }
        this.onEvent({ type: 'rings-remaining', left: this.rings.totalCount - this.rings.passedCount });
        return { outcome: 'landed-early', strip: event.strip };
      }
      this.onEvent({ type: 'landed-wrong-strip', strip: event.strip });
      return { outcome: 'landed-wrong-strip', strip: event.strip };
    }
    if (event.type === 'crash') return { outcome: 'crashed', reason: event.reason, vspeed: event.vspeed };
    return null;
  }
}
