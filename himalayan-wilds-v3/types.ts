/** 3D Vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 3D Position as a tuple. */
export type Position3D = [number, number, number];

/** Represents an object in the 3D scene. */
export interface Entity3D {
  id: string | number;
  type?: string;
  position: Vec3 | Position3D;
  rotation?: Vec3 | Position3D;
  scale?: Vec3 | Position3D;
  velocity?: Vec3;
  active?: boolean;
  [key: string]: any;
}

/** Represents a particle in a particle system. */
export interface Particle {
  id: string | number;
  position: Vec3 | Position3D;
  velocity?: Vec3 | Position3D;
  life: number;
  maxLife: number;
  color?: string;
  size?: number;
  [key: string]: any;
}

/** Item in player unlimited inventory */
export interface InventoryItem {
  id: string;
  name: string;
  category: 'material' | 'hunting' | 'tool' | 'special';
  count: number;
  description: string;
  icon: string;
}

/** Recruited Settlement Specialist */
export interface Specialist {
  id: string;
  name: string;
  title: string;
  profession: 'Hunter' | 'Carpenter' | 'Herbalist' | 'Builder' | 'Trader';
  recruited: boolean;
  location: string;
  assignedPos?: [number, number, number];
  currentPos?: [number, number, number];
  facingRot?: number;
  walkPhase?: number;
  dialogue: string;
  unlockedBonus: string;
  color: string;
}

/** Settlement Building Blueprint and State */
export interface BuildingStructure {
  id: string;
  type: 'campfire' | 'shelter' | 'hunter_hut' | 'carpenter_workshop' | 'herbalist_lodge' | 'stone_storehouse' | 'watchtower' | 'bridge';
  name: string;
  level: number;
  maxLevel: number;
  position: [number, number, number];
  rotationY: number;
  cost: Record<string, number>;
  built: boolean;
  description: string;
}

/** Quest Definition and State */
export interface Quest {
  id: string;
  chapter: number;
  title: string;
  giver: string;
  description: string;
  objective: string;
  currentProgress: number;
  targetProgress: number;
  completed: boolean;
  rewardText: string;
}

/** Wildlife Animal Entity State */
export interface AnimalEntity {
  id: string;
  type: 'deer' | 'boar' | 'goral' | 'leopard';
  position: [number, number, number];
  rotationY: number;
  state: 'idle' | 'grazing' | 'walk' | 'alert' | 'flee' | 'downed';
  health: number;
  maxHealth: number;
  speed: number;
  fleeTimer: number;
  alertTimer: number;
}

/** Harvestable Node in World */
export interface ResourceNode {
  id: string;
  type: 'wood' | 'stone' | 'fiber' | 'herb';
  name: string;
  position: [number, number, number];
  respawnTime: number;
  maxHarvests: number;
  harvestCount: number;
  harvestItemId: string;
  harvestAmount: number;
}

/** Discoverable Track / Landmark Clue */
export interface ClueNode {
  id: string;
  type: 'deer_tracks' | 'herb_cache' | 'ruins_marker' | 'viewpoint';
  title: string;
  description: string;
  position: [number, number, number];
  discovered: boolean;
}
