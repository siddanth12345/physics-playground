export const MAG = 40;
export const FIRE_INTERVAL = 5 / 24; // 24 splinters in 5s
export const DMG = 5;
export const PARRY_WINDOW = 1;
export const PARRY_CD = 5;
export const BUFF_TIME = 6;
export const DASH_CD = 2;
export const AIR_JUMPS = 2; // + 1 from the ground = 3
export const AIR_DASHES = 4;
export const BOMB_CD = 3;
export const BOMB_CD_BUFF = 2;
export const TABLE_HP = 10;
export const TABLE_CAP = 30;
export const BOSS_HITS = 200;
export const BOSS_WARN = 10;
export const PARRY_LOCK_AT = 5; // seconds into the boss fight

export type Phase = "home" | "playing" | "won" | "lost";
export type Stage = "tables" | "incoming" | "boss";
export type Mode = "game" | "tutorial";

export const TUT_STEPS: { title: string; text: string; enter?: boolean }[] = [
  { title: "You are the GREEN table", text: "Welcome to Table Wars! You are the green table. Press ENTER to continue.", enter: true },
  { title: "Move", text: "Use W A S D to walk around and the mouse to look." },
  { title: "Jump", text: "Press SPACE to jump — then press SPACE twice more in the air (triple jump)." },
  { title: "Wallrun", text: "Jump next to a wall or furniture and HOLD SPACE to run along it." },
  { title: "Dash", text: "Press Q to dash (works in the air too)." },
  { title: "Grapple", text: "Look at a wall or furniture and HOLD C to swing on a rope." },
  { title: "Scope", text: "HOLD RIGHT CLICK to scope in, then SCROLL the mouse wheel to change zoom." },
  { title: "Brown tables", text: "Brown tables are the normal enemies — they hop around and shoot splinters. LEFT CLICK to shoot this one. R reloads." },
  { title: "Bombs", text: "Press F to throw a bomb. It explodes in a big area. Blow this table up!" },
  { title: "Parry", text: "This table shoots back! Press E right before a bullet hits you to PARRY it — you get a power boost (infinite ammo, 2x damage)." },
  { title: "Blue tables", text: "Blue tables are fast chasers. They rush at you and explode on contact. Shoot them before they reach you!" },
  { title: "The Boss", text: "After you clear every table, the huge RED boss drops from the ceiling (stay out of the red circle!). He shoots, drops swords that stun you, throws plates, sends shockwaves you must JUMP over, and summons minions. 5 seconds in, your parry gets COMPROMISED. Press ENTER to finish.", enter: true },
];

export const G = {
  phase: "home" as Phase,
  mode: "game" as Mode,
  stage: "tables" as Stage,
  locked: false,
  playerHp: 100,
  ammo: MAG,
  reloading: 0,
  parryWin: 0,
  parryCd: 0,
  buff: 0,
  dashCd: 0,
  bombCd: 0,
  airJumps: AIR_JUMPS,
  airDashes: AIR_DASHES,
  wallrun: false,
  grappling: false,
  speed: 0,
  scoped: false,
  zoomFov: 28,
  firing: false,
  hitFlash: 0,
  hurtFlash: 0,
  parryFlash: 0,
  redFlash: 0,
  shake: 0,
  alive: 1,
  bluesAlive: 0,
  kills: 0,
  capReached: false,
  bossWarn: 0,
  bossHits: 0,
  bossTime: 0,
  parryLocked: false,
  compromisedT: 0,
  stun: 0,
  bombBig: 0,
  countdown: 0,
  shots: 0,
  hits: 0,
  parries: 0,
  time: 0,
  resetToken: 0,
  respawnToken: 0,
  respawnMsg: 0,
  tutStep: 0,
  tut: { enter: false, dashed: false, zoomed: false, bombed: false },
};

export function resetGame(mode: Mode = G.mode) {
  Object.assign(G, {
    mode, stage: "tables", playerHp: 100, ammo: MAG, reloading: 0, parryWin: 0, parryCd: 0, buff: 0,
    dashCd: 0, bombCd: 0, airJumps: AIR_JUMPS, airDashes: AIR_DASHES, wallrun: false, grappling: false,
    hitFlash: 0, hurtFlash: 0, parryFlash: 0, redFlash: 0, shake: 0, alive: 1, bluesAlive: 0, kills: 0, capReached: false,
    bossWarn: 0, bossHits: 0, bossTime: 0, parryLocked: false, compromisedT: 0, stun: 0, bombBig: 0, countdown: 0,
    shots: 0, hits: 0, parries: 0, time: 0, firing: false, scoped: false, respawnMsg: 0, tutStep: 0,
    tut: { enter: false, dashed: false, zoomed: false, bombed: false },
  });
  G.resetToken++;
  G.phase = "playing";
}

export function goHome() {
  resetGame("game");
  G.phase = "home";
  document.exitPointerLock?.();
}

export function finishTutorial() {
  try { localStorage.setItem("tw-tutorial-done", "1"); } catch { /* ignore */ }
  goHome();
}

// Pointer lock is requested directly from button clicks so Resume/Restart always work.
let lockFn: (() => void) | null = null;
export function setLocker(fn: (() => void) | null) {
  lockFn = fn;
}
export function lockPointer() {
  try {
    lockFn?.();
  } catch {
    /* browser may refuse right after Esc; user can click again */
  }
}

// Minimap snapshot, written by World each frame, read by the HUD.
export const MAP = { px: 0, pz: 0, yaw: 0, boss: null as null | { x: number; z: number }, tables: [] as number[], blues: [] as number[], health: [] as number[] };
