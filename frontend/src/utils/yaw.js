// Plain-language definitions for the "Yaw" column of the forecast table, and for the other columns.
// "Yaw" = turning the nacelle (the housing on top of the tower that holds the rotor) so the rotor faces the wind.

/** Which kind of advice a backend yaw note is. Unknown notes are 'other' so a new backend wording never breaks the page. */
export function yawKind(note = '') {
  if (note.startsWith('track')) return 'track';
  if (note.includes('within deadband')) return 'deadband';
  if (note.includes('low confidence')) return 'unreliable';
  return 'other';
}

/** Badge colour per kind: green = act (track), yellow = hold because the change is tiny, grey = hold because the direction is not trusted. */
export const YAW_TONE = { track: 'good', deadband: 'warn', unreliable: 'neutral', other: 'neutral' };
export const yawTone = (note) => YAW_TONE[yawKind(note)];

/** The three kinds of advice, with the live limits filled in. `badge`/`detail` are exactly what the table shows. */
export function yawLegend({ deadband = 8, confMin = 0.75, minSpeed = 3 } = {}) {
  return [
    {
      kind: 'track', badge: 'track', detail: '',
      meaning: `The forecast direction can be trusted for this hour, and the wind has moved more than ${deadband}° away from the current heading.`,
      advice: 'Turn the nacelle to the new heading shown in the Heading column.',
      hint: 'Follow the wind: turn to the new heading.',
    },
    {
      kind: 'deadband', badge: 'hold', detail: 'within deadband',
      meaning: `The forecast direction can be trusted, but it differs from the current heading by only ${deadband}° or less (the "deadband").`,
      advice: 'Keep the current heading: such a small turn is not worth the movement.',
      hint: `Stay put: the change is within ${deadband}°, too small to bother turning.`,
    },
    {
      kind: 'unreliable', badge: 'hold', detail: 'low confidence or below cut-in/low-speed',
      meaning: `The model is not sure of the direction this hour: its confidence (R) is below ${confMin}, or the wind is lighter than ${minSpeed} m/s, where direction is erratic.`,
      advice: "Keep the last reliable heading and ignore this hour's direction.",
      hint: 'Stay put: the direction is not trustworthy this hour (low confidence or very light wind).',
    },
  ];
}

/** Hover text for a label in the table. */
export function yawHint(note, limits) {
  return yawLegend(limits).find((k) => k.kind === yawKind(note))?.hint;
}

/** How many forecast hours fall into each kind of advice. */
export function countYawKinds(hours = []) {
  const counts = { track: 0, deadband: 0, unreliable: 0, other: 0 };
  for (const h of hours) counts[yawKind(h.yaw_note)] += 1;
  return counts;
}

/** What each column of the 24-hour table means, in the order shown. */
export const COLUMN_HELP = [
  ['Lead', 'How many hours after the forecast start this row is. +1h is the first hour predicted.'],
  ['Local time', 'The hour in local time. The charts use UTC instead, so the two differ by the time-zone offset.'],
  ['Speed m/s', 'Predicted wind speed at 100 m height (about hub height), in metres per second.'],
  ['Direction', 'Where the wind comes from, in degrees clockwise from north, with a compass point (ENE = east-north-east).'],
  ['Conf. R', 'How sure the model is about the direction: 1 is certain, close to 0 means it cannot tell.'],
  ['Heading °', 'The advised direction for the nacelle to face. A dash means no reliable heading has been set yet.'],
  ['Yaw', 'The advice for that hour: follow the wind ("track") or stay put ("hold"). See the key above.'],
  ['Power kW', 'Power the selected turbine would produce at the predicted wind. Zero means the wind is below the turbine cut-in speed.'],
  ['Energy kWh', 'Energy produced in that hour. In a one-hour step it equals the power in kW.'],
];
