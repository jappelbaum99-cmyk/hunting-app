// Hunting Hub's own icon set, used in place of emoji everywhere (hub, phone
// page and website) so every symbol matches the theme. Each icon is drawn on
// a 24×24 grid with round 1.8px strokes in the current text color.

const ICON_SHAPES = {
  // Area and plan icons
  wheat:
    '<path d="M12 21V9"/><path d="M12 7.5c-1.2-1.3-1.2-3.2 0-4.5 1.2 1.3 1.2 3.2 0 4.5z"/><path d="M12 11.5c-2.6 0-4.2-1.6-4.2-4.2 2.6 0 4.2 1.6 4.2 4.2zM12 11.5c2.6 0 4.2-1.6 4.2-4.2-2.6 0-4.2 1.6-4.2 4.2z"/><path d="M12 16c-2.6 0-4.2-1.6-4.2-4.2 2.6 0 4.2 1.6 4.2 4.2zM12 16c2.6 0 4.2-1.6 4.2-4.2-2.6 0-4.2 1.6-4.2 4.2z"/>',
  corn: '<path d="M12 2.8c1.9 0 2.9 2.9 2.9 6.6 0 3.4-1 6.2-2.9 7.3-1.9-1.1-2.9-3.9-2.9-7.3 0-3.7 1-6.6 2.9-6.6z"/><path d="M10.4 7h3.2M10.1 10h3.8M10.4 13h3.2"/><path d="M12 21c-4.2-1.4-6.4-5.4-5.8-10.2 2.2 1.6 3.6 4.2 4.1 6.9M12 21c4.2-1.4 6.4-5.4 5.8-10.2-2.2 1.6-3.6 4.2-4.1 6.9"/>',
  clover:
    '<path d="M12 11.5c-2.4-1-3.6-2.6-3.6-4.3a2 2 0 0 1 3.6-1.2 2 2 0 0 1 3.6 1.2c0 1.7-1.2 3.3-3.6 4.3z"/><path d="M11.4 12.3c-1.6 2-3.4 2.8-5 2.4a2 2 0 0 1-.3-3.8 2 2 0 0 1 2-3.2c1.6.5 2.8 2.2 3.3 4.6z"/><path d="M12.6 12.3c1.6 2 3.4 2.8 5 2.4a2 2 0 0 0 .3-3.8 2 2 0 0 0-2-3.2c-1.6.5-2.8 2.2-3.3 4.6z"/><path d="M12 12.5c0 3.5.9 6 3 8.5"/>',
  apple:
    '<path d="M12 7.6c-3-2-7-.6-7 3.8 0 4.2 2.9 9.1 5.4 9.1.9 0 1.6-.5 1.6-.5s.7.5 1.6.5c2.5 0 5.4-4.9 5.4-9.1 0-4.4-4-5.8-7-3.8z"/><path d="M12 7.6c0-2 .8-3.6 2.4-4.6"/><path d="M12.6 5.4c1.6-.5 3.2 0 4 1.1-1.4.8-3 .6-4-1.1z"/>',
  oak: '<path d="M9.5 16.5H8a3.6 3.6 0 0 1-1.1-7 4.6 4.6 0 0 1 8.6-3.2 3.9 3.9 0 0 1 1.9 7.3 2.9 2.9 0 0 1-2.9 2.9h-1"/><path d="M12 21v-9.5M12 15l-2.4-2.2M12 13.2l2.2-1.7"/>',
  pine: '<path d="M12 2.5 7.2 9.2h2.6L6 14.8h3.4L6.5 19h11l-2.9-4.2H18l-3.8-5.6h2.6z"/><path d="M12 19v2.5"/>',
  brush:
    '<path d="M5 21c3.2-3.6 6.6-8.4 9.4-11.6C15.8 7.8 17.4 6.4 19.5 5"/><path d="M8.6 16.6c-2.3-.7-3.4-2.7-3-5.4 2.4.4 3.8 2.3 3 5.4zM11.4 13.1c-1.7-1.7-1.9-4.2-.4-6.4 1.9 1.6 2.1 4.1.4 6.4zM12.7 14.6c1.7-1.9 4.2-2.4 6.4-1-1.6 2-4.1 2.4-6.4 1zM15.4 10c.8-2.3 2.8-3.5 5.3-3.1-.6 2.4-2.6 3.6-5.3 3.1z"/>',
  acorn: '<path d="M6.4 9.6c0-3.1 2.5-5.2 5.6-5.2s5.6 2.1 5.6 5.2z"/><path d="M12 4.4V2.6"/><path d="M7.6 9.6c.2 4.8 2 8.6 4.4 10.4 2.4-1.8 4.2-5.6 4.4-10.4"/>',
  bed: '<path d="M3.5 18c0-2.4 3.8-4.4 8.5-4.4s8.5 2 8.5 4.4z"/><path d="M6.6 14.4 5.4 9.6M9.6 13.7 9 8.2M14.4 13.7l.6-5.5M17.4 14.4l1.2-4.8M12 13.6V7"/>',
  deer: '<path d="M9.6 11.2h4.8l-1 6.4c-.3 1.6-1.1 2.6-1.4 2.6s-1.1-1-1.4-2.6z"/><path d="M9.6 11.2C7.4 9.4 6.2 7 6.2 3M6.4 6.6 4.2 5M7.4 8.8H5.2M14.4 11.2c2.2-1.8 3.4-4.2 3.4-8.2M17.6 6.6 19.8 5M16.6 8.8h2.2"/><path d="M9.6 11.8 6.8 12.6M14.4 11.8l2.8.8"/>',
  sanctuary: '<path d="M12 3 19 5.8v5.4c0 4.4-2.9 7.9-7 9.8-4.1-1.9-7-5.4-7-9.8V5.8z"/><path d="M9 12h6"/>',
  water: '<path d="M12 3.2c3 4 6 7.4 6 10.8a6 6 0 0 1-12 0c0-3.4 3-6.8 6-10.8z"/><path d="M9.4 14.6a2.6 2.6 0 0 0 2.6 2.6"/>',
  rock: '<path d="M3.5 18.5 6 11.4l4.2-3.6 4.2 1.4 3.6 4 2.5 5.3z"/><path d="M10.2 7.8 9 12.4l3.2 1.2"/>',
  fire: '<path d="M12 3c.9 3.1 5 5.1 5 10.2a5 5 0 0 1-10 0c0-2.6 1.4-4.1 2.4-5.1.1 2 1 3.1 2.1 3.1 0-3-1.1-5.3.5-8.2z"/>',
  tractor:
    '<path d="M4 11V6h6.2l2 5.2h6.4l1 3.4"/><path d="M15.4 11.2V7.4"/><circle cx="8" cy="15.6" r="4.2"/><circle cx="8" cy="15.6" r="1.2"/><circle cx="18" cy="17.4" r="2.4"/>',
  pin: '<path d="M12 21s-6-5.4-6-10.8a6 6 0 0 1 12 0C18 15.6 12 21 12 21z"/><circle cx="12" cy="10.2" r="2.2"/>',
  clipboard: '<path d="M15.5 5H18v16H6V5h2.5"/><path d="M9 3.5h6v3H9z"/><path d="M9 11h6M9 14.5h6M9 18h3.5"/>',

  turkey:
    '<path d="M4.4 13.4a7.6 7.6 0 0 1 15.2 0"/><path d="M12 13V5.8M8.4 13.6 6.6 7.6M15.6 13.6l1.8-6"/><path d="M9.6 15a2.4 2.9 0 1 0 4.8 0 2.4 2.9 0 1 0-4.8 0z"/><path d="M12 12.1V10M11 17.8l-.5 3.2M13 17.8l.5 3.2"/>',
  bear: '<path d="M7.4 16c0-2.6 2.1-4.7 4.6-4.7s4.6 2.1 4.6 4.7c0 2-1.6 3.4-4.6 3.4S7.4 18 7.4 16z"/><circle cx="6.2" cy="10.6" r="1.7"/><circle cx="9.6" cy="7.2" r="1.7"/><circle cx="14.4" cy="7.2" r="1.7"/><circle cx="17.8" cy="10.6" r="1.7"/>',
  binoculars:
    '<circle cx="7" cy="15.4" r="3.4"/><circle cx="17" cy="15.4" r="3.4"/><path d="M10.4 15.4h3.2M4.4 12.6 6.2 5.4h3.2l1 7M19.6 12.6l-1.8-7.2h-3.2l-1 7"/>',

  // App icons
  track: '<path d="M11 4.2C8 4.7 6 9.1 6 14c0 3 1.4 5 3.2 5 1.2 0 1.8-1.2 1.8-3z"/><path d="M13 4.2c3 .5 5 4.9 5 9.8 0 3-1.4 5-3.2 5-1.2 0-1.8-1.2-1.8-3z"/>',
  stand: '<path d="M7 9h10M8.5 9V4.5h7V9"/><path d="M9.6 21 11 9M14.4 21 13 9"/><path d="M10.1 17.2h3.8M10.5 13.6h3"/>',
  send: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13.5V19h14v-5.5"/>',
  camp: '<path d="M2.5 20h19M4.2 20 12 5.2 19.8 20"/><path d="M9 20l3-5.6 3 5.6"/><path d="M12 5.2 10.6 2.8M12 5.2l1.4-2.4"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  family:
    '<circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3.4 2.4-5.8 5.5-5.8s5.5 2.4 5.5 5.8"/><circle cx="17" cy="9.6" r="2.4"/><path d="M15.6 14.5c.4-.1.9-.2 1.4-.2 2.4 0 4 1.9 4 5"/>',
  // Small interface symbols, so nothing falls back to a phone's emoji style.
  check: '<path d="M5 12.5 9.8 17 19 7"/>',
  camera: '<rect x="6" y="3.5" width="12" height="17" rx="2.5"/><circle cx="12" cy="13.5" r="3"/><path d="M9.5 7h1.5M14 7h.5"/><path d="M6 8H4M6 16H4M18 8h2M18 16h2"/>',
  chart: '<path d="M4 20h16"/><path d="M6.5 16.5v-5M11 16.5V7M15.5 16.5v-7M20 16.5V4.5"/>',
  arrow: '<path d="M12 20V4.5M6 10.5 12 4.5l6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'chevron-right': '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  steady: '<path d="M4.5 12H19M13.5 6.5 19 12l-5.5 5.5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5.5h2.6v13H8zM13.4 5.5H16v13h-2.6z" fill="currentColor"/>',
} as const;

export type IconName = keyof typeof ICON_SHAPES;

// Icons offered for area types, in picker order.
export const AREA_ICON_NAMES: IconName[] = [
  'wheat', 'corn', 'clover', 'apple', 'oak', 'pine', 'brush', 'acorn',
  'bed', 'deer', 'sanctuary', 'water', 'rock', 'fire', 'tractor', 'pin',
];

// Area icons used to be emoji; saved settings may still hold them.
const FROM_EMOJI: Record<string, IconName> = {
  '🌾': 'wheat', '🌽': 'corn', '🍀': 'clover', '🍎': 'apple', '🌳': 'oak', '🌲': 'pine', '🌿': 'brush', '🍂': 'acorn',
  '🛏️': 'bed', '🛏': 'bed', '🦌': 'deer', '🚫': 'sanctuary', '💧': 'water', '🪨': 'rock', '🔥': 'fire', '🚜': 'tractor', '📍': 'pin',
};

// The icon for a stored icon value: an icon name, or an emoji from before.
export function iconName(value: string | null | undefined): IconName {
  if (value && value in ICON_SHAPES) return value as IconName;
  return (value && FROM_EMOJI[value]) || 'pin';
}

// The icon as an SVG string, for HTML built outside React (map labels, the website).
export function iconSvg(name: IconName, size = 20): string {
  return (
    `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_SHAPES[name]}</svg>`
  );
}
