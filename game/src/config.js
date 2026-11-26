// Tuning constants and the three legs of the mail day for Ember Valley Air Mail.
// Units are metres, seconds and metres per second unless a name says otherwise.

export const WORLD = {
  size: 4000,
  half: 2000,
  waterLevel: 54,
  seed: 20261126,
};

// Airstrips: position (x, z), runway heading in degrees (0 = north, 90 = east),
// elevation is sampled from the terrain when the world is built.
export const STRIPS = [
  { id: 'ember', name: 'Ember Field', x: -1350, z: -350, heading: 90, home: true },
  { id: 'pinewatch', name: 'Pinewatch', x: 950, z: -1050, heading: 140 },
  { id: 'lakeshore', name: 'Lakeshore', x: 1500, z: 650, heading: 200 },
];

// Villages sit a short walk from their strip.
export const VILLAGES = [
  { strip: 'ember', dx: -180, dz: 260, houses: 12 },
  { strip: 'pinewatch', dx: 200, dz: 220, houses: 9 },
  { strip: 'lakeshore', dx: 320, dz: -80, houses: 10 },
];

// The river winds down the valley into the lake; the valley floor follows it.
export const RIVER_PATH = [
  [-1900, -1900], [-1200, -1100], [-500, -350], [150, 150], [700, 550], [1050, 850],
];
export const LAKE = { x: 1250, z: 1000, r: 420 };

// Flight tuning for the little mail plane.
export const PLANE = {
  maxSpeed: 96, // m/s at full throttle, level flight
  stallSpeed: 26, // m/s, 22 with flaps
  takeoffSpeed: 31,
  gearHeight: 1.6, // metres of clearance on the ground
  fuelSecondsAtFull: 620, // seconds of full-throttle flying on a full tank
  tankCapacity: 1,
  hardLandingVspeed: -7, // m/s: harder than this damages the gear
  crashVspeed: -13, // m/s: this hard is a crash, not a landing
  maxG: 4.2, // structural limit; past this the airframe fails
  fragileG: 2.2, // the fragile parcel breaks past this
};

// One leg of the mail day: fly the ring course, then land on the destination strip.
export const LEGS = [
  {
    id: 'morning-post',
    name: 'Morning Post',
    brief: 'Carry the morning mail from Ember Field to Pinewatch. Follow the gold rings down the valley and set her down gently on the grass strip.',
    from: 'ember',
    to: 'pinewatch',
    rings: 5,
    timeLimit: 260,
    fragile: false,
    preset: 'morning',
    wind: { x: 2, z: 1 },
  },
  {
    id: 'fragile-parcel',
    name: 'Fragile Parcel',
    brief: 'A crate of glass jars rides to Lakeshore. Fly it like it is made of eggs: keep the G-meter under 2.2 and kiss the runway on landing.',
    from: 'pinewatch',
    to: 'lakeshore',
    rings: 6,
    timeLimit: 320,
    fragile: true,
    preset: 'noon',
    wind: { x: -3, z: 2 },
  },
  {
    id: 'dusk-medical',
    name: 'Dusk Medical Run',
    brief: 'Medicine for Ember Field, and the light is going. Crosswind on final, runway lights on. Bring her home before dark.',
    from: 'lakeshore',
    to: 'ember',
    rings: 6,
    timeLimit: 290,
    fragile: false,
    preset: 'dusk',
    wind: { x: 5, z: -3 },
  },
];

export const SCORING = {
  deliveryBase: 400,
  timeBonusMax: 300,
  softLandingMax: 150,
  ringBonus: 50,
  fuelBonusMax: 100,
  fragileBonus: 150,
};
