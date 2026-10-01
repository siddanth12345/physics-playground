import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, type ElementRef } from "react";
import * as THREE from "three";
import {
  G, MAG, FIRE_INTERVAL, DMG, PARRY_WINDOW, PARRY_CD, BUFF_TIME, DASH_CD, AIR_JUMPS, AIR_DASHES,
  BOMB_CD, BOMB_CD_BUFF, TABLE_HP, TABLE_CAP, BOSS_HITS, BOSS_WARN, setLocker,
  MAP, PARRY_LOCK_AT, TUT_STEPS, finishTutorial,
} from "./state";
import { Room, ROOM, SOLIDS } from "./Room";
import { tableWood } from "./textures";

// --- feel constants ---
const SPEED = 44;
const DASH_SPEED = 90;
const MAX_HSPEED = 400;
const AIR_ACCEL = 60;
const GRAVITY = 60;
const JUMP_V = 28;
const EYE = 3.2;
const BODY_H = 3.6;
const PLAYER_R = 0.8;
const STEP = 0.6;
const WALL_EPS = 0.5;
const BULLET_SPEED = 90 * 50;
const BOT_BULLET_SPEED = 45 * 10;
const BOT_BULLET_HALF = 0.35;
const TABLE_S = 1.5;
const TABLE_W = 6 * TABLE_S;
const BOMB_R = TABLE_W * 12;
const AOE_R = TABLE_W * 6;
const BOMB_DMG = 20;
const GRAPPLE_MAX = ROOM.r / 4;
const GRAPPLE_K = 45;
const BOSS_S = 12;
const BOSS_ZONE = 60;
const BLUE_N = 48;
const BLUE_SPEED = 90;
const BLUE_DASH = 240;
const BLUE_CLEAR_N = 20;
const BLUE_HP = 10;
const BOSS_BULLET_DMG = 20;
const BIG_DMG = 50;
const AOE_DMG = 30;
const SWORD_R = 15;
const STUN_TIME = 1;
const BOMB_BIG_TIME = 5;
const SUMMON_HP = 5;
const PLATE_R = BOSS_S * 3;
const PLATE_HIT_R = PLATE_R * 2;
const PLATE_DMG = 25;
const PLATE_SPEED = 190;
const WAVE_H = 0.5 * 3.45 * TABLE_S; // half a table tall
const WAVE_SPEED = 140;
const WAVE_DMG = 20;
const HEALTH_AMOUNT = 30;
const HEALTH_INTERVAL = 10;
const HEALTH_R = 7;
const R = ROOM.r;
const UP = new THREE.Vector3(0, 1, 0);

type Bullet = { pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; life: number; alive: boolean; dmg: number };
type Table = {
  alive: boolean; pos: THREE.Vector3; vy: number; hp: number; target: THREE.Vector3; shootT: number;
  jumpT: number; jumpsLeft: number; dashT: number; dash: THREE.Vector3; bob: number; s: number; yaw: number; summoned: boolean; passive: boolean;
};
type Splinter = { pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; life: number; size: number };
type Hazard = { active: boolean; kind: "quarter" | "sword" | "stomp" | "aoe"; t: number; total: number; fx: number; x: number; z: number; a0: number };

const bulletPool = (n: number): Bullet[] =>
  Array.from({ length: n }, () => ({ pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, alive: false, dmg: DMG }));

function spawnBullet(pool: Bullet[], pos: THREE.Vector3, vel: THREE.Vector3, dmg: number, life: number) {
  const b = pool.find((x) => !x.alive);
  if (!b) return;
  b.pos.copy(pos);
  b.prev.copy(pos);
  b.vel.copy(vel);
  b.life = life;
  b.dmg = dmg;
  b.alive = true;
}

// ---------- geometry helpers ----------
function segAABB(a: THREE.Vector3, b: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3) {
  let t0 = 0, t1 = 1;
  for (const ax of ["x", "y", "z"] as const) {
    const d = b[ax] - a[ax];
    if (Math.abs(d) < 1e-9) {
      if (a[ax] < min[ax] || a[ax] > max[ax]) return Infinity;
    } else {
      let ta = (min[ax] - a[ax]) / d, tb = (max[ax] - a[ax]) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}
const _ab = new THREE.Vector3(), _cp = new THREE.Vector3();
function segSphere(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number) {
  _ab.subVectors(b, a);
  const l2 = _ab.lengthSq();
  const t = l2 > 0 ? THREE.MathUtils.clamp(_cp.subVectors(c, a).dot(_ab) / l2, 0, 1) : 0;
  _cp.copy(a).addScaledVector(_ab, t);
  return _cp.distanceTo(c) < r ? t : Infinity;
}
const _mn = new THREE.Vector3(), _mx = new THREE.Vector3();
function segSolids(a: THREE.Vector3, b: THREE.Vector3) {
  let best = Infinity;
  for (const s of SOLIDS) {
    _mn.set(s.x - s.hw, s.y0, s.z - s.hd);
    _mx.set(s.x + s.hw, s.y1, s.z + s.hd);
    best = Math.min(best, segAABB(a, b, _mn, _mx));
  }
  return best;
}
const overlapXZ = (p: THREE.Vector3, s: (typeof SOLIDS)[number], r: number) =>
  Math.abs(p.x - s.x) < s.hw + r && Math.abs(p.z - s.z) < s.hd + r;

function clampCircle(p: THREE.Vector3, r: number) {
  const d = Math.hypot(p.x, p.z), m = R - r;
  if (d > m) {
    p.x *= m / d;
    p.z *= m / d;
  }
}
function pushOut(p: THREE.Vector3, s: (typeof SOLIDS)[number], r: number) {
  const dx = p.x - s.x, dz = p.z - s.z;
  const ox = s.hw + r - Math.abs(dx), oz = s.hd + r - Math.abs(dz);
  if (ox > 0 && oz > 0) {
    if (ox < oz) p.x += (Math.sign(dx) || 1) * ox;
    else p.z += (Math.sign(dz) || 1) * oz;
  }
}
function wallNormal(p: THREE.Vector3): THREE.Vector3 | null {
  const d = Math.hypot(p.x, p.z);
  if (d >= R - PLAYER_R - WALL_EPS) return new THREE.Vector3(-p.x / d, 0, -p.z / d);
  for (const s of SOLIDS) {
    if (p.y >= s.y1 - STEP || p.y + BODY_H <= s.y0) continue;
    const dx = p.x - s.x, dz = p.z - s.z;
    const ox = s.hw + PLAYER_R + WALL_EPS - Math.abs(dx), oz = s.hd + PLAYER_R + WALL_EPS - Math.abs(dz);
    if (ox > 0 && oz > 0) return ox < oz ? new THREE.Vector3(Math.sign(dx) || 1, 0, 0) : new THREE.Vector3(0, 0, Math.sign(dz) || 1);
  }
  return null;
}
function inSolid(p: THREE.Vector3) {
  return SOLIDS.some((s) => p.y > s.y0 && p.y < s.y1 && Math.abs(p.x - s.x) < s.hw && Math.abs(p.z - s.z) < s.hd);
}
function randomFloor(avoid: THREE.Vector3) {
  const v = new THREE.Vector3();
  for (let i = 0; i < 40; i++) {
    const rr = Math.sqrt(Math.random()) * (R - 40), a = Math.random() * Math.PI * 2;
    v.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    if (v.distanceTo(avoid) < 70) continue;
    if (SOLIDS.some((s) => s.y0 < 5 && overlapXZ(v, s, 10))) continue;
    return v;
  }
  return v;
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// table part local matrices (unit table scale)
const mk = (p: [number, number, number], s: [number, number, number]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(...s));
const TOP_M = mk([0, 3.2, 0], [1, 1, 1]);
const LEG_M = ([[-2.4, -1.5], [2.4, -1.5], [-2.4, 1.5], [2.4, 1.5]] as const).map(([x, z]) => mk([x, 1.5, z], [1, 1, 1]));
const EYE_M = [-1, 1].map((x) => mk([x, 3.2, 2.02], [1, 1, 1]));

const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const zAxis = new THREE.Vector3(0, 0, 1);
const START = new THREE.Vector3(0, 0, 120);
const BOT_START = new THREE.Vector3(0, 0, -100);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

function newTable(): Table {
  return {
    alive: false, pos: new THREE.Vector3(), vy: 0, hp: TABLE_HP, target: new THREE.Vector3(), shootT: 1,
    jumpT: 2, jumpsLeft: 0, dashT: 3, dash: new THREE.Vector3(), bob: 0, s: TABLE_S, yaw: 0, summoned: false, passive: false,
  };
}

export function World() {
  const { camera } = useThree();
  const ctrl = useRef<ElementRef<typeof PointerLockControls>>(null);
  const staticRef = useRef<THREE.Group>(null);
  const keys = useRef<Record<string, boolean>>({});
  const pos = useRef(START.clone());
  const hv = useRef(new THREE.Vector3());
  const vy = useRef(0);
  const grounded = useRef(true);
  const fireT = useRef(0);
  const lastYaw = useRef(0);
  const pendingYaw = useRef(0);
  const anchor = useRef(new THREE.Vector3());
  const ropeLen = useRef(0);
  const lastReset = useRef(-1);
  const recentPos = useRef<{ t: number; p: THREE.Vector3 }[]>([]);

  const playerPool = useMemo(() => bulletPool(128), []);
  const botPool = useMemo(() => bulletPool(320), []);
  const tables = useMemo(() => Array.from({ length: TABLE_CAP }, newTable), []);
  const splinters = useMemo<Splinter[]>(() => [], []);
  const bomb = useRef({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
  const booms = useMemo(() => Array.from({ length: 4 }, () => ({ t: 0, pos: new THREE.Vector3(), r: BOMB_R })), []);
  const hazards = useMemo<Hazard[]>(() => Array.from({ length: 8 }, () => ({ active: false, kind: "aoe", t: 0, total: 1, fx: 0, x: 0, z: 0, a0: 0 })), []);
  const blues = useMemo(() => Array.from({ length: BLUE_N }, () => ({ alive: false, pos: new THREE.Vector3(), dash: new THREE.Vector3(), hp: BLUE_HP, hitCd: 0, dashT: 8, yaw: 0 })), []);
  const blueT = useRef(6);
  const summonT = useRef(10);
  const healthT = useRef(HEALTH_INTERVAL);
  const health = useMemo(() => Array.from({ length: 16 }, () => ({ active: false, pos: new THREE.Vector3() })), []);
  const healthRefs = useRef<(THREE.Group | null)[]>([]);
  const blueTop = useRef<THREE.InstancedMesh>(null);
  const blueLeg = useRef<THREE.InstancedMesh>(null);
  const boss = useRef({ landed: false, y: ROOM.h, vy: 0, pos: new THREE.Vector3(), bulletT: 1, specialT: 2, next: "sword" as "sword" | "stomp", quarterT: 3, aoeT: 5, yaw: 0 });
  const plate = useRef({ alive: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3() });
  const waves = useMemo(() => Array.from({ length: 6 }, () => ({ active: false, r: 0, x: 0, z: 0, hit: false })), []);
  const waveRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lastRespawn = useRef(0);
  const tutSetup = useRef(-1);
  const tutDist = useRef(0);
  const tutKills = useRef(0);

  const topI = useRef<THREE.InstancedMesh>(null);
  const legI = useRef<THREE.InstancedMesh>(null);
  const eyeI = useRef<THREE.InstancedMesh>(null);
  const pInst = useRef<THREE.InstancedMesh>(null);
  const bInst = useRef<THREE.InstancedMesh>(null);
  const splI = useRef<THREE.InstancedMesh>(null);
  const bombMesh = useRef<THREE.Mesh>(null);
  const plateRef = useRef<THREE.Mesh>(null);
  const boomRefs = useRef<(THREE.Mesh | null)[]>([]);
  const hazRefs = useRef<({ disc: THREE.Mesh | null; sector: THREE.Mesh | null; sword: THREE.Group | null })[]>(
    Array.from({ length: 8 }, () => ({ disc: null, sector: null, sword: null })),
  );
  const bossRef = useRef<THREE.Group>(null);
  const zoneRef = useRef<THREE.Mesh>(null);
  const ropeRef = useRef<THREE.Mesh>(null);
  const parryMesh = useRef<THREE.Mesh>(null);
  const wood = useMemo(tableWood, []);

  const aliveCount = () => tables.reduce((n, t) => n + (t.alive ? 1 : 0), 0);
  const spawnTable = (at?: THREE.Vector3, summoned = false) => {
    const t = tables.find((x) => !x.alive);
    if (!t) return null;
    Object.assign(t, newTable());
    t.alive = true;
    t.summoned = summoned;
    if (summoned) t.hp = SUMMON_HP;
    t.pos.copy(at ?? randomFloor(pos.current));
    t.target.copy(randomFloor(t.pos));
    t.shootT = 1 + Math.random();
    return t;
  };
  const spawnBlue = (at: THREE.Vector3) => {
    const u = blues.find((x) => !x.alive);
    if (!u) return;
    Object.assign(u, { alive: true, hp: BLUE_HP, hitCd: 0, dashT: 6 + Math.random() * 8 });
    u.pos.copy(at).setY(0);
    clampCircle(u.pos, 3 * TABLE_S);
    u.dash.set(0, 0, 0);
  };
  const addWave = (x: number, z: number) => {
    const w = waves.find((q) => !q.active) ?? waves[0]!;
    Object.assign(w, { active: true, r: BOSS_S * 3, x, z, hit: false });
  };
  const damagePlayer = (d: number, force = false) => {
    if (!force && G.buff > 0) return;
    G.playerHp = Math.max(0, G.playerHp - d);
    G.hurtFlash = 0.25;
    if (G.playerHp <= 0) {
      if (G.mode === "tutorial") {
        G.playerHp = 100;
        return;
      }
      if (G.stage !== "tables") {
        // checkpoint: back to the boss warning, parry stays compromised
        Object.assign(G, { playerHp: 100, stage: "incoming", bossWarn: BOSS_WARN, bossHits: 0, bossTime: 0, respawnMsg: 2.5, stun: 0 });
        G.respawnToken++;
        return;
      }
      G.phase = "lost";
      document.exitPointerLock?.();
    }
  };
  const burst = (at: THREE.Vector3, s: number, n: number) => {
    for (let i = 0; i < n; i++) {
      if (splinters.length > 200) splinters.shift();
      const a = Math.random() * Math.PI * 2;
      splinters.push({
        pos: at.clone(),
        vel: new THREE.Vector3(Math.cos(a) * (10 + Math.random() * 25), 15 + Math.random() * 30, Math.sin(a) * (10 + Math.random() * 25)),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5),
        life: 3,
        size: s,
      });
    }
  };
  const hitTable = (t: Table, dmg: number) => {
    if (!t.alive) return;
    t.hp -= dmg;
    G.hitFlash = 0.15;
    if (t.hp > 0) return;
    t.alive = false;
    G.kills++;
    burst(tmpV.copy(t.pos).setY(t.pos.y + 3 * t.s), t.s, 7);
    if (G.mode === "game" && !G.capReached && G.stage === "tables") {
      for (let i = 0; i < 2; i++) if (aliveCount() < TABLE_CAP) spawnTable();
      if (aliveCount() >= TABLE_CAP) {
        G.capReached = true;
        for (let i = 0; i < BLUE_CLEAR_N; i++) spawnBlue(randomFloor(pos.current));
      }
    }
  };
  const hitBoss = (n: number) => {
    if (G.stage !== "boss" || !boss.current.landed) return;
    G.bossHits = Math.min(BOSS_HITS, G.bossHits + n);
    G.hitFlash = 0.15;
    if (G.bossHits >= BOSS_HITS) {
      burst(tmpV.copy(boss.current.pos).setY(15), BOSS_S / 2, 30);
      G.phase = "won";
      document.exitPointerLock?.();
    }
  };
  const bossBox = (min: THREE.Vector3, max: THREE.Vector3) => {
    const b = boss.current;
    min.set(b.pos.x - 3 * BOSS_S, b.y, b.pos.z - 3 * BOSS_S);
    max.set(b.pos.x + 3 * BOSS_S, b.y + 3.5 * BOSS_S, b.pos.z + 3 * BOSS_S);
  };
  const bossLive = () => G.stage === "boss";
  const explode = (at: THREE.Vector3) => {
    const buffed = G.buff > 0;
    const br = BOMB_R * (G.bombBig > 0 ? 1.5 : 1);
    G.tut.bombed = true;
    for (const t of tables) if (t.alive && t.pos.distanceTo(at) < br) hitTable(t, BOMB_DMG * (buffed ? 2 : 1));
    for (const u of blues) if (u.alive && u.pos.distanceTo(at) < br) { u.alive = false; burst(tmpV.copy(u.pos).setY(4), TABLE_S, 5); }
    if (bossLive() && tmpV.set(boss.current.pos.x, boss.current.y + 10, boss.current.pos.z).distanceTo(at) < br + 30)
      hitBoss((BOMB_DMG / DMG) * (buffed ? 2 : 1));
    const bm = booms.find((x) => x.t <= 0) ?? booms[0]!;
    bm.t = 0.5;
    bm.pos.copy(at);
    bm.r = br;
    G.shake = 0.6;
  };
  const addHazard = (kind: Hazard["kind"], x: number, z: number, t: number) => {
    const h = hazards.find((q) => !q.active);
    if (!h) return;
    Object.assign(h, { active: true, kind, t, total: t, fx: 0, x, z, a0: Math.floor(Math.random() * 4) * (Math.PI / 2) });
  };

  useEffect(() => {
    setLocker(() => ctrl.current?.lock());
    const onLock = () => {
      G.locked = !!document.pointerLockElement;
      if (!G.locked) {
        G.firing = false;
        G.scoped = false;
        keys.current = {};
      }
    };
    document.addEventListener("pointerlockchange", onLock);
    const camDirs = () => {
      const f = new THREE.Vector3();
      camera.getWorldDirection(f);
      f.y = 0;
      f.normalize();
      return { f, r: new THREE.Vector3(-f.z, 0, f.x) };
    };
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space") e.preventDefault();
      const wasDown = keys.current[e.code];
      keys.current[e.code] = true;
      if (G.phase !== "playing" || !G.locked || wasDown || e.repeat) return;
      if (e.code === "Enter") G.tut.enter = true;
      if (G.countdown > 0.6 || G.stun > 0) return;
      if (e.code === "KeyE" && G.parryCd <= 0 && !G.parryLocked) {
        G.parryWin = PARRY_WINDOW;
        G.parryCd = PARRY_CD;
      }
      if (e.code === "Space" && !grounded.current && !G.wallrun && !wallNormal(pos.current) && G.airJumps > 0) {
        G.airJumps--;
        vy.current = JUMP_V;
      }
      if (e.code === "KeyQ" && !G.wallrun) {
        const canDash = grounded.current ? G.dashCd <= 0 : G.airDashes > 0;
        if (canDash) {
          const { f, r } = camDirs();
          const d = new THREE.Vector3();
          if (keys.current["KeyW"]) d.add(f);
          if (keys.current["KeyS"]) d.sub(f);
          if (keys.current["KeyD"]) d.add(r);
          if (keys.current["KeyA"]) d.sub(r);
          if (d.lengthSq() === 0) d.copy(f);
          hv.current.addScaledVector(d.normalize(), DASH_SPEED);
          G.tut.dashed = true;
          if (hv.current.length() > MAX_HSPEED) hv.current.setLength(MAX_HSPEED);
          if (grounded.current) G.dashCd = DASH_CD;
          else {
            G.airDashes--;
            if (vy.current < 0) vy.current = 0;
          }
        }
      }
      if (e.code === "KeyF" && G.bombCd <= 0 && !bomb.current.alive) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        bomb.current.alive = true;
        bomb.current.pos.copy(camera.position).addScaledVector(dir, 1.5);
        bomb.current.vel.copy(dir).multiplyScalar(BULLET_SPEED);
        G.bombCd = G.buff > 0 ? BOMB_CD_BUFF : BOMB_CD;
      }
      if (e.code === "KeyC" && staticRef.current) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const rc = new THREE.Raycaster(camera.position.clone(), dir, 0.5, GRAPPLE_MAX);
        const hit = rc.intersectObject(staticRef.current, true)[0];
        if (hit) {
          anchor.current.copy(hit.point);
          ropeLen.current = hit.distance * 0.9;
          G.grappling = true;
        }
      }
      if (e.code === "KeyR" && G.buff <= 0 && G.ammo < MAG && G.reloading <= 0) G.reloading = 1.5;
    };
    const ku = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
      if (e.code === "KeyC") G.grappling = false;
      if (e.code === "Space") G.wallrun = false;
    };
    const md = (e: MouseEvent) => {
      if (!G.locked) return;
      if (e.button === 0) G.firing = true;
      if (e.button === 2) G.scoped = true;
    };
    const mu = (e: MouseEvent) => {
      if (e.button === 0) G.firing = false;
      if (e.button === 2) G.scoped = false;
    };
    const cm = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    window.addEventListener("contextmenu", cm);
    const wh = (e: WheelEvent) => {
      if (!G.locked || !G.scoped) return;
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      G.zoomFov = THREE.MathUtils.clamp(G.zoomFov * Math.exp(dy * 0.0015), 6, 60);
      G.tut.zoomed = true;
    };
    window.addEventListener("wheel", wh, { passive: false });
    return () => {
      setLocker(null);
      document.removeEventListener("pointerlockchange", onLock);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("contextmenu", cm);
      window.removeEventListener("wheel", wh);
    };
  }, [camera]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const cam = camera as THREE.PerspectiveCamera;
    const p = pos.current;
    const b = boss.current;

    const clearArena = () => {
      p.copy(START);
      hv.current.set(0, 0, 0);
      vy.current = 0;
      grounded.current = true;
      G.grappling = false;
      cam.position.set(p.x, EYE, p.z);
      cam.lookAt(0, EYE, -100);
      lastYaw.current = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ").y;
      pendingYaw.current = 0;
      playerPool.forEach((x) => (x.alive = false));
      botPool.forEach((x) => (x.alive = false));
      tables.forEach((t) => (t.alive = false));
      blues.forEach((u) => (u.alive = false));
      blueT.current = 6;
      summonT.current = 10;
      healthT.current = HEALTH_INTERVAL;
      health.forEach((h) => (h.active = false));
      MAP.health = [];
      hazards.forEach((h) => (h.active = false));
      waves.forEach((w) => (w.active = false));
      bomb.current.alive = false;
      plate.current.alive = false;
      Object.assign(b, { landed: false, y: ROOM.h, vy: 0, bulletT: 1, specialT: 2, next: "sword", quarterT: 3, aoeT: 5 });
      b.pos.set(0, 0, 0);
    };
    if (lastReset.current !== G.resetToken) {
      lastReset.current = G.resetToken;
      lastRespawn.current = G.respawnToken;
      tutSetup.current = -1;
      clearArena();
      splinters.length = 0;
      if (G.mode === "game") spawnTable(BOT_START.clone());
    }
    if (lastRespawn.current !== G.respawnToken) {
      lastRespawn.current = G.respawnToken;
      clearArena();
    }

    const targetFov = G.scoped ? G.zoomFov : 80;
    cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, 1 - Math.exp(-14 * dt));
    cam.updateProjectionMatrix();

    if (G.phase === "playing" && G.locked && G.countdown > 0) G.countdown = Math.max(0, G.countdown - dt);
    const active = G.phase === "playing" && G.locked && G.countdown <= 0.6;
    G.hitFlash = Math.max(0, G.hitFlash - dt);
    G.hurtFlash = Math.max(0, G.hurtFlash - dt);
    G.parryFlash = Math.max(0, G.parryFlash - dt);
    G.redFlash = Math.max(0, G.redFlash - dt);

    if (active) {
      if (G.mode === "game") G.time += dt;
      G.parryWin = Math.max(0, G.parryWin - dt);
      G.parryCd = Math.max(0, G.parryCd - dt);
      G.buff = Math.max(0, G.buff - dt);
      G.dashCd = Math.max(0, G.dashCd - dt);
      G.bombCd = Math.max(0, G.bombCd - dt);
      G.stun = Math.max(0, G.stun - dt);
      G.bombBig = Math.max(0, G.bombBig - dt);
      G.compromisedT = Math.max(0, G.compromisedT - dt);
      G.respawnMsg = Math.max(0, G.respawnMsg - dt);
      if (G.parryLocked) G.parryWin = 0;
      const stunned = G.stun > 0;
      const buffed = G.buff > 0;

      // --- camera-locked velocity (adaptive lag: slow = instant, fast = slight lag) ---
      const yaw = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ").y;
      const v = hv.current;
      pendingYaw.current += wrap(yaw - lastYaw.current);
      lastYaw.current = yaw;
      if (G.grappling) pendingYaw.current = 0;
      else {
        const rate = THREE.MathUtils.clamp(700 / (v.length() + 5), 3, 40);
        const apply = pendingYaw.current * (1 - Math.exp(-rate * dt));
        v.applyAxisAngle(UP, apply);
        pendingYaw.current -= apply;
      }

      const f = new THREE.Vector3();
      cam.getWorldDirection(f);
      f.y = 0;
      f.normalize();
      const rgt = new THREE.Vector3(-f.z, 0, f.x);
      const wish = new THREE.Vector3();
      const k = keys.current;
      if (k["KeyW"]) wish.add(f);
      if (k["KeyS"]) wish.sub(f);
      if (k["KeyD"]) wish.add(rgt);
      if (k["KeyA"]) wish.sub(rgt);
      if (stunned) wish.set(0, 0, 0);
      if (wish.lengthSq()) wish.normalize();
      const space = !!k["Space"];

      if (G.wallrun) {
        const n = space ? wallNormal(p) : null;
        if (!n) G.wallrun = false;
        else {
          const spd = v.length();
          v.addScaledVector(n, -v.dot(n));
          if (v.lengthSq() > 1e-4) v.setLength(spd);
          vy.current = 0;
        }
      }
      if (!G.wallrun) {
        if (grounded.current && !G.grappling) {
          if (space && !stunned) {
            vy.current = JUMP_V;
            grounded.current = false;
          } else {
            const spd = G.scoped ? SPEED * 0.55 : SPEED;
            v.lerp(wish.clone().multiplyScalar(spd), 1 - Math.exp(-10 * dt));
          }
        } else {
          const prev = v.length();
          v.addScaledVector(wish, AIR_ACCEL * dt);
          const cap = Math.max(prev, SPEED);
          if (v.length() > cap) v.setLength(cap);
          vy.current -= GRAVITY * dt;
          if (space && !grounded.current && wallNormal(p)) {
            G.wallrun = true;
            vy.current = 0;
          }
        }
      }

      // --- grapple spring swing ---
      if (G.grappling) {
        const c = p.clone().setY(p.y + EYE * 0.6);
        const d = anchor.current.clone().sub(c);
        const dist = d.length();
        ropeLen.current = Math.max(6, ropeLen.current - 8 * dt);
        if (dist > ropeLen.current && dist > 1e-3) {
          const n = d.divideScalar(dist);
          const v3 = new THREE.Vector3(v.x, vy.current, v.z);
          const vr = v3.dot(n);
          if (vr < 0) v3.addScaledVector(n, -vr * (1 - Math.exp(-12 * dt))); // kill outward motion, keep tangential -> arc
          v3.addScaledVector(n, GRAPPLE_K * (dist - ropeLen.current) * dt);
          v3.multiplyScalar(Math.exp(-0.15 * dt));
          v.set(v3.x, 0, v3.z);
          vy.current = v3.y;
          if (vy.current > 0) grounded.current = false;
        }
      }
      if (v.length() > MAX_HSPEED) v.setLength(MAX_HSPEED);

      // --- integrate + collide ---
      const prevY = p.y;
      p.addScaledVector(v, dt);
      p.y += vy.current * dt;
      for (const s of SOLIDS) {
        if (vy.current > 0 && prevY + BODY_H <= s.y0 + 0.01 && p.y + BODY_H > s.y0 && overlapXZ(p, s, PLAYER_R * 0.7)) {
          p.y = s.y0 - BODY_H;
          vy.current = 0;
        }
      }
      let sup = 0;
      for (const s of SOLIDS) if (s.y1 <= Math.max(prevY, p.y) + STEP && overlapXZ(p, s, PLAYER_R * 0.5)) sup = Math.max(sup, s.y1);
      if (vy.current <= 0 && p.y <= sup + 0.001) {
        p.y = sup;
        if (vy.current < 0) vy.current = 0;
        if (!grounded.current) {
          grounded.current = true;
          G.wallrun = false;
          G.airJumps = AIR_JUMPS;
          G.airDashes = AIR_DASHES;
        }
      } else if (grounded.current && p.y > sup + 0.05) grounded.current = false;
      for (const s of SOLIDS) if (p.y < s.y1 - STEP && p.y + BODY_H > s.y0) pushOut(p, s, PLAYER_R);
      clampCircle(p, PLAYER_R);
      if (p.y > ROOM.h - BODY_H - 1) {
        p.y = ROOM.h - BODY_H - 1;
        if (vy.current > 0) vy.current = 0;
      }
      G.speed = v.length();
      G.shake = Math.max(0, G.shake - dt * 1.5);
      cam.position.set(p.x, p.y + EYE, p.z);
      if (G.shake > 0) cam.position.add(tmpV.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(G.shake * 2));

      recentPos.current.push({ t: G.time, p: p.clone() });
      while (recentPos.current.length > 1 && recentPos.current[0]!.t < G.time - 0.4) recentPos.current.shift();

      // --- reload / fire ---
      if (G.reloading > 0) {
        G.reloading -= dt;
        if (G.reloading <= 0) {
          G.reloading = 0;
          G.ammo = MAG;
        }
      }
      fireT.current -= dt;
      if (G.firing && !stunned && (buffed || (G.ammo > 0 && G.reloading <= 0)) && fireT.current <= 0) {
        fireT.current = buffed ? FIRE_INTERVAL / 3 : FIRE_INTERVAL;
        if (!buffed) G.ammo--;
        G.shots++;
        const dir = new THREE.Vector3();
        cam.getWorldDirection(dir);
        const spread = G.scoped ? 0.004 : 0.025;
        dir.x += (Math.random() - 0.5) * spread;
        dir.y += (Math.random() - 0.5) * spread;
        dir.z += (Math.random() - 0.5) * spread;
        dir.normalize();
        const start = cam.position.clone().addScaledVector(dir, 1).add(new THREE.Vector3(0, -0.3, 0));
        spawnBullet(playerPool, start, dir.multiplyScalar(BULLET_SPEED), buffed ? DMG * 2 : DMG, 0.4);
        if (!buffed && G.ammo === 0) G.reloading = 1.5;
      }

      // --- tables AI ---
      for (const t of tables) {
        if (!t.alive) continue;
        const bp = t.pos;
        const speed = (5 + (1 - t.hp / (t.summoned ? SUMMON_HP : TABLE_HP)) * 9) * 4;
        const toT = tmpV.copy(t.target).sub(bp).setY(0);
        if (toT.length() < 4) t.target.copy(randomFloor(bp));
        else bp.addScaledVector(toT.normalize(), speed * dt);
        t.dashT -= dt;
        if (t.dashT <= 0) {
          t.dashT = 2.5 + Math.random() * 3;
          const a = Math.random() * Math.PI * 2;
          t.dash.set(Math.cos(a), 0, Math.sin(a)).multiplyScalar(90);
        }
        bp.addScaledVector(t.dash, dt);
        t.dash.multiplyScalar(Math.exp(-3 * dt));
        t.jumpT -= dt;
        if (t.jumpT <= 0 && bp.y <= 0) {
          t.jumpsLeft = 1 + Math.floor(Math.random() * 3);
          t.jumpT = 3 + Math.random() * 3;
        }
        if (t.jumpsLeft > 0 && (bp.y <= 0 || t.vy < 0)) {
          t.vy = JUMP_V;
          t.jumpsLeft--;
        }
        t.vy -= GRAVITY * dt;
        bp.y = Math.max(0, bp.y + t.vy * dt);
        if (bp.y <= 0 && t.vy < 0) t.vy = 0;
        const target = TABLE_S * (0.55 + 0.45 * (t.hp / TABLE_HP));
        t.s = THREE.MathUtils.lerp(t.s, target, 1 - Math.exp(-8 * dt));
        for (const s of SOLIDS) if (s.y0 < 5 && bp.y < s.y1) pushOut(bp, s, 3 * t.s);
        clampCircle(bp, 3 * t.s);
        t.bob += dt * speed * 0.35;
        t.yaw = Math.atan2(cam.position.x - bp.x, cam.position.z - bp.z);
        t.shootT -= dt;
        if (t.shootT <= 0 && !t.passive) {
          t.shootT = 0.45 + Math.random() * 0.4;
          const from = bp.clone().setY(bp.y + 3.2 * t.s);
          if (from.distanceTo(cam.position) < 380) {
            const aim = cam.position.clone().setY(cam.position.y - 0.5).sub(from).normalize();
            aim.x += (Math.random() - 0.5) * 0.05;
            aim.y += (Math.random() - 0.5) * 0.03;
            spawnBullet(botPool, from, aim.normalize().multiplyScalar(t.summoned ? BOT_BULLET_SPEED * 0.5 : BOT_BULLET_SPEED), DMG, t.summoned ? 4 : 2);
          }
        }
      }

      // --- boss ---
      if (G.stage === "incoming") {
        G.bossWarn -= dt;
        if (G.bossWarn <= 0) {
          G.stage = "boss";
          b.y = ROOM.h - 30;
          b.vy = -350;
          b.landed = false;
          b.pos.set(0, 0, 0);
        }
      } else if (G.stage === "boss") {
        G.bossTime += dt;
        healthT.current -= dt;
        if (healthT.current <= 0) {
          healthT.current += HEALTH_INTERVAL;
          const h = health.find((item) => !item.active) ?? health[Math.floor(Math.random() * health.length)];
          if (h) {
            h.pos.copy(randomFloor(p));
            h.active = true;
          }
        }
        if (G.bossTime >= PARRY_LOCK_AT && !G.parryLocked) {
          G.parryLocked = true;
          G.parryWin = 0;
          G.compromisedT = 3;
        }
        if (!b.landed) {
          b.y += b.vy * dt;
          if (b.y <= 0) {
            b.y = 0;
            b.landed = true;
            G.shake = 1;
            addWave(b.pos.x, b.pos.z);
            if (Math.hypot(p.x, p.z) < BOSS_ZONE && p.y < 30) damagePlayer(9999, true);
          }
        } else {
          const chargingStomp = hazards.some((h) => h.active && h.kind === "stomp" && h.t > 0);
          const toP = tmpV.set(p.x - b.pos.x, 0, p.z - b.pos.z);
          if (!chargingStomp && toP.length() > 40) b.pos.addScaledVector(toP.normalize(), 12 * dt);
          clampCircle(b.pos, 25);
          if (!chargingStomp) b.yaw = Math.atan2(p.x - b.pos.x, p.z - b.pos.z);
          b.bulletT -= dt;
          if (b.bulletT <= 0) {
            b.bulletT = 1;
            const from = new THREE.Vector3(b.pos.x, 3.4 * BOSS_S, b.pos.z);
            const aim = cam.position.clone().setY(cam.position.y - 0.5).sub(from).normalize();
            spawnBullet(botPool, from, aim.multiplyScalar(BOT_BULLET_SPEED), BOSS_BULLET_DMG, 3);
          }
          b.specialT -= dt;
          if (b.specialT <= 0) {
            if (b.next === "sword") {
              const rp = recentPos.current[0]?.p ?? p;
              addHazard("sword", rp.x, rp.z, 0.5);
              b.specialT = 1.5;
            } else {
              addHazard("stomp", b.pos.x, b.pos.z, 1);
              b.specialT = 2;
            }
            b.next = b.next === "sword" ? "stomp" : "sword";
          }
          b.quarterT -= dt;
          if (b.quarterT <= 0) {
            b.quarterT = 4;
            addHazard("quarter", 0, 0, 2.5);
          }
          blueT.current -= dt;
          if (blueT.current <= 0) {
            blueT.current = 6;
            for (let k = 0; k < 2; k++) {
              const u = blues.find((x) => !x.alive);
              if (!u) break;
              Object.assign(u, { alive: true, hp: BLUE_HP, hitCd: 0, dashT: 6 + Math.random() * 8 });
              const a = Math.random() * Math.PI * 2;
              u.pos.set(b.pos.x + Math.cos(a) * (BOSS_S * 4), 0, b.pos.z + Math.sin(a) * (BOSS_S * 4));
              clampCircle(u.pos, 3 * TABLE_S);
              u.dash.set(0, 0, 0);
            }
          }
          summonT.current -= dt;
          if (summonT.current <= 0) {
            summonT.current = 10;
            for (let k = 0; k < 2; k++) {
              const a = Math.random() * Math.PI * 2;
              const at = new THREE.Vector3(b.pos.x + Math.cos(a) * (BOSS_S * 4.5), 0, b.pos.z + Math.sin(a) * (BOSS_S * 4.5));
              clampCircle(at, 3 * TABLE_S);
              spawnTable(at, true);
            }
          }
          b.aoeT -= dt;
          if (b.aoeT <= 0) {
            b.aoeT = 7;
            addHazard("aoe", p.x, p.z, 3);
          }
        }
      }

      // Collect health rings only while fighting the boss; never exceed full health.
      if (G.stage === "boss" && G.playerHp < 100) {
        for (const h of health) {
          if (h.active && p.y < 8 && Math.hypot(p.x - h.pos.x, p.z - h.pos.z) < HEALTH_R) {
            G.playerHp = Math.min(100, G.playerHp + HEALTH_AMOUNT);
            h.active = false;
          }
        }
      }

      // --- blue chaser tables ---
      for (const u of blues) {
        if (!u.alive) continue;
        const toP = tmpV.set(p.x - u.pos.x, 0, p.z - u.pos.z);
        const d = toP.length();
        if (d > 0.1) u.pos.addScaledVector(toP.normalize(), BLUE_SPEED * dt);
        u.yaw = Math.atan2(p.x - u.pos.x, p.z - u.pos.z);
        u.dashT -= dt;
        if (u.dashT <= 0) {
          u.dashT = 10 + Math.random() * 10;
          u.dash.set(p.x - u.pos.x, 0, p.z - u.pos.z).normalize().multiplyScalar(BLUE_DASH);
        }
        u.pos.addScaledVector(u.dash, dt);
        u.dash.multiplyScalar(Math.exp(-3 * dt));
        for (const s of SOLIDS) if (s.y0 < 5) pushOut(u.pos, s, 3 * TABLE_S);
        clampCircle(u.pos, 3 * TABLE_S);
        u.hitCd = Math.max(0, u.hitCd - dt);
        if (d < 3 * TABLE_S + PLAYER_R + 1 && p.y < 6 && u.hitCd <= 0) {
          u.hitCd = 0.5;
          damagePlayer(2);
          u.alive = false;
          burst(tmpV.copy(u.pos).setY(4), TABLE_S, 5);
        }
      }

      // --- hazards ---
      for (const h of hazards) {
        if (!h.active) continue;
        if (h.t > 0) {
          h.t -= dt;
          if (h.t <= 0) {
            h.fx = 0.5;
            if (h.kind === "quarter") {
              const ang = (Math.atan2(-p.z, p.x) - h.a0 + Math.PI * 4) % (Math.PI * 2);
              if (ang <= Math.PI / 2) damagePlayer(BIG_DMG);
            } else if (h.kind === "sword") {
              if (Math.hypot(p.x - h.x, p.z - h.z) < SWORD_R && p.y < 40) {
                G.stun = STUN_TIME;
                G.hurtFlash = 0.25;
              }
              G.bombBig = BOMB_BIG_TIME;
              G.shake = Math.max(G.shake, 0.4);
            } else if (h.kind === "stomp") {
              const dir = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw));
              plate.current.alive = true;
              plate.current.pos.set(b.pos.x, PLATE_R, b.pos.z).addScaledVector(dir, PLATE_R + BOSS_S * 3);
              plate.current.prev.copy(plate.current.pos);
              plate.current.vel.copy(dir).multiplyScalar(PLATE_SPEED);
              addWave(b.pos.x, b.pos.z);
              G.shake = Math.max(G.shake, 0.8);
            } else {
              if (Math.hypot(p.x - h.x, p.z - h.z) < AOE_R) damagePlayer(AOE_DMG);
              const bm = booms.find((x) => x.t <= 0) ?? booms[0]!;
              bm.t = 0.5;
              bm.pos.set(h.x, 0, h.z);
              bm.r = AOE_R;
              G.shake = Math.max(G.shake, 0.6);
            }
          }
        } else {
          h.fx -= dt;
          if (h.fx <= 0) h.active = false;
        }
      }

      // --- boss stomp plate (continuous collision) ---
      if (plate.current.alive) {
        const q = plate.current;
        q.prev.copy(q.pos);
        q.pos.addScaledVector(q.vel, dt);
        const playerBody = tmpV.copy(cam.position).setY(cam.position.y - 1);
        const hitPlayer = segSphere(q.prev, q.pos, playerBody, PLATE_HIT_R + PLAYER_R) < Infinity;
        const hitWorld = Math.hypot(q.pos.x, q.pos.z) > R - PLATE_R || segSolids(q.prev, q.pos) < Infinity;
        if (hitPlayer) {
          damagePlayer(PLATE_DMG);
          q.alive = false;
        } else if (hitWorld) q.alive = false;
      }

      // --- bomb (sub-stepped continuous collision) ---
      const bm = bomb.current;
      if (bm.alive) {
        const travel = bm.vel.length() * dt;
        const n = Math.ceil(travel / 1.5);
        const stepV = bm.vel.clone().multiplyScalar(dt / n);
        for (let i = 0; i < n && bm.alive; i++) {
          bm.pos.add(stepV);
          const q = bm.pos;
          let hit = q.y <= 0.3 || q.y >= ROOM.h || Math.hypot(q.x, q.z) >= R - 0.5 || inSolid(q);
          if (!hit) hit = tables.some((t) => t.alive && q.distanceTo(tmpV.copy(t.pos).setY(t.pos.y + 2.6 * t.s)) < 3.4 * t.s);
          if (!hit && bossLive()) {
            bossBox(_mn, _mx);
            hit = q.x > _mn.x && q.x < _mx.x && q.y > _mn.y && q.y < _mx.y && q.z > _mn.z && q.z < _mx.z;
          }
          if (hit) {
            bm.alive = false;
            explode(q.clone());
          }
        }
      }

      // --- boss landing shockwaves (jump over them) ---
      for (const w of waves) {
        if (!w.active) continue;
        const r0 = w.r;
        w.r += WAVE_SPEED * dt;
        if (w.r > R * 2) { w.active = false; continue; }
        const d = Math.hypot(p.x - w.x, p.z - w.z);
        if (!w.hit && d >= r0 - PLAYER_R - 1 && d <= w.r + PLAYER_R + 1 && p.y < WAVE_H) {
          w.hit = true;
          damagePlayer(WAVE_DMG);
        }
      }

      // --- stage clear check ---
      G.bluesAlive = blues.reduce((n, u) => n + (u.alive ? 1 : 0), 0);
      if (G.mode === "game" && G.stage === "tables" && G.capReached && aliveCount() === 0 && G.bluesAlive === 0) {
        G.stage = "incoming";
        G.bossWarn = BOSS_WARN;
        G.playerHp = 100;
      }

      // --- tutorial ---
      if (G.mode === "tutorial") {
        const s = G.tutStep;
        if (tutSetup.current !== s) {
          tutSetup.current = s;
          tutDist.current = 0;
          tutKills.current = G.kills;
          tables.forEach((t) => (t.alive = false));
          blues.forEach((u) => (u.alive = false));
          botPool.forEach((x) => (x.alive = false));
          G.tut = { enter: false, dashed: false, zoomed: false, bombed: false };
          const ahead = p.clone().addScaledVector(f, 70).setY(0);
          clampCircle(ahead, 20);
          if (s === 7 || s === 8) {
            const t = spawnTable(ahead);
            if (t) t.passive = true;
          }
          if (s === 9) spawnTable(ahead);
          if (s === 10) for (let i = 0; i < 3; i++) spawnBlue(randomFloor(p));
        }
        if (s === 1 && grounded.current) tutDist.current += v.length() * dt;
        if (s === 9 && aliveCount() === 0) spawnTable(randomFloor(p));
        const alive = blues.some((u) => u.alive);
        const done = [
          G.tut.enter,
          tutDist.current > 40,
          G.airJumps === 0,
          G.wallrun,
          G.tut.dashed,
          G.grappling,
          G.tut.zoomed,
          G.kills > tutKills.current,
          G.tut.bombed,
          G.parries > 0,
          !alive,
          G.tut.enter,
        ][s];
        if (done) {
          if (s >= TUT_STEPS.length - 1) finishTutorial();
          else G.tutStep++;
        }
      }
    }

    // --- bullets ---
    const stepPool = (pool: Bullet[], inst: THREE.InstancedMesh | null, isPlayer: boolean) => {
      let n = 0;
      for (const bl of pool) {
        if (!bl.alive) continue;
        if (active) {
          bl.prev.copy(bl.pos);
          bl.pos.addScaledVector(bl.vel, dt);
          bl.life -= dt;
          const tSolid = segSolids(bl.prev, bl.pos);
          if (isPlayer) {
            let bestT = Infinity;
            let bestTable: Table | null = null;
            for (const t of tables) {
              if (!t.alive) continue;
              const tt = segSphere(bl.prev, bl.pos, tmpV.copy(t.pos).setY(t.pos.y + 2.6 * t.s), 3.4 * t.s);
              if (tt < bestT) {
                bestT = tt;
                bestTable = t;
              }
            }
            let bossT = Infinity;
            if (bossLive() && b.landed) {
              bossBox(_mn, _mx);
              bossT = segAABB(bl.prev, bl.pos, _mn, _mx);
            }
            let blueHit: (typeof blues)[number] | null = null;
            for (const u of blues) {
              if (!u.alive) continue;
              const tt = segSphere(bl.prev, bl.pos, tmpV.copy(u.pos).setY(2.6 * TABLE_S), 3.4 * TABLE_S);
              if (tt < bestT) { bestT = tt; bestTable = null; blueHit = u; }
            }
            if (Math.min(bestT, bossT) < tSolid) {
              bl.alive = false;
              G.hits++;
              if (bossT < bestT) hitBoss(bl.dmg > DMG ? 2 : 1);
              else if (bestTable) hitTable(bestTable, bl.dmg);
              else if (blueHit) {
                blueHit.hp -= bl.dmg;
                G.hitFlash = 0.15;
                if (blueHit.hp <= 0) { blueHit.alive = false; burst(tmpV.copy(blueHit.pos).setY(4), TABLE_S, 5); }
              }
            } else if (tSolid < Infinity) bl.alive = false;
          } else {
            const body = tmpV.copy(cam.position).setY(cam.position.y - 1);
            const tp = segSphere(bl.prev, bl.pos, body, 1.6 + BOT_BULLET_HALF);
            if (tp < tSolid && G.phase === "playing") {
              bl.alive = false;
              if (G.parryWin > 0 && !G.parryLocked) {
                let tgt: THREE.Vector3 | null = null;
                if (bossLive() && b.landed) tgt = new THREE.Vector3(b.pos.x, b.y + 24, b.pos.z);
                else {
                  let best = Infinity;
                  for (const t of tables) {
                    if (!t.alive) continue;
                    const dd = t.pos.distanceTo(body);
                    if (dd < best) {
                      best = dd;
                      tgt = t.pos.clone().setY(t.pos.y + 2.6 * t.s);
                    }
                  }
                }
                const from = cam.position.clone();
                const dir = tgt ? tgt.sub(from).normalize() : bl.vel.clone().negate().normalize();
                spawnBullet(playerPool, from, dir.multiplyScalar(BULLET_SPEED), DMG * 2, 0.4);
                G.parryWin = 0;
                G.buff = BUFF_TIME;
                G.parryFlash = 0.3;
                G.parries++;
              } else damagePlayer(bl.dmg);
            } else if (tSolid < Infinity) bl.alive = false;
          }
          const q = bl.pos;
          if (bl.alive && (bl.life <= 0 || q.y < 0 || q.y > ROOM.h || Math.hypot(q.x, q.z) > R)) bl.alive = false;
        }
        if (bl.alive && inst) {
          tmpQ.setFromUnitVectors(zAxis, tmpV.copy(bl.vel).normalize());
          tmpM.compose(bl.pos, tmpQ, ONE);
          inst.setMatrixAt(n++, tmpM);
        }
      }
      if (inst) {
        inst.count = n;
        inst.instanceMatrix.needsUpdate = true;
      }
    };
    stepPool(playerPool, pInst.current, true);
    stepPool(botPool, bInst.current, false);

    // --- render tables (instanced) ---
    if (topI.current && legI.current && eyeI.current) {
      tables.forEach((t, i) => {
        if (!t.alive) {
          topI.current!.setMatrixAt(i, HIDE);
          eyeI.current!.setMatrixAt(i * 2, HIDE);
          eyeI.current!.setMatrixAt(i * 2 + 1, HIDE);
          for (let l = 0; l < 4; l++) legI.current!.setMatrixAt(i * 4 + l, HIDE);
          return;
        }
        const y = t.pos.y + (t.pos.y <= 0 ? Math.abs(Math.sin(t.bob)) * 0.4 * t.s : 0);
        tmpQ.setFromAxisAngle(UP, t.yaw);
        tmpM.compose(tmpV.set(t.pos.x, y, t.pos.z), tmpQ, new THREE.Vector3(t.s, t.s, t.s));
        topI.current!.setMatrixAt(i, tmpM2.multiplyMatrices(tmpM, TOP_M));
        LEG_M.forEach((m, l) => legI.current!.setMatrixAt(i * 4 + l, tmpM2.multiplyMatrices(tmpM, m)));
        EYE_M.forEach((m, l) => eyeI.current!.setMatrixAt(i * 2 + l, tmpM2.multiplyMatrices(tmpM, m)));
      });
      topI.current.instanceMatrix.needsUpdate = true;
      legI.current.instanceMatrix.needsUpdate = true;
      eyeI.current.instanceMatrix.needsUpdate = true;
    }
    G.alive = aliveCount();
    if (blueTop.current && blueLeg.current) {
      blues.forEach((u, i) => {
        if (!u.alive) {
          blueTop.current!.setMatrixAt(i, HIDE);
          for (let l = 0; l < 4; l++) blueLeg.current!.setMatrixAt(i * 4 + l, HIDE);
          return;
        }
        tmpQ.setFromAxisAngle(UP, u.yaw);
        tmpM.compose(tmpV.set(u.pos.x, 0, u.pos.z), tmpQ, new THREE.Vector3(TABLE_S, TABLE_S, TABLE_S));
        blueTop.current!.setMatrixAt(i, tmpM2.multiplyMatrices(tmpM, TOP_M));
        LEG_M.forEach((m, l) => blueLeg.current!.setMatrixAt(i * 4 + l, tmpM2.multiplyMatrices(tmpM, m)));
      });
      blueTop.current.instanceMatrix.needsUpdate = true;
      blueLeg.current.instanceMatrix.needsUpdate = true;
    }
    MAP.px = pos.current.x;
    MAP.pz = pos.current.z;
    MAP.yaw = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ").y;
    MAP.boss = G.stage === "boss" && b.landed ? { x: b.pos.x, z: b.pos.z } : null;
    MAP.tables = tables.flatMap((t) => (t.alive ? [t.pos.x, t.pos.z] : []));
    MAP.blues = blues.flatMap((u) => (u.alive ? [u.pos.x, u.pos.z] : []));
    MAP.health = health.flatMap((h) => (h.active ? [h.pos.x, h.pos.z] : []));

    // --- splinter cones ---
    if (splI.current) {
      let n = 0;
      for (let i = splinters.length - 1; i >= 0; i--) {
        const s = splinters[i]!;
        if (active) {
          s.life -= dt;
          s.vel.y -= GRAVITY * dt;
          s.pos.addScaledVector(s.vel, dt);
          if (s.pos.y < 0.2) {
            s.pos.y = 0.2;
            s.vel.y *= -0.3;
            s.vel.x *= 0.7;
            s.vel.z *= 0.7;
            s.spin.multiplyScalar(0.7);
          }
          s.rot.x += s.spin.x * dt;
          s.rot.y += s.spin.y * dt;
          s.rot.z += s.spin.z * dt;
        }
        if (s.life <= 0) {
          splinters.splice(i, 1);
          continue;
        }
        const sc = s.size * Math.min(1, s.life);
        tmpQ.setFromEuler(s.rot);
        splI.current.setMatrixAt(n++, tmpM.compose(s.pos, tmpQ, tmpV.set(sc, sc, sc)));
      }
      splI.current.count = n;
      splI.current.instanceMatrix.needsUpdate = true;
    }

    // --- bomb / explosions / hazards / boss visuals ---
    if (bombMesh.current) {
      bombMesh.current.visible = bomb.current.alive;
      bombMesh.current.position.copy(bomb.current.pos);
      bombMesh.current.scale.setScalar(G.bombBig > 0 ? 1.5 : 1);
    }
    booms.forEach((bm, i) => {
      const m = boomRefs.current[i];
      if (active) bm.t = Math.max(0, bm.t - dt);
      if (!m) return;
      m.visible = bm.t > 0;
      m.position.copy(bm.pos);
      m.scale.setScalar(bm.r * (1 - bm.t / 0.5 * 0.7));
      (m.material as THREE.MeshBasicMaterial).opacity = bm.t * 1.2;
    });
    hazards.forEach((h, i) => {
      const r = hazRefs.current[i]!;
      const charge = h.t > 0 ? 1 - h.t / h.total : 1;
      const pulse = 0.25 + 0.2 * Math.sin(performance.now() / 60);
      if (r.disc) {
        r.disc.visible = h.active && h.kind === "aoe";
        r.disc.position.set(h.x, 0.3, h.z);
        r.disc.scale.setScalar(h.kind === "sword" ? SWORD_R : AOE_R * (h.t > 0 ? charge : 1));
        (r.disc.material as THREE.MeshBasicMaterial).opacity = h.t > 0 ? pulse : 0.7;
      }
      if (r.sector) {
        r.sector.visible = h.active && h.kind === "quarter";
        r.sector.rotation.z = h.a0;
        (r.sector.material as THREE.MeshBasicMaterial).opacity = h.t > 0 ? 0.3 + 0.25 * charge : 0.75;
      }
      if (r.sword) {
        r.sword.visible = h.active && h.kind === "sword";
        r.sword.position.set(h.x, h.t > 0 ? 60 : Math.max(0, 60 * (h.fx - 0.4) * 10), h.z);
      }
    });
    if (zoneRef.current) {
      zoneRef.current.visible = G.stage === "incoming" || (G.stage === "boss" && !b.landed);
      (zoneRef.current.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.2 * Math.sin(performance.now() / 120);
    }
    if (bossRef.current) {
      bossRef.current.visible = G.stage === "boss" && G.phase !== "won";
      bossRef.current.position.set(b.pos.x, b.y, b.pos.z);
      bossRef.current.rotation.y = b.yaw;
      const stomp = hazards.find((h) => h.active && h.kind === "stomp" && h.t > 0);
      bossRef.current.rotation.x = stomp ? -Math.sin((1 - stomp.t / stomp.total) * Math.PI * 0.5) * 0.35 : 0;
    }
    if (plateRef.current) {
      plateRef.current.visible = plate.current.alive;
      plateRef.current.position.copy(plate.current.pos);
      // flat face (cylinder axis) points along the velocity
      if (plate.current.vel.lengthSq() > 0) plateRef.current.quaternion.setFromUnitVectors(UP, tmpV.copy(plate.current.vel).normalize());
    }
    waves.forEach((w, i) => {
      const m = waveRefs.current[i];
      if (!m) return;
      m.visible = w.active;
      m.position.set(w.x, WAVE_H / 2, w.z);
      m.scale.set(w.r, WAVE_H, w.r);
    });
    health.forEach((h, i) => {
      const ring = healthRefs.current[i];
      if (!ring) return;
      ring.visible = h.active && G.stage === "boss" && G.phase === "playing";
      ring.position.set(h.pos.x, 0.45, h.pos.z);
      if (active) ring.rotation.z += dt * 0.6;
    });
    if (ropeRef.current) {
      ropeRef.current.visible = G.grappling;
      if (G.grappling) {
        const from = tmpV.copy(cam.position).setY(cam.position.y - 0.6);
        const d = anchor.current.clone().sub(from);
        ropeRef.current.position.copy(from).addScaledVector(d, 0.5);
        ropeRef.current.quaternion.setFromUnitVectors(UP, d.clone().normalize());
        ropeRef.current.scale.set(1, d.length(), 1);
      }
    }
    if (parryMesh.current) {
      parryMesh.current.visible = G.parryWin > 0 || G.buff > 0;
      parryMesh.current.position.copy(cam.position);
    }
  });

  return (
    <>
      <PointerLockControls ref={ctrl} selector="#no-auto-lock" />
      <group ref={staticRef}>
        <Room />
      </group>
      <instancedMesh ref={topI} args={[undefined, undefined, TABLE_CAP]} frustumCulled={false} castShadow>
        <boxGeometry args={[6, 0.5, 4]} />
        <meshStandardMaterial map={wood} roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={legI} args={[undefined, undefined, TABLE_CAP * 4]} frustumCulled={false} castShadow>
        <boxGeometry args={[0.45, 3, 0.45]} />
        <meshStandardMaterial map={wood} color="#d8b08a" />
      </instancedMesh>
      <instancedMesh ref={eyeI} args={[undefined, undefined, TABLE_CAP * 2]} frustumCulled={false}>
        <boxGeometry args={[0.7, 0.25, 0.05]} />
        <meshStandardMaterial color="#1a0d05" />
      </instancedMesh>
      <instancedMesh ref={splI} args={[undefined, undefined, 220]} frustumCulled={false}>
        <coneGeometry args={[0.25, 1.6, 5]} />
        <meshStandardMaterial map={wood} color="#e0b98a" />
      </instancedMesh>
      <instancedMesh ref={pInst} args={[undefined, undefined, 128]} frustumCulled={false}>
        <boxGeometry args={[0.08, 0.08, 6]} />
        <meshStandardMaterial color="#e2b27a" emissive="#b8752e" />
      </instancedMesh>
      <instancedMesh ref={bInst} args={[undefined, undefined, 320]} frustumCulled={false}>
        <boxGeometry args={[0.7, 0.7, 7]} />
        <meshStandardMaterial color="#5a2e0e" emissive="#c2410c" emissiveIntensity={0.8} />
      </instancedMesh>
      <instancedMesh ref={blueTop} args={[undefined, undefined, BLUE_N]} frustumCulled={false} castShadow>
        <boxGeometry args={[6, 0.5, 4]} />
        <meshStandardMaterial color="#2f6fd6" emissive="#0a2a66" roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={blueLeg} args={[undefined, undefined, BLUE_N * 4]} frustumCulled={false} castShadow>
        <boxGeometry args={[0.45, 3, 0.45]} />
        <meshStandardMaterial color="#1f4fa8" />
      </instancedMesh>
      <mesh ref={bombMesh} visible={false}>
        <sphereGeometry args={[0.8, 16, 12]} />
        <meshStandardMaterial color="#222" emissive="#ff7a1a" emissiveIntensity={1.5} />
      </mesh>
      {booms.map((_, i) => (
        <mesh key={i} ref={(m) => { boomRefs.current[i] = m; }} visible={false}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshBasicMaterial color="#ffb347" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
      {hazards.map((_, i) => (
        <group key={i}>
          <mesh ref={(m) => { hazRefs.current[i]!.disc = m; }} rotation-x={-Math.PI / 2} visible={false}>
            <circleGeometry args={[1, 48]} />
            <meshBasicMaterial color="#ff1a1a" transparent opacity={0.3} depthWrite={false} />
          </mesh>
          <mesh ref={(m) => { hazRefs.current[i]!.sector = m; }} rotation-x={-Math.PI / 2} position={[0, 0.25, 0]} visible={false}>
            <circleGeometry args={[R, 48, 0, Math.PI / 2]} />
            <meshBasicMaterial color="#ff1a1a" transparent opacity={0.3} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <group ref={(g) => { hazRefs.current[i]!.sword = g; }} visible={false}>
            <mesh position={[0, ROOM.h / 2, 0]}>
              <cylinderGeometry args={[2.5, 5, ROOM.h, 16]} />
              <meshBasicMaterial color="#fff4b8" transparent opacity={0.32} depthWrite={false} />
            </mesh>
            <mesh position={[0, 22, 0]}>
              <boxGeometry args={[1.2, 40, 6]} />
              <meshStandardMaterial color="#d8dde2" metalness={0.8} roughness={0.25} />
            </mesh>
            <mesh position={[0, 43, 0]}>
              <boxGeometry args={[2, 2, 16]} />
              <meshStandardMaterial color="#7a1010" />
            </mesh>
            <mesh position={[0, 48, 0]}>
              <boxGeometry args={[1.6, 8, 1.6]} />
              <meshStandardMaterial color="#3a2210" />
            </mesh>
          </group>
        </group>
      ))}
      <mesh ref={zoneRef} rotation-x={-Math.PI / 2} position={[0, 0.3, 0]} visible={false}>
        <circleGeometry args={[BOSS_ZONE, 64]} />
        <meshBasicMaterial color="#ff2020" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <group ref={bossRef} visible={false} scale={BOSS_S}>
        <mesh position={[0, 3.2, 0]} castShadow>
          <boxGeometry args={[6, 0.5, 4]} />
          <meshStandardMaterial color="#b3121b" roughness={0.5} emissive="#3a0000" />
        </mesh>
        {LEG_M.map((_, l) => {
          const x = l % 2 ? 2.4 : -2.4, z = l < 2 ? -1.5 : 1.5;
          return (
            <mesh key={l} position={[x, 1.5, z]} castShadow>
              <boxGeometry args={[0.45, 3, 0.45]} />
              <meshStandardMaterial color="#8a0d14" />
            </mesh>
          );
        })}
        {[-1, 1].map((x) => (
          <mesh key={x} position={[x, 3.25, 2.02]} rotation-z={x * -0.35}>
            <boxGeometry args={[0.9, 0.22, 0.05]} />
            <meshStandardMaterial color="#ffd000" emissive="#ffb000" emissiveIntensity={2} />
          </mesh>
        ))}
      </group>
      {waves.map((_, i) => (
        <mesh key={i} ref={(m) => { waveRefs.current[i] = m; }} visible={false}>
          <cylinderGeometry args={[1, 1, 1, 64, 1, true]} />
          <meshBasicMaterial color="#ff2a2a" transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
      {health.map((_, i) => (
        <group key={i} ref={(group) => { healthRefs.current[i] = group; }} visible={false}>
          <mesh rotation-x={-Math.PI / 2}>
            <torusGeometry args={[HEALTH_R * 0.75, 0.5, 10, 40]} />
            <meshBasicMaterial color="var(--crosshair)" toneMapped={false} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.08, 0]}>
            <ringGeometry args={[0, HEALTH_R * 0.75, 40]} />
            <meshBasicMaterial color="var(--crosshair)" transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <boxGeometry args={[4, 0.25, 1]} />
            <meshBasicMaterial color="var(--crosshair)" toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <boxGeometry args={[1, 0.25, 4]} />
            <meshBasicMaterial color="var(--crosshair)" toneMapped={false} />
          </mesh>
        </group>
      ))}
      <mesh ref={plateRef} visible={false} castShadow>
        <cylinderGeometry args={[PLATE_R, PLATE_R, 2.2, 48]} />
        <meshStandardMaterial color="#e8edf0" roughness={0.28} metalness={0.18} />
      </mesh>
      <mesh ref={ropeRef} visible={false}>
        <cylinderGeometry args={[0.05, 0.05, 1, 6]} />
        <meshStandardMaterial color="#e8d9b0" />
      </mesh>
      <mesh ref={parryMesh} visible={false}>
        <sphereGeometry args={[2, 24, 16]} />
        <meshBasicMaterial color="#6fc3ff" transparent opacity={0.15} side={THREE.BackSide} depthWrite={false} />
      </mesh>
    </>
  );
}
