import {
  ArrowUpCircle,
  Compass,
  Crosshair,
  Footprints,
  Hammer,
  HelpCircle,
  Home,
  Map as MapIcon,
  Move,
  Package,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scroll,
  Trees,
  Volume2,
  VolumeX,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRODUCTION } from './Buildings';
import { getConfig } from './constants';
import { emit, engine, type GameActions, ITEM_LABEL } from './engine';
import { Game, resetWorld } from './Game';
import { ClockChip, Hud } from './Hud';
import { CAMPS } from './Npcs';
import { BRIDGE_SITE, RIVER_HEAD_Z, RIVER_X } from './terrain';
import type { BuildingStructure, ClueNode, InventoryItem, Quest, Specialist } from './types';
import BackgroundMusic from './utils/BackgroundMusic';
import { gameAudio, GameState, MenuOverlay, Overlay, useAutoFocus, useIsMobile } from './utils/helper';
import { usePlayground, usePlaygroundGameLifecycle } from './utils/usePlayground';
import { WorldMap } from './WorldMap';

interface CustomWindow extends Window {
  canHandleBackKey?: boolean;
}

// ---------------------------------------------------------------------------
// Static game data
// ---------------------------------------------------------------------------
const ITEM_DEFS: Record<string, Omit<InventoryItem, 'count'>> = {
  bow: { id: 'bow', name: 'Mountain Yew Bow', category: 'tool', description: 'Hold left mouse to draw, release to loose. Hold right mouse to aim.', icon: '🏹' },
  arrow: { id: 'arrow', name: 'Flint Arrows', category: 'tool', description: 'Craft 10 from a single timber log.', icon: '🎯' },
  wood: { id: 'wood', name: 'Timber', category: 'material', description: 'Fallen deodar logs from the pine woods.', icon: '🪵' },
  stone: { id: 'stone', name: 'Slate', category: 'material', description: 'Blue-grey slate for Kath-Kuni foundations and roofs.', icon: '🪨' },
  fiber: { id: 'fiber', name: 'Nettle Fibre', category: 'material', description: 'Braided cordage from mountain nettle.', icon: '🌿' },
  herb: { id: 'herb', name: 'Artemisia Herbs', category: 'material', description: 'Aromatic alpine herb used by healers.', icon: '🌱' },
  deer_pelt: { id: 'deer_pelt', name: 'Deer Pelt', category: 'hunting', description: 'Warm chestnut fur for garments and bindings.', icon: '🦌' },
  boar_hide: { id: 'boar_hide', name: 'Boar Hide', category: 'hunting', description: 'Tough leather for shelters and gear.', icon: '🐗' },
  goral_horn: { id: 'goral_horn', name: 'Goral Horn', category: 'hunting', description: 'Curved horn prized by craftsmen.', icon: '🐐' },
  bone: { id: 'bone', name: 'Bone', category: 'hunting', description: 'For arrowheads, hooks and tool handles.', icon: '🦴' },
  sinew: { id: 'sinew', name: 'Sinew', category: 'hunting', description: 'Elastic bowstring cordage.', icon: '🧵' },
};

const START_COUNTS: Record<string, number> = { bow: 1, arrow: 30, wood: 12, stone: 8, fiber: 6, herb: 2, deer_pelt: 0, boar_hide: 0, goral_horn: 0, bone: 0, sinew: 0 };

function makeInventory(): Record<string, InventoryItem> {
  const inv: Record<string, InventoryItem> = {};
  for (const [id, def] of Object.entries(ITEM_DEFS)) inv[id] = { ...def, count: START_COUNTS[id] ?? 0 };
  return inv;
}

const RECRUIT_COST: Record<string, Record<string, number>> = {
  carpenter: { wood: 20, fiber: 10 },
  herbalist: { herb: 8 },
  builder: { stone: 30, deer_pelt: 4 },
};

const INITIAL_SPECIALISTS: Specialist[] = [
  {
    id: 'hunter', name: 'Kalyan the Tracker', title: 'Master Hunter', profession: 'Hunter', recruited: true, location: 'The village',
    dialogue: 'A herd grazes in the open meadows near the village. Crouch [C] and come in slowly — they hear a sprinting man from forty paces. Draw the bow fully for a clean kill.',
    unlockedBonus: 'Build his Lodge to double pelt yields and track wildlife on your radar.', color: '#15803d',
  },
  {
    id: 'carpenter', name: 'Devan the Woodworker', title: 'Carpenter', profession: 'Carpenter', recruited: false, location: CAMPS.carpenter.area,
    dialogue: 'You want a real village? Bring me 20 timber and 10 nettle fibre and I will frame Kath-Kuni houses the old way.',
    unlockedBonus: '+2 timber from every log you gather.', color: '#b45309',
  },
  {
    id: 'herbalist', name: 'Meera of the Valleys', title: 'Herbalist', profession: 'Herbalist', recruited: false, location: CAMPS.herbalist.area,
    dialogue: 'The purple artemisia blooms all over these meadows. Gather 8 bundles for me and I will tend your people.',
    unlockedBonus: '+1 herb from every bush you gather.', color: '#047857',
  },
  {
    id: 'builder', name: 'Gopal Stonecarver', title: 'Master Builder', profession: 'Builder', recruited: false, location: CAMPS.builder.area,
    dialogue: 'These ruins were raised by my ancestors. Bring 30 slate and 4 deer pelts and together we will bridge the river.',
    unlockedBonus: '+2 slate from every outcrop you work.', color: '#475569',
  },
];

const INITIAL_BUILDINGS: BuildingStructure[] = [
  { id: 'campfire', type: 'campfire', name: 'Village Hearth', level: 1, maxLevel: 1, position: [0, 0.1, 0], rotationY: 0, cost: {}, built: true, description: 'The heart of the settlement.' },
  { id: 'hunter_hut', type: 'hunter_hut', name: "Hunter's Lodge", level: 0, maxLevel: 2, position: [6, 0.1, -4], rotationY: 0.2, cost: { wood: 15, fiber: 6, stone: 6 }, built: false, description: 'Fletches arrows for you and doubles pelt yields.' },
  { id: 'carpenter_workshop', type: 'carpenter_workshop', name: "Carpenter's Workshop", level: 0, maxLevel: 2, position: [-8, 0.1, 6], rotationY: -0.3, cost: { wood: 22, fiber: 8, stone: 10 }, built: false, description: 'Devan saws timber for the village stockpile.' },
  { id: 'herbalist_lodge', type: 'herbalist_lodge', name: "Herbalist's Sanctuary", level: 0, maxLevel: 2, position: [10, 0.1, 8], rotationY: -0.6, cost: { wood: 12, stone: 10, herb: 6 }, built: false, description: 'Meera grows herbs and twists nettle fibre.' },
  { id: 'watchtower', type: 'watchtower', name: 'Mountain Watchtower', level: 0, maxLevel: 2, position: [-6, 0.1, -10], rotationY: 0.8, cost: { wood: 28, stone: 18, fiber: 10 }, built: false, description: 'Spots wildlife across the valley and quarries slate.' },
  { id: 'bridge', type: 'bridge', name: 'River Bridge', level: 0, maxLevel: 1, position: [BRIDGE_SITE[0], 0, BRIDGE_SITE[1]], rotationY: 0, cost: { wood: 40, stone: 25, fiber: 15, deer_pelt: 4 }, built: false, description: 'Reopens the old trade trail across the river.' },
];

const UPGRADE_EXTRA: Record<string, Record<string, number>> = {
  hunter_hut: { boar_hide: 2, sinew: 2 }, carpenter_workshop: { bone: 4 }, herbalist_lodge: { herb: 6 }, watchtower: { goral_horn: 2 },
};
function upgradeCost(b: BuildingStructure) {
  const c: Record<string, number> = {};
  for (const [k, v] of Object.entries(b.cost)) c[k] = Math.ceil(v * 0.75);
  for (const [k, v] of Object.entries(UPGRADE_EXTRA[b.id] ?? {})) c[k] = (c[k] ?? 0) + v;
  return c;
}

const MAIN_QUESTS: Quest[] = [
  { id: 'ch1', chapter: 1, title: 'Chapter 1: The First Hunt', giver: 'Kalyan the Tracker', description: 'Follow the gold objective marker to the herd near the village. Crouch, draw fully, and bring back pelts.', objective: 'Collect 2 Deer Pelts', currentProgress: 0, targetProgress: 2, completed: false, rewardText: '+500 renown.' },
  { id: 'ch2', chapter: 2, title: 'Chapter 2: A Place to Call Home', giver: 'Kalyan the Tracker', description: 'Gather timber, slate and nettle (follow the compass icons), then open Build [B] and raise the Hunter’s Lodge.', objective: 'Build the Hunter’s Lodge', currentProgress: 0, targetProgress: 1, completed: false, rewardText: 'The lodge now fletches arrows for you.' },
  { id: 'ch3', chapter: 3, title: 'Chapter 3: Knowledge Returns', giver: 'Kalyan the Tracker', description: 'Two specialists camp in the wilds. Find Devan and Meera (gold "!" markers) and bring what they ask for.', objective: 'Recruit the Carpenter & Herbalist', currentProgress: 0, targetProgress: 2, completed: false, rewardText: 'Better yields from timber and herbs.' },
  { id: 'ch4', chapter: 4, title: 'Chapter 4: Old Paths', giver: 'Meera of the Valleys', description: 'Prayer-flag cairns mark old landmarks across the valley. Discover any three of them.', objective: 'Discover 3 landmarks', currentProgress: 0, targetProgress: 3, completed: false, rewardText: '+500 renown.' },
  { id: 'ch5', chapter: 5, title: 'Chapter 5: The Healer’s House', giver: 'Meera of the Valleys', description: 'Build the Herbalist’s Sanctuary so Meera can grow herbs and fibre for the village.', objective: 'Build the Herbalist’s Sanctuary', currentProgress: 0, targetProgress: 1, completed: false, rewardText: 'Passive herb & fibre income.' },
  { id: 'ch6', chapter: 6, title: 'Chapter 6: A Village Reborn', giver: 'Devan the Woodworker', description: 'Raise the Carpenter’s Workshop and the Mountain Watchtower.', objective: 'Build the Workshop & Watchtower', currentProgress: 0, targetProgress: 2, completed: false, rewardText: 'Timber & slate income, wildlife on radar.' },
  { id: 'ch7', chapter: 7, title: 'Chapter 7: Across the River', giver: 'Gopal Stonecarver', description: 'The old trade trail crosses the river west of the village. Build the bridge where the trail meets the water.', objective: 'Build the River Bridge', currentProgress: 0, targetProgress: 1, completed: false, rewardText: 'The trade trail is open again.' },
  { id: 'ch8', chapter: 8, title: 'Chapter 8: A Living Mountain Village', giver: 'Village Elders', description: 'Recruit all four specialists, build five structures and earn 2,000 renown.', objective: 'All specialists · 5 buildings · 2,000 renown', currentProgress: 0, targetProgress: 1, completed: false, rewardText: 'VICTORY! The Himalayan haven endures.' },
];

const INITIAL_CLUES: ClueNode[] = [
  { id: 'track_1', type: 'deer_tracks', title: 'Fresh Hoofprints', description: 'Deep prints in damp soil heading toward the open meadows.', position: [34, 0, -46], discovered: false },
  { id: 'track_2', type: 'deer_tracks', title: 'Grazing Scrape', description: 'Bark stripped from young rhododendron. A herd feeds nearby.', position: [-62, 0, 24], discovered: false },
  { id: 'ruins_1', type: 'ruins_marker', title: 'Ancient Stone Inscription', description: 'A weathered tablet describing the Kath-Kuni masonry of the ancestors.', position: [30, 0, -128], discovered: false },
  { id: 'viewpoint_1', type: 'viewpoint', title: 'Nanda Overlook', description: 'A sweeping view over the valley and the snowline beyond.', position: [118, 0, -52], discovered: false },
  { id: 'falls_1', type: 'viewpoint', title: 'Glacier Falls', description: 'Meltwater thunders off the cliff — the source of the valley river.', position: [RIVER_X + 13, 0, RIVER_HEAD_Z + 16], discovered: false },
];

type Tab = 'inventory' | 'quests' | 'buildings' | 'map';

// ---------------------------------------------------------------------------
export default function App() {
  const { sdk } = usePlayground();
  const isMobile = useIsMobile();

  const [gameState, setGameState] = useState<GameState>({ status: 'START', score: 0, level: 1 });
  const [isMusicMuted, setIsMusicMuted] = useState(false);
  const [isSfxMuted, setIsSfxMuted] = useState(false);
  const [isGameMenuOpen, setIsGameMenuOpen] = useState(false);
  const [isHowToPlayOpen, setIsHowToPlayOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [inventory, setInventory] = useState<Record<string, InventoryItem>>(makeInventory);
  const [specialists, setSpecialists] = useState<Specialist[]>(INITIAL_SPECIALISTS);
  const [buildings, setBuildings] = useState<BuildingStructure[]>(INITIAL_BUILDINGS);
  const [quests, setQuests] = useState<Quest[]>(MAIN_QUESTS);
  const [clues, setClues] = useState<ClueNode[]>(INITIAL_CLUES);
  const [selectedBuildingToPlace, setSelectedBuildingToPlace] = useState<string | null>(null);
  const [activeDialogue, setActiveDialogue] = useState<Specialist | null>(null);
  const [notification, setNotification] = useState<{ text: string; id: number } | null>(null);
  const [mobileAim, setMobileAim] = useState(false);
  const [crouchUi, setCrouchUi] = useState(false);

  const startButtonRef = useAutoFocus<HTMLButtonElement>(gameState.status === 'START');
  usePlaygroundGameLifecycle(gameState, sdk);

  // latest-state refs so engine callbacks never go stale
  const invRef = useRef(inventory);
  const buildRef = useRef(buildings);
  const specRef = useRef(specialists);
  const clueRef = useRef(clues);
  invRef.current = inventory;
  buildRef.current = buildings;
  specRef.current = specialists;
  clueRef.current = clues;

  const notify = useCallback((text: string) => setNotification({ text, id: Date.now() + Math.random() }), []);
  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification((n) => (n && n.id === notification.id ? null : n)), 5500);
    return () => clearTimeout(t);
  }, [notification]);

  const addItems = useCallback((delta: Record<string, number>) => {
    setInventory((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(delta)) {
        const base = next[k] ?? { ...(ITEM_DEFS[k] ?? { id: k, name: ITEM_LABEL[k] ?? k, category: 'material', description: '', icon: '📦' }), count: 0 };
        next[k] = { ...base, count: Math.max(0, base.count + v) };
      }
      return next;
    });
  }, []);
  const addScore = useCallback((n: number) => setGameState((p) => ({ ...p, score: p.score + n })), []);

  const has = (cost: Record<string, number>) => Object.entries(cost).every(([k, v]) => (invRef.current[k]?.count ?? 0) >= v);
  const shortfall = (cost: Record<string, number>) =>
    Object.entries(cost).filter(([k, v]) => (invRef.current[k]?.count ?? 0) < v).map(([k, v]) => `${v - (invRef.current[k]?.count ?? 0)} ${ITEM_LABEL[k] ?? k}`).join(', ');
  const spend = (cost: Record<string, number>) => addItems(Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, -v])));

  const actions = useMemo<GameActions>(() => ({
    addItems,
    addScore,
    notify,
    openDialogue: (id) => {
      const s = specRef.current.find((x) => x.id === id);
      if (s) setActiveDialogue(s);
    },
    discoverClue: (id) => {
      const c = clueRef.current.find((x) => x.id === id);
      if (!c || c.discovered) return;
      setClues((prev) => prev.map((x) => (x.id === id ? { ...x, discovered: true } : x)));
      addScore(100);
      emit({ kind: 'popup', text: 'Landmark discovered', color: '#5eead4' });
      notify(`${c.title}: ${c.description}`);
    },
    placeBuilding: (id, pos, rot) => {
      const b = buildRef.current.find((x) => x.id === id);
      if (!b) return;
      if (!b.built) {
        if (!has(b.cost)) {
          notify(`Not enough materials for the ${b.name}. Still need: ${shortfall(b.cost)}.`);
          gameAudio.playCrispClick();
          return;
        }
        spend(b.cost);
        addScore(400);
      }
      setBuildings((prev) => prev.map((x) => (x.id === id ? { ...x, built: true, level: Math.max(1, x.level), position: pos, rotationY: rot } : x)));
      gameAudio.playLevelUpStinger();
      notify(b.built ? `${b.name} moved.` : `${b.name} built!${PRODUCTION[b.id] ? ` It produces ${PRODUCTION[b.id].label}.` : ''}`);
      setSelectedBuildingToPlace(null);
    },
    cancelPlacement: () => setSelectedBuildingToPlace(null),
    openTab: (tab) => setActiveTab((prev) => (prev === tab ? null : tab)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [addItems, addScore, notify]);
  engine.actions = actions;

  // ---- mirror React state into the engine
  const status = gameState.status;
  const uiOpen = !!activeTab || !!activeDialogue || isGameMenuOpen || isHowToPlayOpen || status !== 'PLAYING';
  useEffect(() => { engine.playing = status === 'PLAYING'; engine.uiOpen = uiOpen; }, [status, uiOpen]);
  useEffect(() => {
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(inventory)) counts[k] = v.count;
    engine.world.inventory = counts;
    engine.world.arrows = counts.arrow ?? 0;
  }, [inventory]);
  useEffect(() => {
    engine.world.buildings = buildings;
    engine.world.specialists = specialists.map((s) => ({ id: s.id, name: s.name, recruited: s.recruited }));
    const built = (id: string) => buildings.find((b) => b.id === id)?.built;
    const rec = (id: string) => specialists.find((s) => s.id === id)?.recruited;
    engine.world.bonus = {
      peltMult: built('hunter_hut') ? 2 : 1,
      woodExtra: rec('carpenter') ? 2 : 0,
      stoneExtra: rec('builder') ? 2 : 0,
      herbExtra: rec('herbalist') ? 1 : 0,
      animalRadar: built('watchtower') ? 140 : built('hunter_hut') ? 80 : 45,
    };
  }, [buildings, specialists]);
  useEffect(() => {
    engine.world.clues = clues.map((c) => ({ id: c.id, title: c.title, x: c.position[0], z: c.position[2], discovered: c.discovered }));
  }, [clues]);
  useEffect(() => {
    engine.world.placing = selectedBuildingToPlace;
    if (selectedBuildingToPlace) engine.world.previewRot = engine.player.yaw + Math.PI; // door faces you
  }, [selectedBuildingToPlace]);
  useEffect(() => { engine.world.activeQuest = quests.find((q) => !q.completed)?.id ?? null; }, [quests]);
  useEffect(() => { (window as unknown as CustomWindow).canHandleBackKey = ['PLAYING', 'PAUSED'].includes(status); }, [status]);

  // ---- passive production from buildings (the settlement works for you)
  const prodAcc = useRef<Record<string, number>>({});
  useEffect(() => {
    if (status !== 'PLAYING' || isGameMenuOpen) return;
    const id = setInterval(() => {
      for (const b of buildRef.current) {
        const P = PRODUCTION[b.id];
        if (!P || !b.built) continue;
        prodAcc.current[b.id] = (prodAcc.current[b.id] ?? 0) + 1;
        if (prodAcc.current[b.id] >= P.every) {
          prodAcc.current[b.id] = 0;
          const give = Object.fromEntries(Object.entries(P.give).map(([k, v]) => [k, v * Math.max(1, b.level)]));
          addItems(give);
          emit({ kind: 'popup', text: `${b.name}: ${Object.entries(give).map(([k, v]) => `+${v} ${ITEM_LABEL[k] ?? k}`).join(', ')}`, color: '#a7f3d0' });
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [status, isGameMenuOpen, addItems]);

  // ---- quest progress
  useEffect(() => {
    if (status !== 'PLAYING') return;
    const built = (id: string) => (buildings.find((b) => b.id === id)?.built ? 1 : 0);
    setQuests((prev) => {
      let changed = false;
      const next = prev.map((q) => {
        if (q.completed) return q;
        let cur = 0;
        if (q.id === 'ch1') cur = inventory.deer_pelt?.count ?? 0;
        else if (q.id === 'ch2') cur = built('hunter_hut');
        else if (q.id === 'ch3') cur = specialists.filter((s) => s.recruited && (s.id === 'carpenter' || s.id === 'herbalist')).length;
        else if (q.id === 'ch4') cur = clues.filter((c) => c.discovered).length;
        else if (q.id === 'ch5') cur = built('herbalist_lodge');
        else if (q.id === 'ch6') cur = built('carpenter_workshop') + built('watchtower');
        else if (q.id === 'ch7') cur = built('bridge');
        else if (q.id === 'ch8') cur = specialists.every((s) => s.recruited) && buildings.filter((b) => b.built).length >= 6 && gameState.score >= 2000 ? 1 : 0;
        const done = cur >= q.targetProgress;
        if (cur !== q.currentProgress || done) changed = true;
        if (done) {
          gameAudio.playLevelUpStinger();
          notify(`Quest complete: ${q.title}! ${q.rewardText}`);
          setGameState((p) => ({ ...p, score: p.score + 500, level: Math.min(8, p.level + 1) }));
          if (q.id === 'ch8') setTimeout(() => setGameState((p) => ({ ...p, status: 'VICTORY' })), 2000);
        }
        return { ...q, currentProgress: Math.min(cur, q.targetProgress), completed: done };
      });
      return changed ? next : prev;
    });
  }, [inventory, buildings, specialists, clues, gameState.score, status, notify]);

  // ---- player actions from menus
  const craftArrows = (kind: 'quick' | 'bundle') => {
    const cost: Record<string, number> = kind === 'quick' ? { wood: 1 } : { wood: 2, fiber: 1 };
    if (!has(cost)) { notify(`Need ${shortfall(cost)} to fletch arrows.`); gameAudio.playCrispClick(); return; }
    spend(cost);
    addItems({ arrow: kind === 'quick' ? 10 : 25 });
    gameAudio.playConfirmSelect();
    emit({ kind: 'popup', text: `+${kind === 'quick' ? 10 : 25} Arrows` });
  };

  const recruitSpecialist = (spec: Specialist) => {
    const cost = RECRUIT_COST[spec.id] ?? {};
    if (!has(cost)) { notify(`${spec.name.split(' ')[0]} still needs ${shortfall(cost)}.`); gameAudio.playCrispClick(); return; }
    spend(cost);
    setSpecialists((prev) => prev.map((s) => (s.id === spec.id ? { ...s, recruited: true } : s)));
    gameAudio.playPowerupChime();
    addScore(400);
    notify(`${spec.name} joins the village and heads home. ${spec.unlockedBonus}`);
    setActiveDialogue(null);
  };

  const upgradeBuilding = (b: BuildingStructure) => {
    const cost = upgradeCost(b);
    if (!has(cost)) { notify(`Upgrade needs ${shortfall(cost)}.`); gameAudio.playCrispClick(); return; }
    spend(cost);
    setBuildings((prev) => prev.map((x) => (x.id === b.id ? { ...x, level: x.level + 1 } : x)));
    addScore(250);
    gameAudio.playLevelUpStinger();
    notify(`${b.name} upgraded to level ${b.level + 1} — production doubled.`);
  };

  const initGame = useCallback(() => {
    resetWorld();
    prodAcc.current = {};
    setGameState({ status: 'PLAYING', score: 0, level: 1 });
    setInventory(makeInventory());
    setSpecialists(INITIAL_SPECIALISTS);
    setBuildings(INITIAL_BUILDINGS);
    setQuests(MAIN_QUESTS);
    setClues(INITIAL_CLUES);
    setActiveDialogue(null);
    setSelectedBuildingToPlace(null);
    setIsGameMenuOpen(false);
    setIsHowToPlayOpen(false);
    setActiveTab(null);
    setMobileAim(false);
    engine.input.aimToggle = false;
    notify('Kalyan has spotted deer nearby. Follow the gold marker on your compass.');
    sdk?.startGame();
    gameAudio.playVictoryFanfare();
  }, [sdk, notify]);

  const rank = specialists.filter((s) => s.recruited).length;
  const activeQuest = quests.find((q) => !q.completed);
  const placingB = buildings.find((b) => b.id === selectedBuildingToPlace);
  const hold = (set: () => void, clear: () => void) => ({
    onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); set(); },
    onTouchEnd: (e: React.TouchEvent) => { e.preventDefault(); clear(); },
    onTouchCancel: clear,
  });

  return (
    <div className="fixed inset-0 overflow-hidden touch-none flex flex-col bg-stone-950 text-stone-100 select-none"
      style={{ fontFamily: "'Cinzel', 'Trajan Pro', 'Times New Roman', serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;800;900&display=swap');
        * { font-family: 'Cinzel', 'Trajan Pro', 'Times New Roman', serif !important; }
      `}</style>
      <BackgroundMusic url={getConfig('backgroundMusicUrl')} isPlaying={status === 'PLAYING' && !isGameMenuOpen} isMuted={isMusicMuted} volume={getConfig('defaultMusicVolume')} />

      {/* Top bar */}
      {status === 'PLAYING' && (
        <div className="absolute top-2 left-2 right-2 flex flex-wrap justify-between items-center px-3 py-1.5 bg-stone-950/60 border border-amber-900/30 rounded-xl pointer-events-none z-20 gap-2 shadow-lg">
          <div className="flex items-center gap-2 pointer-events-auto">
            <ClockChip />
            <div className="bg-stone-900/70 px-2.5 py-1 rounded-lg border border-stone-700/40 flex items-center gap-1.5 shadow">
              <Compass className="text-amber-500 w-3.5 h-3.5" />
              <div>
                <div className="text-[8px] uppercase tracking-wider text-stone-400">Settlement · {gameState.score} renown</div>
                <div className="text-[11px] font-bold text-amber-400">{rank === 4 ? 'Thriving Village' : rank >= 2 ? 'Growing Haven' : 'Struggling Camp'}</div>
              </div>
            </div>
            <div className="bg-stone-900/70 px-2.5 py-1 rounded-lg border border-stone-700/40 flex items-center gap-1.5 shadow">
              <Crosshair className="text-sky-400 w-3.5 h-3.5" />
              <div>
                <div className="text-[8px] uppercase tracking-wider text-stone-400">Arrows</div>
                <div className={`text-[11px] font-bold ${(inventory.arrow?.count ?? 0) === 0 ? 'text-red-400' : 'text-sky-300'}`}>{inventory.arrow?.count ?? 0}</div>
              </div>
              <button onClick={() => craftArrows('quick')} title="Craft 10 arrows from 1 timber" className="ml-1 px-1.5 py-0.5 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold text-[9px] rounded">+10 (1 timber)</button>
            </div>
            <div className="hidden md:flex gap-1.5 bg-stone-900/70 px-2 py-1 rounded-lg border border-stone-700/40 text-[10px] font-bold">
              {(['wood', 'stone', 'fiber', 'herb'] as const).map((k) => (
                <span key={k} className="flex items-center gap-0.5 text-stone-200"><span>{ITEM_DEFS[k].icon}</span>{inventory[k]?.count ?? 0}</span>
              ))}
            </div>
          </div>

          <div className="hidden lg:flex flex-col items-center bg-stone-950/70 px-3 py-1 rounded-full border border-amber-900/40">
            <div className="text-[9px] text-amber-400 tracking-wide">{activeQuest?.title ?? 'All chapters complete'}</div>
            <div className="text-[11px] font-bold text-stone-200">
              {activeQuest ? `${activeQuest.objective}${activeQuest.targetProgress > 1 ? ` (${activeQuest.currentProgress}/${activeQuest.targetProgress})` : ''}` : 'Free exploration'}
            </div>
          </div>

          <div className="flex items-center gap-1.5 pointer-events-auto mr-1">
            {([['inventory', Package, 'Pouch'], ['quests', Scroll, 'Journal'], ['buildings', Hammer, 'Build'], ['map', MapIcon, 'Map']] as const).map(([tab, Icon, label]) => (
              <button key={tab} onClick={() => setActiveTab((p) => (p === tab ? null : tab))}
                className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 border transition-all ${activeTab === tab ? 'bg-amber-600 text-stone-950 border-amber-400' : 'bg-stone-900/80 text-stone-200 border-stone-700/60 hover:bg-stone-800'}`}>
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
            <button onClick={() => { gameAudio.playCrispClick(); setIsGameMenuOpen(true); }}
              className="ml-1 px-2.5 py-1 rounded-lg bg-amber-700/90 hover:bg-amber-600 text-stone-100 font-bold text-xs border border-amber-500/70 shadow flex items-center gap-1">
              <Pause className="w-3.5 h-3.5" /><span>Menu</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 w-full min-h-0 relative bg-stone-950 overflow-hidden">
        <Game buildings={buildings} specialists={specialists} clues={clues} placing={selectedBuildingToPlace} />
        <Hud isMobile={isMobile} />

        {status === 'PLAYING' && notification && (
          <div key={notification.id} className="absolute right-4 z-20 pointer-events-none max-w-sm sm:max-w-md px-2 text-right" style={{ top: isMobile ? 104 : 66 }}>
            <div className="text-amber-300 font-bold text-xs sm:text-sm drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] leading-snug tracking-wide">{notification.text}</div>
          </div>
        )}

        {placingB && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 bg-emerald-950/90 border-2 border-emerald-500 text-white px-5 py-3 rounded-2xl flex flex-col sm:flex-row items-center gap-3 shadow-2xl">
            <div className="flex items-center gap-3">
              <Hammer className="text-emerald-400 w-6 h-6" />
              <div>
                <div className="font-bold text-emerald-300 text-sm">{placingB.built ? 'Moving' : 'Placing'}: {placingB.name}</div>
                <div className="text-stone-300 text-[11px]">
                  {placingB.type === 'bridge' ? 'Walk along the river bank — the bridge snaps across the water.' : 'Rotate [Q]/[E] · Place [Left click] · Cancel [Esc / Right click]'}
                </div>
                {!placingB.built && <div className="text-amber-300 text-[11px]">Cost: {Object.entries(placingB.cost).map(([k, v]) => `${v} ${ITEM_LABEL[k] ?? k}`).join(', ')}</div>}
              </div>
            </div>
            <div className="flex gap-2 pointer-events-auto">
              {placingB.type !== 'bridge' && (
                <>
                  <button onClick={() => (engine.world.previewRot -= Math.PI / 8)} className="px-2.5 py-1 bg-stone-800 hover:bg-stone-700 rounded text-xs flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" /></button>
                  <button onClick={() => (engine.world.previewRot += Math.PI / 8)} className="px-2.5 py-1 bg-stone-800 hover:bg-stone-700 rounded text-xs flex items-center gap-1"><RotateCw className="w-3.5 h-3.5" /></button>
                </>
              )}
              {isMobile && <button onClick={() => (engine.input.shootPulse = true)} className="bg-emerald-600 px-3 py-1 rounded text-xs font-bold">Place</button>}
              <button onClick={() => setSelectedBuildingToPlace(null)} className="bg-stone-800 hover:bg-stone-700 px-3 py-1 rounded text-xs text-stone-300">Cancel</button>
            </div>
          </div>
        )}

        {/* Mobile controls */}
        {isMobile && status === 'PLAYING' && !uiOpen && (
          <div className="absolute inset-0 pointer-events-none z-30 flex justify-between p-5 items-end">
            <div className="grid grid-cols-3 gap-1.5 pointer-events-auto bg-stone-900/70 p-2 rounded-2xl border border-stone-700/60">
              <span />
              <button {...hold(() => (engine.input.moveY = 1), () => (engine.input.moveY = 0))} className="w-12 h-12 rounded-xl bg-stone-800 active:bg-amber-600 font-bold">▲</button>
              <span />
              <button {...hold(() => (engine.input.moveX = -1), () => (engine.input.moveX = 0))} className="w-12 h-12 rounded-xl bg-stone-800 active:bg-amber-600 font-bold">◀</button>
              <button {...hold(() => (engine.input.moveY = -1), () => (engine.input.moveY = 0))} className="w-12 h-12 rounded-xl bg-stone-800 active:bg-amber-600 font-bold">▼</button>
              <button {...hold(() => (engine.input.moveX = 1), () => (engine.input.moveX = 0))} className="w-12 h-12 rounded-xl bg-stone-800 active:bg-amber-600 font-bold">▶</button>
            </div>
            <div className="flex flex-col gap-2 pointer-events-auto items-end">
              <div className="flex gap-2">
                <button onClick={() => { const v = !crouchUi; setCrouchUi(v); engine.player.crouching = v; }}
                  className={`w-12 h-12 rounded-2xl text-[10px] font-bold flex flex-col items-center justify-center border ${crouchUi ? 'bg-amber-600 text-stone-950' : 'bg-stone-900/90 text-amber-300 border-amber-700/60'}`}><Footprints className="w-4 h-4" />Sneak</button>
                <button onClick={() => (engine.input.jumpPulse = true)} className="w-12 h-12 rounded-2xl bg-stone-900/90 text-amber-300 border border-amber-700/60 text-[10px] font-bold flex flex-col items-center justify-center"><ArrowUpCircle className="w-4 h-4" />Jump</button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { const v = !mobileAim; setMobileAim(v); engine.input.aimToggle = v; }}
                  className={`w-14 h-14 rounded-2xl font-bold text-xs flex flex-col items-center justify-center border ${mobileAim ? 'bg-amber-600 text-stone-950 border-amber-300' : 'bg-stone-900/90 text-amber-400 border-amber-700/60'}`}><Crosshair className="w-5 h-5" />Aim</button>
                <button onClick={() => (engine.input.shootPulse = true)} className="w-16 h-16 rounded-2xl bg-amber-600 active:bg-amber-500 text-stone-950 font-bold text-xs flex flex-col items-center justify-center border border-amber-400"><Crosshair className="w-6 h-6" />Shoot</button>
              </div>
              <button onClick={() => (engine.input.interactPulse = true)} className="w-32 h-12 rounded-2xl bg-emerald-700 active:bg-emerald-600 text-white font-bold text-xs flex items-center justify-center gap-2 border border-emerald-400"><Trees className="w-4 h-4" />Gather / Talk</button>
            </div>
          </div>
        )}
      </div>

      {/* Specialist dialogue */}
      {activeDialogue && (() => {
        const cost = RECRUIT_COST[activeDialogue.id] ?? {};
        const recruited = specialists.find((s) => s.id === activeDialogue.id)?.recruited;
        return (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 pointer-events-auto">
            <div className="bg-stone-900/95 border-2 border-amber-700/80 rounded-2xl max-w-lg w-full p-6 shadow-2xl text-stone-100 flex flex-col gap-4">
              <div className="flex justify-between items-start border-b border-stone-800 pb-3">
                <div>
                  <h3 className="text-xl font-bold text-amber-400">{activeDialogue.name}</h3>
                  <span className="text-xs text-emerald-400 tracking-wide uppercase">{activeDialogue.title}</span>
                </div>
                <button onClick={() => setActiveDialogue(null)} className="text-stone-400 hover:text-white text-lg font-bold p-1">✕</button>
              </div>
              <p className="text-stone-200 italic text-sm leading-relaxed bg-stone-950/50 p-4 rounded-xl border border-stone-800">"{activeDialogue.dialogue}"</p>
              <div className="bg-amber-950/40 p-3 rounded-xl border border-amber-900/50 text-xs text-amber-200/90"><strong className="text-amber-400">Benefit:</strong> {activeDialogue.unlockedBonus}</div>
              {!recruited && Object.keys(cost).length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {Object.entries(cost).map(([k, v]) => {
                    const haveN = inventory[k]?.count ?? 0;
                    return <span key={k} className={`px-2 py-1 rounded-lg border ${haveN >= v ? 'border-emerald-600 text-emerald-300' : 'border-red-700 text-red-300'}`}>{ITEM_DEFS[k]?.icon} {haveN}/{v} {ITEM_LABEL[k]}</span>;
                  })}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setActiveDialogue(null)} className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-bold">Farewell</button>
                {!recruited && (
                  <button onClick={() => recruitSpecialist(activeDialogue)} className={`px-5 py-2 rounded-xl text-xs font-bold shadow-lg ${has(cost) ? 'bg-amber-600 hover:bg-amber-500 text-stone-950' : 'bg-stone-700 text-stone-300'}`}>
                    {has(cost) ? 'Recruit to the village' : 'Recruit (need more)'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tabs */}
      {activeTab && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 pointer-events-auto">
          <div className="bg-stone-900/95 border-2 border-stone-700 rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl text-stone-100 overflow-hidden">
            <div className="flex border-b border-stone-800 bg-stone-950/90 p-2 gap-2">
              {([['inventory', 'Pouch [Tab]'], ['quests', 'Journal [J]'], ['buildings', 'Build [B]'], ['map', 'Map [M]']] as const).map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-2 rounded-xl text-xs font-bold ${activeTab === tab ? 'bg-amber-600 text-stone-950' : 'bg-stone-900 text-stone-400'}`}>{label}</button>
              ))}
              <button onClick={() => setActiveTab(null)} className="px-3 rounded-xl bg-stone-800 text-stone-400 hover:text-white">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'inventory' && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between bg-stone-950/70 p-3 rounded-xl border border-stone-800 gap-2">
                    <span className="text-xs text-stone-300 font-bold">Fletching</span>
                    <div className="flex gap-2">
                      <button onClick={() => craftArrows('quick')} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-stone-950 rounded-lg text-xs font-bold">+10 arrows (1 timber)</button>
                      <button onClick={() => craftArrows('bundle')} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold">+25 arrows (2 timber, 1 fibre)</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.values(inventory).map((item) => (
                      <div key={item.id} className={`bg-stone-950/80 p-3 rounded-xl border flex flex-col justify-between ${item.count ? 'border-stone-700' : 'border-stone-800 opacity-60'}`}>
                        <div className="flex items-start justify-between">
                          <span className="text-2xl">{item.icon}</span>
                          <span className="bg-amber-950/60 border border-amber-700/50 text-amber-400 text-xs px-2 py-0.5 rounded-full font-bold">×{item.count}</span>
                        </div>
                        <div className="mt-2">
                          <div className="font-bold text-xs text-stone-200">{item.name}</div>
                          <div className="text-[10px] text-stone-400 leading-tight mt-0.5">{item.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'quests' && (
                <div className="flex flex-col gap-3">
                  {quests.map((q) => (
                    <div key={q.id} className={`p-4 rounded-xl border flex flex-col gap-2 ${q.completed ? 'bg-emerald-950/30 border-emerald-800/50' : q === activeQuest ? 'bg-amber-950/30 border-amber-700/60' : 'bg-stone-950/80 border-stone-800 opacity-70'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-bold text-sm text-amber-400">{q.title}</h4>
                          <span className="text-[10px] text-stone-400">From: {q.giver}</span>
                        </div>
                        <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${q.completed ? 'bg-emerald-900/60 text-emerald-300' : 'bg-amber-900/60 text-amber-300'}`}>
                          {q.completed ? 'Done' : `${q.currentProgress}/${q.targetProgress}`}
                        </span>
                      </div>
                      <p className="text-xs text-stone-300 italic">{q.description}</p>
                      <div className="text-[11px] text-stone-400"><strong className="text-stone-300">Objective:</strong> {q.objective}</div>
                      {q === activeQuest && engine.questTarget && <div className="text-[11px] text-amber-300">Next: {engine.questTarget.label} — follow the gold ◆ on your compass.</div>}
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'buildings' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {buildings.filter((b) => b.type !== 'campfire').map((b) => {
                    const prod = PRODUCTION[b.id];
                    const canAfford = has(b.cost);
                    const up = upgradeCost(b);
                    return (
                      <div key={b.id} className="bg-stone-950/80 p-4 rounded-xl border border-stone-800 flex flex-col justify-between gap-3">
                        <div>
                          <div className="flex justify-between items-start">
                            <h4 className="font-bold text-sm text-amber-400">{b.name}</h4>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${b.built ? 'bg-emerald-900 text-emerald-300' : 'bg-stone-800 text-stone-400'}`}>{b.built ? `Level ${b.level}` : 'Not built'}</span>
                          </div>
                          <p className="text-[11px] text-stone-400 mt-1">{b.description}</p>
                          {prod && <p className="text-[11px] text-emerald-300 mt-1">Produces {prod.label}{b.level > 1 ? ` ×${b.level}` : ''}</p>}
                          {!b.built && (
                            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                              {Object.entries(b.cost).map(([k, v]) => (
                                <span key={k} className={`px-1.5 py-0.5 rounded border ${(inventory[k]?.count ?? 0) >= v ? 'border-emerald-700 text-emerald-300' : 'border-red-800 text-red-300'}`}>{inventory[k]?.count ?? 0}/{v} {ITEM_LABEL[k]}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              if (!b.built && !canAfford) { notify(`Still need ${shortfall(b.cost)} for the ${b.name}.`); gameAudio.playCrispClick(); return; }
                              setSelectedBuildingToPlace(b.id);
                              setActiveTab(null);
                              gameAudio.playCrispClick();
                            }}
                            className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 ${b.built ? 'bg-stone-800 hover:bg-stone-700 text-amber-400 border border-amber-600/40' : canAfford ? 'bg-amber-600 hover:bg-amber-500 text-stone-950' : 'bg-stone-800 text-stone-500'}`}>
                            {b.built ? <><Move className="w-3.5 h-3.5" /> Move</> : 'Place blueprint'}
                          </button>
                          {b.built && prod && b.level < b.maxLevel && (
                            <button onClick={() => upgradeBuilding(b)} title={Object.entries(up).map(([k, v]) => `${v} ${ITEM_LABEL[k]}`).join(', ')}
                              className={`flex-1 py-2 rounded-xl text-xs font-bold ${has(up) ? 'bg-emerald-700 hover:bg-emerald-600 text-white' : 'bg-stone-800 text-stone-500'}`}>
                              Upgrade ({Object.entries(up).map(([k, v]) => `${v} ${ITEM_LABEL[k]}`).join(', ')})
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeTab === 'map' && <WorldMap />}
            </div>
          </div>
        </div>
      )}

      {/* Menu */}
      {isGameMenuOpen && (
        <MenuOverlay tone="neutral" zIndex={50}>
          <div className="w-full max-w-md flex flex-col items-center bg-stone-900 border-2 border-stone-700 rounded-2xl p-6 m-4 shadow-2xl text-stone-100">
            <h2 className="text-3xl font-black mb-6 text-amber-400 text-center tracking-wide">PAUSED</h2>
            <div className="w-full flex flex-col gap-3">
              <button onClick={() => { gameAudio.playCrispClick(); setIsGameMenuOpen(false); }} autoFocus className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold rounded-xl text-base shadow-lg">Resume</button>
              <button onClick={() => setIsHowToPlayOpen(true)} className="w-full py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold rounded-xl text-sm border border-stone-700 flex items-center justify-center gap-2"><HelpCircle className="w-4 h-4" />How to Play</button>
              <div className="flex gap-2 mt-2">
                <button onClick={() => setIsMusicMuted((m) => !m)} className="flex-1 py-2 bg-stone-800 hover:bg-stone-700 rounded-xl text-xs font-bold border border-stone-700 flex items-center justify-center gap-2">
                  {isMusicMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}Music: {isMusicMuted ? 'Off' : 'On'}
                </button>
                <button onClick={() => setIsSfxMuted(gameAudio.toggleMute())} className="flex-1 py-2 bg-stone-800 hover:bg-stone-700 rounded-xl text-xs font-bold border border-stone-700 flex items-center justify-center gap-2">
                  {isSfxMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}SFX: {isSfxMuted ? 'Off' : 'On'}
                </button>
              </div>
              <button onClick={() => { gameAudio.playCrispClick(); initGame(); }} className="w-full py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-200 font-bold rounded-xl text-sm border border-stone-700 flex items-center justify-center gap-2"><RotateCw className="w-4 h-4" />Restart</button>
              <button onClick={() => { setIsGameMenuOpen(false); setGameState((p) => ({ ...p, status: 'START' })); }} className="w-full py-2.5 bg-red-900/60 hover:bg-red-800 text-red-200 font-bold rounded-xl text-sm border border-red-700 mt-2 flex items-center justify-center gap-2"><Home className="w-4 h-4" />Quit to Title</button>
            </div>
          </div>
        </MenuOverlay>
      )}

      {isHowToPlayOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4">
          <div className="bg-stone-900 border-2 border-stone-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl text-stone-100 flex flex-col gap-3">
            <h3 className="text-2xl font-black text-amber-400">HOW TO PLAY</h3>
            <div className="text-xs text-stone-300 flex flex-col gap-2 leading-relaxed">
              <p><strong>Move:</strong> WASD · Shift sprint (loud) · C crouch (quiet) · Space jump. Click the view to capture the mouse, Esc to release.</p>
              <p><strong>Bow:</strong> hold left mouse to draw — the ring fills, green means full power — release to shoot. Hold right mouse to aim. Headshots deal double damage.</p>
              <p><strong>Finding things:</strong> the compass shows your gold objective plus the nearest timber, slate, nettle and herbs with distances. The radar (bottom left) shows everything within 70 m. Floating icons mark resources up close.</p>
              <p><strong>Gather:</strong> walk up and press E. Each node gives several harvests and regrows later.</p>
              <p><strong>Build:</strong> B opens blueprints. The preview turns green where you can build. Built workshops produce materials for you, and can be upgraded.</p>
              <p><strong>Shortcuts:</strong> Tab pouch · J journal · B build · M map · E gather / talk.</p>
            </div>
            <button onClick={() => setIsHowToPlayOpen(false)} className="mt-2 w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-stone-950 font-bold rounded-xl text-sm">Close</button>
          </div>
        </div>
      )}

      {status === 'START' && (
        <MenuOverlay tone="neutral">
          <div className="bg-stone-900/95 border-2 border-amber-700/80 p-8 rounded-2xl shadow-2xl flex flex-col items-center w-full max-w-md">
            <div className="w-16 h-16 rounded-full bg-amber-950/80 border-2 border-amber-500 flex items-center justify-center text-3xl mb-4 shadow-lg">🏔️</div>
            <h1 className="text-3xl sm:text-4xl font-black mb-3 text-amber-400 text-center tracking-wider uppercase">{getConfig('title') ?? 'Himalayan Wilds'}</h1>
            <p className="text-stone-300 text-center text-xs leading-relaxed mb-6">
              Hunt with a yew bow, gather timber, slate and herbs, recruit four specialists from their camps across the valley, and grow a struggling camp into a thriving Kath-Kuni village.
            </p>
            <button ref={startButtonRef} autoFocus onClick={initGame} className="w-full bg-amber-600 hover:bg-amber-500 text-stone-950 px-6 py-3 rounded-xl font-bold text-base shadow-xl flex items-center justify-center gap-2 active:scale-95">
              <Play className="w-5 h-5 fill-current" />BEGIN
            </button>
            <button onClick={() => setIsHowToPlayOpen(true)} className="mt-3 text-xs text-stone-400 hover:text-amber-300 underline">How to play</button>
          </div>
        </MenuOverlay>
      )}

      {status === 'VICTORY' && (
        <Overlay
          title="MOUNTAIN HAVEN RESTORED"
          description={`All 8 chapters complete! Final renown: ${gameState.score}. Keep exploring the valley.`}
          actionLabel="CONTINUE"
          onAction={() => setGameState((p) => ({ ...p, status: 'PLAYING' }))}
          icon={<RotateCw className="w-5 h-5" />}
          tone="victory"
        />
      )}
    </div>
  );
}
