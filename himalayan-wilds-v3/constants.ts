import {MusicTrack} from './utils/helper';

/** Game configuration schema. */
export const CONFIG = {
  // --- Game ---
  title: {
    value: 'Himalayan Wilds',
    type: 'string',
    label: 'Game Title',
    group: 'GAME',
  },
  baseCanvasWidth: {
    value: 1280,
    type: 'number',
    label: 'Base Canvas Width',
    group: 'GAME',
  },
  baseCanvasHeight: {
    value: 720,
    type: 'number',
    label: 'Base Canvas Height',
    group: 'GAME',
  },

  // --- Camera ---
  fov: {
    value: 75,
    type: 'number',
    label: 'Field of View',
    group: 'Camera',
    min: 45,
    max: 100,
    step: 5,
  },
  cameraX: {
    value: 0,
    type: 'number',
    label: 'Camera X',
    group: 'Camera',
  },
  cameraY: {
    value: 1.6,
    type: 'number',
    label: 'Camera Y',
    group: 'Camera',
  },
  cameraZ: {
    value: 0,
    type: 'number',
    label: 'Camera Z',
    group: 'Camera',
  },

  // --- Visuals & Atmosphere ---
  backgroundColor: {
    value: '#7ba7b5',
    type: 'color',
    label: 'Atmospheric Fog/Sky Color',
    group: 'Visuals',
  },
  primaryColor: {
    value: '#d97706',
    type: 'color',
    label: 'Primary Accent Color',
    group: 'THEME',
  },
  fontFamily: {
    value: 'serif',
    type: 'string',
    label: 'Font Family',
    group: 'THEME',
  },
  ambientColor: {
    value: '#94a3b8',
    type: 'color',
    label: 'Ambient Light Color',
    group: 'Visuals',
  },
  ambientIntensity: {
    value: 1.8,
    type: 'number',
    label: 'Ambient Intensity',
    group: 'Visuals',
    min: 0.5,
    max: 5,
    step: 0.1,
  },
  sunColor: {
    value: '#fffbeb',
    type: 'color',
    label: 'Sun Color',
    group: 'Visuals',
  },
  sunIntensity: {
    value: 3.8,
    type: 'number',
    label: 'Sun Intensity',
    group: 'Visuals',
    min: 1.0,
    max: 10,
    step: 0.1,
  },
  hemiSkyColor: {
    value: '#93c5fd',
    type: 'color',
    label: 'Hemisphere Sky Color',
    group: 'Visuals',
  },
  hemiGroundColor: {
    value: '#451a03',
    type: 'color',
    label: 'Hemisphere Ground Color',
    group: 'Visuals',
  },
  hemiIntensity: {
    value: 1.4,
    type: 'number',
    label: 'Hemisphere Intensity',
    group: 'Visuals',
    min: 0.5,
    max: 3,
    step: 0.1,
  },

  // --- Physics & Locomotion ---
  gravity: {
    value: -18.0,
    type: 'number',
    label: 'Gravity',
    group: 'Physics',
    min: -30,
    max: -5,
    step: 0.5,
  },
  playerSpeed: {
    value: 8.0,
    type: 'number',
    label: 'Walk Speed',
    group: 'Physics',
    min: 4,
    max: 14,
    step: 0.5,
  },
  sprintMultiplier: {
    value: 1.8,
    type: 'number',
    label: 'Sprint Multiplier',
    group: 'Physics',
    min: 1.2,
    max: 2.5,
    step: 0.1,
  },
  mouseSensitivity: {
    value: 0.0025,
    type: 'number',
    label: 'Mouse Look Sensitivity',
    group: 'Physics',
    min: 0.001,
    max: 0.008,
    step: 0.0005,
  },

  // --- Rules & Exploration ---
  playerMaxHealth: {
    value: 100,
    type: 'number',
    label: 'Max Health',
    group: 'Rules',
    min: 50,
    max: 200,
    step: 10,
  },
  timeLimit: {
    value: 0,
    type: 'number',
    label: 'Time Limit (0 for infinite)',
    group: 'Rules',
  },
  deerCount: {
    value: 12,
    type: 'number',
    label: 'Himalayan Deer Population',
    group: 'Rules',
    min: 4,
    max: 20,
    step: 1,
  },
  boarCount: {
    value: 8,
    type: 'number',
    label: 'Wild Boar Population',
    group: 'Rules',
    min: 2,
    max: 12,
    step: 1,
  },

  // --- System ---
  targetFPS: {
    value: 60,
    type: 'number',
    label: 'Target FPS',
    group: 'System',
  },
  stepMs: {
    value: 1000 / 60,
    type: 'number',
    label: 'Step MS',
    group: 'System',
  },
  maxSubSteps: {
    value: 5,
    type: 'number',
    label: 'Max Sub Steps',
    group: 'System',
  },

  // --- Audio ---
  defaultMusicVolume: {
    value: 0.25,
    type: 'number',
    label: 'Default Music Volume',
    group: 'AUDIO',
    min: 0,
    max: 1,
    step: 0.05,
  },
  defaultSfxVolume: {
    value: 0.6,
    type: 'number',
    label: 'Default SFX Volume',
    group: 'AUDIO',
    min: 0,
    max: 1,
    step: 0.05,
  },
  backgroundMusicUrl: {
    value: 'https://storage.googleapis.com/assets-gen-playground/musiclibrary/verdant_bloom.mp3',
    type: 'string',
    label: 'Background Music URL',
    group: 'Audio',
  },
};

// Merge customized config values if present (injected by Playground)
const {playgroundConfig} = globalThis as {
  playgroundConfig?: Record<string, unknown>;
};
if (playgroundConfig) {
  for (const [key, value] of Object.entries(playgroundConfig)) {
    if (key in CONFIG) {
      Object.assign(CONFIG[key as keyof typeof CONFIG], {value});
    }
  }
}

/** Type helper for reading values in game code. */
export type ConfigKey = keyof typeof CONFIG;

/**
 * Gets a configuration value by key.
 * @param key The configuration key.
 * @return The configuration value.
 */
export function getConfig<K extends ConfigKey>(
  key: K,
): (typeof CONFIG)[K]['value'] {
  return CONFIG[key].value;
}

/** Thematic definitions */
export const THEME = {
  fontFamily: 'serif',
  colors: {
    primary: '#d97706',
    secondary: '#059669',
    background: '#1c1917',
    slate: '#475569',
    timber: '#78350f',
    stone: '#64748b',
    snow: '#e2e8f0',
  },
};

/** Background music tracks available for the game to use. */
export const AVAILABLE_MUSIC_TRACKS: readonly MusicTrack[] = [
  {
    name: 'verdant_bloom',
    url: 'https://storage.googleapis.com/assets-gen-playground/musiclibrary/verdant_bloom.mp3',
    description: 'Serene Himalayan acoustic wilderness flute and strings.',
  },
  {
    name: 'heroes_journey',
    url: 'https://storage.googleapis.com/assets-gen-playground/musiclibrary/heroes_journey.mp3',
    description: 'Mountain ridge adventure orchestral theme.',
  },
  {
    name: 'zen_garden',
    url: 'https://storage.googleapis.com/assets-gen-playground/musiclibrary/zen_garden.mp3',
    description: 'Tranquil Himalayan flute and mountain bells.',
  },
];
