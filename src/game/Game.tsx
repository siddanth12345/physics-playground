import { Canvas } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { World } from "./World";
import { G, MAG, PARRY_CD, DASH_CD, BOMB_CD, TABLE_CAP, BOSS_HITS, resetGame, lockPointer, MAP, TUT_STEPS, goHome, finishTutorial } from "./state";
import { ROOM, SOLIDS } from "./Room";

function useTick(ms: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function Bar({ label, value, max = 100, tone, right }: { label: string; value: number; max?: number; tone: string; right?: string }) {
  return (
    <div className="w-64">
      <div className="mb-1 flex justify-between text-xs font-bold uppercase tracking-widest">
        <span>{label}</span>
        <span>{right ?? Math.ceil(value)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-sm bg-hud-track">
        <div className="h-full transition-all" style={{ width: `${(value / max) * 100}%`, background: `var(--${tone})` }} />
      </div>
    </div>
  );
}

function MiniMap() {
  const R = ROOM.r;
  const dot = (x: number, z: number, c: string, r: number, k: string) => <circle key={k} cx={x} cy={z} r={r} fill={c} stroke="#000" strokeWidth={2} />;
  const t: React.ReactNode[] = [];
  for (let i = 0; i < MAP.tables.length; i += 2) t.push(dot(MAP.tables[i]!, MAP.tables[i + 1]!, "#22c55e", 7, "t" + i));
  for (let i = 0; i < MAP.blues.length; i += 2) t.push(dot(MAP.blues[i]!, MAP.blues[i + 1]!, "#60a5fa", 6, "u" + i));
  for (let i = 0; i < MAP.health.length; i += 2) t.push(<circle key={"h" + i} cx={MAP.health[i]} cy={MAP.health[i + 1]} r={8} fill="none" stroke="var(--crosshair)" strokeWidth={4} />);
  const hx = MAP.px - Math.sin(MAP.yaw) * 30, hz = MAP.pz - Math.cos(MAP.yaw) * 30;
  return (
    <div className="absolute right-6 top-6 rounded-full border-2 border-hud/30 bg-hud-panel p-3 shadow-2xl">
      <svg viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} className="h-[min(68vh,32rem)] w-[min(68vh,32rem)]">
        <circle cx={0} cy={0} r={R - 2} fill="#e8dcc4" fillOpacity={0.25} stroke="currentColor" strokeWidth={4} />
        {SOLIDS.map((s, i) => (
          <rect key={i} x={s.x - s.hw} y={s.z - s.hd} width={s.hw * 2} height={s.hd * 2} fill={s.c ?? "#8a6a4a"} fillOpacity={0.88} stroke="#e8dcc4" strokeWidth={1.5} />
        ))}
        {t}
        {MAP.boss && dot(MAP.boss.x, MAP.boss.z, "#ef4444", 16, "boss")}
        <line x1={MAP.px} y1={MAP.pz} x2={hx} y2={hz} stroke="#1d4ed8" strokeWidth={5} />
        {dot(MAP.px, MAP.pz, "#1d4ed8", 9, "me")}
      </svg>
    </div>
  );
}

function HUD() {
  useTick(50);
  const playing = G.phase === "playing";
  if (G.phase === "won" || G.phase === "home") return null;
  const step = TUT_STEPS[G.tutStep];
  return (
    <div className="pointer-events-none fixed inset-0 z-10 select-none font-mono text-hud">
      {G.hurtFlash > 0 && <div className="absolute inset-0 bg-destructive/25" />}
      {G.redFlash > 0 && <div className="absolute inset-0 bg-destructive/40" />}
      {(G.buff > 0 || G.parryFlash > 0) && <div className="absolute inset-0 shadow-[inset_0_0_120px_var(--shield)]" />}
      {G.scoped && playing && <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_32%,var(--scope)_34%)]" />}
      {playing && G.locked && G.countdown > 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-9xl font-black drop-shadow-[0_4px_0_rgba(0,0,0,0.6)]">
          {G.countdown > 0.6 ? Math.ceil(G.countdown - 0.6) : "GO!"}
        </div>
      )}
      {G.stun > 0 && playing && (
        <div className="absolute left-1/2 top-[38%] -translate-x-1/2 text-4xl font-black uppercase text-destructive">Stunned</div>
      )}
      {G.compromisedT > 0 && playing && (
        <div className="absolute left-1/2 top-[28%] -translate-x-1/2 text-center text-6xl font-black uppercase text-shield drop-shadow-[0_3px_0_rgba(0,0,0,0.7)]">
          Parry compromised
        </div>
      )}
      {G.respawnMsg > 0 && playing && (
        <div className="absolute left-1/2 top-[20%] -translate-x-1/2 rounded bg-hud-panel px-6 py-3 text-2xl font-black uppercase">Back to the boss checkpoint</div>
      )}
      {G.mode === "tutorial" && playing && step && (
        <div className="absolute left-1/2 top-6 w-[min(40rem,60vw)] -translate-x-1/2 rounded border-2 border-shield/60 bg-hud-panel p-4 text-center">
          <div className="text-xs uppercase tracking-widest opacity-70">Tutorial {G.tutStep + 1} / {TUT_STEPS.length} · Esc for menu</div>
          <div className="mt-1 text-2xl font-black uppercase">{step.title}</div>
          <div className="mt-2 text-sm">{step.text}</div>
        </div>
      )}

      {playing && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative h-8 w-8">
            <div className="absolute left-1/2 top-0 h-2.5 w-0.5 -translate-x-1/2 bg-crosshair" />
            <div className="absolute bottom-0 left-1/2 h-2.5 w-0.5 -translate-x-1/2 bg-crosshair" />
            <div className="absolute left-0 top-1/2 h-0.5 w-2.5 -translate-y-1/2 bg-crosshair" />
            <div className="absolute right-0 top-1/2 h-0.5 w-2.5 -translate-y-1/2 bg-crosshair" />
            <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-crosshair" />
            {G.hitFlash > 0 && <div className="absolute -inset-2 rotate-45 border-2 border-crosshair" />}
          </div>
        </div>
      )}

      <MiniMap />
      <div className="absolute left-6 top-6 space-y-2 rounded bg-hud-panel p-3 text-xs font-bold uppercase tracking-widest">
        {G.stage === "tables" && (
          <>
            <div>Tables alive: {G.alive}{G.capReached ? " — clear them all!" : ` / ${TABLE_CAP}`}</div>
            {G.bluesAlive > 0 && <div className="text-shield">Blue tables: {G.bluesAlive}</div>}
            <div className="opacity-70">Kills: {G.kills}</div>
          </>
        )}
        {G.stage === "incoming" && <div className="text-destructive">Boss incoming — {Math.ceil(G.bossWarn)}s</div>}
        {G.stage === "boss" && <Bar label="Boss Table" value={BOSS_HITS - G.bossHits} max={BOSS_HITS} tone="enemy" right={`${BOSS_HITS - G.bossHits} hits`} />}
      </div>
      {G.stage === "incoming" && (
        <div className="absolute left-1/2 top-24 -translate-x-1/2 rounded bg-destructive/80 px-6 py-3 text-center text-destructive-foreground">
          <div className="text-2xl font-black uppercase">Stay away from the center!</div>
          <div className="mx-auto mt-2 h-2 w-72 bg-hud-track">
            <div className="h-full bg-destructive-foreground" style={{ width: `${(G.bossWarn / 10) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="absolute bottom-6 left-6 space-y-3 rounded bg-hud-panel p-3">
        <Bar label="Your Health" value={G.playerHp} tone="crosshair" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold uppercase tracking-widest">
          <span className={G.buff > 0 ? "text-shield" : ""}>
            [E] Parry {G.buff > 0 ? `POWER ${G.buff.toFixed(1)}s` : G.parryLocked ? "COMPROMISED" : G.parryWin > 0 ? "ACTIVE" : G.parryCd > 0 ? G.parryCd.toFixed(1) : "ready"}
          </span>
          <span>[Q] Dash {G.dashCd > 0 ? G.dashCd.toFixed(1) : "ready"}</span>
          <span>[F] Bomb {G.bombCd > 0 ? G.bombCd.toFixed(1) : "ready"}</span>
          <span className={G.grappling ? "text-shield" : ""}>[C] Grapple</span>
        </div>
        <div className="flex gap-4 text-xs font-bold uppercase tracking-widest">
          <span>Air jumps {G.airJumps}</span>
          <span>Air dashes {G.airDashes}</span>
          <span>{Math.round(G.speed)} u/s</span>
          {G.wallrun && <span className="text-shield">Wallrun</span>}
        </div>
        <div className="h-1 w-64 bg-hud-track">
          <div className="h-full bg-shield" style={{ width: `${(1 - G.parryCd / PARRY_CD) * 100}%` }} />
        </div>
        <div className="h-1 w-64 bg-hud-track">
          <div className="h-full bg-hud" style={{ width: `${(1 - G.dashCd / DASH_CD) * 100}%` }} />
        </div>
        <div className="h-1 w-64 bg-hud-track">
          <div className="h-full bg-enemy" style={{ width: `${Math.min(1, 1 - G.bombCd / BOMB_CD) * 100}%` }} />
        </div>
      </div>
      <div className="absolute bottom-6 right-6 rounded bg-hud-panel p-3 text-right">
        <div className="text-xs uppercase tracking-widest opacity-70">Splinters</div>
        <div className="text-4xl font-black">
          {G.buff > 0 ? "∞" : G.reloading > 0 ? "RELOADING" : `${G.ammo} / ${MAG}`}
        </div>
      </div>
    </div>
  );
}

const btnMain = "pointer-events-auto rounded bg-crosshair px-8 py-3 text-lg font-black uppercase text-hud-ink";
const btnAlt = "pointer-events-auto rounded border-2 border-hud/40 px-8 py-3 text-lg font-black uppercase";

function playGame() {
  resetGame("game");
  lockPointer();
}
function startTutorial() {
  resetGame("tutorial");
  lockPointer();
}
function resume() {
  G.countdown = 3.6;
  lockPointer();
}

const CONTROLS: [string, string][] = [
  ["W A S D", "Move"],
  ["Mouse", "Look around"],
  ["Space", "Jump (3 total) · hold at a wall to wallrun"],
  ["Left click", "Shoot splinters"],
  ["Right click", "Scope · scroll wheel to zoom"],
  ["R", "Reload"],
  ["Q", "Dash (4 in the air)"],
  ["E", "Parry — reflect a bullet for a power boost"],
  ["F", "Throw a bomb"],
  ["Hold C", "Grapple rope"],
  ["Esc", "Pause menu"],
];
const BOTS: [string, string, string][] = [
  ["Green table", "var(--crosshair)", "That's you! A fast, jumping, dashing, grappling table."],
  ["Brown table", "#8a5a33", "Normal enemy. Hops around and shoots splinters. Break one and two more appear — up to 30. Then clear them all."],
  ["Blue table", "#2f6fd6", "Fast chaser. Rushes you and explodes on contact. 20 of them appear when you must clear the tables, and the boss summons more."],
  ["Red boss", "#b3121b", "Drops from the ceiling. Shoots hard-hitting bullets, drops swords that stun you, throws plates, sends shockwaves you must jump over and compromises your parry after 5 seconds."],
];

function ControlsList() {
  return (
    <ul className="space-y-1 text-left text-sm">
      {CONTROLS.map(([k, d]) => (
        <li key={k} className="grid grid-cols-[8rem_1fr] gap-2"><b>{k}</b><span className="opacity-80">{d}</span></li>
      ))}
    </ul>
  );
}
function BotList() {
  return (
    <ul className="space-y-3 text-left text-sm">
      {BOTS.map(([n, c, d]) => (
        <li key={n} className="flex gap-3">
          <span className="mt-1 h-4 w-6 shrink-0 rounded-sm border border-hud/40" style={{ background: c }} />
          <span><b className="uppercase">{n}</b> — <span className="opacity-80">{d}</span></span>
        </li>
      ))}
    </ul>
  );
}

function Home() {
  useTick(150);
  const [tab, setTab] = useState<"main" | "controls" | "bots">("main");
  if (G.phase !== "home") return null;
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-hud-scrim font-mono text-hud">
      <div className="w-full max-w-xl rounded-lg border-2 border-hud/30 bg-hud-panel p-8 text-center">
        <h1 className="text-6xl font-black tracking-tight">Table Wars</h1>
        <p className="mt-2 text-sm opacity-70">Break every table. Survive the red boss.</p>
        {tab === "main" ? (
          <div className="mx-auto mt-8 flex max-w-xs flex-col gap-3">
            <button className={btnMain} onClick={playGame}>Play</button>
            <button className={btnAlt} onClick={() => setTab("controls")}>Controls</button>
            <button className={btnAlt} onClick={() => setTab("bots")}>Bot Types</button>
            <button className={btnAlt} onClick={startTutorial}>Tutorial</button>
          </div>
        ) : (
          <div className="mt-6">
            <h2 className="mb-4 text-2xl font-black uppercase">{tab === "controls" ? "Controls" : "Bot Types"}</h2>
            {tab === "controls" ? <ControlsList /> : <BotList />}
            <button className={`${btnAlt} mt-6`} onClick={() => setTab("main")}>Back</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Menu() {
  useTick(100);
  const phase = G.phase;
  if (phase === "lost") {
    return (
      <div className="fixed inset-0 z-20 flex items-center justify-center bg-hud-scrim font-mono text-hud">
        <div className="max-w-lg rounded-lg border-2 border-hud/30 bg-hud-panel p-8 text-center">
          <h1 className="text-5xl font-black tracking-tight">You Got Splintered</h1>
          <div className="mt-6 flex justify-center gap-3">
            <button className={btnMain} onClick={playGame}>Restart</button>
            <button className={btnAlt} onClick={goHome}>Home</button>
          </div>
        </div>
      </div>
    );
  }
  if (phase !== "playing" || G.locked) return null;
  const tut = G.mode === "tutorial";
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-hud-scrim font-mono text-hud">
      <div className="w-full max-w-sm rounded-lg border-2 border-hud/30 bg-hud-panel p-8 text-center">
        <h1 className="text-5xl font-black tracking-tight">{tut ? "Tutorial" : "Paused"}</h1>
        <div className="mt-6 flex flex-col gap-3">
          <button className={btnMain} onClick={resume}>Resume</button>
          <button className={btnAlt} onClick={tut ? startTutorial : playGame}>Restart</button>
          {tut ? (
            <button className={btnAlt} onClick={finishTutorial}>Skip Tutorial</button>
          ) : (
            <button className={btnAlt} onClick={startTutorial}>Tutorial</button>
          )}
          <button className={btnAlt} onClick={goHome}>Home</button>
        </div>
      </div>
    </div>
  );
}

function VictoryTable() {
  const table = useRef<THREE.Group>(null);
  useFrame(({ clock }, delta) => {
    const model = table.current;
    if (!model) return;
    model.rotation.y += delta * 0.65;
    model.position.y = Math.abs(Math.sin(clock.elapsedTime * 2.2)) * 0.8 - 1;
    model.rotation.z = Math.sin(clock.elapsedTime * 2.2) * 0.08;
  });
  return (
    <group ref={table} scale={0.9}>
      <mesh position={[0, 1.7, 0]} castShadow><boxGeometry args={[5, 0.55, 3.4]} /><meshStandardMaterial color="#2fa84f" roughness={0.55} /></mesh>
      {([[-2, 0.6, -1.2], [2, 0.6, -1.2], [-2, 0.6, 1.2], [2, 0.6, 1.2]] as const).map((p, i) => (
        <mesh key={i} position={p} castShadow><boxGeometry args={[0.45, 2.6, 0.45]} /><meshStandardMaterial color="#197a37" /></mesh>
      ))}
      {[-0.85, 0.85].map((x) => (
        <group key={x} position={[x, 1.8, 1.72]}>
          <mesh><sphereGeometry args={[0.32, 18, 12]} /><meshStandardMaterial color="#f5f2dc" /></mesh>
          <mesh position={[0, 0, 0.29]}><sphereGeometry args={[0.12, 12, 8]} /><meshStandardMaterial color="#172117" /></mesh>
        </group>
      ))}
    </group>
  );
}

function WinScreen() {
  useTick(200);
  if (G.phase !== "won") return null;
  const acc = G.shots ? (G.hits / G.shots) * 100 : 0;
  const m = Math.floor(G.time / 60), s = Math.floor(G.time % 60);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-hud-scrim p-6 font-mono text-hud">
      <div className="grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-lg border-2 border-hud/30 bg-hud-panel shadow-2xl md:grid-cols-[0.9fr_1.1fr]">
        <div className="relative min-h-80 border-b-2 border-hud/20 md:min-h-[34rem] md:border-b-0 md:border-r-2">
          <div className="absolute left-6 top-6 z-10 text-5xl font-black uppercase">Victory</div>
          <Canvas shadows camera={{ position: [8, 5, 10], fov: 42 }}>
            <ambientLight intensity={1.1} />
            <directionalLight position={[5, 10, 6]} intensity={2.2} castShadow />
            <VictoryTable />
            <mesh rotation-x={-Math.PI / 2} position={[0, -1.1, 0]} receiveShadow><circleGeometry args={[7, 48]} /><meshStandardMaterial color="#314438" roughness={1} /></mesh>
          </Canvas>
          <div className="absolute bottom-6 left-6 text-sm font-black uppercase tracking-widest text-crosshair">The green table wins</div>
        </div>
        <div className="flex min-h-[34rem] flex-col justify-center p-8 md:p-12">
          <div className="mb-8 border-b-2 border-hud/30 pb-3 text-3xl font-black uppercase">Results</div>
          <dl className="space-y-3 text-lg">
            {[
              ["Time", `${m}:${s.toString().padStart(2, "0")}`],
              ["Bullets shot", G.shots],
              ["Bullets hit", G.hits],
              ["Accuracy", `${acc.toFixed(1)}%`],
              ["Tables defeated", G.kills],
              ["Shots parried", G.parries],
            ].map(([label, value]) => (
              <div key={label} className="grid grid-cols-[1fr_auto] items-center border-b border-hud/20 bg-hud-track px-4 py-3">
                <dt className="font-bold uppercase opacity-75">{label}</dt><dd className="text-2xl font-black">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 flex gap-3">
            <button className={btnMain} onClick={() => playGame()}>Play Again</button>
            <button className={btnAlt} onClick={() => goHome()}>Home</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Game() {
  const [, force] = useState(0);
  useEffect(() => {
    let done = false;
    try { done = localStorage.getItem("tw-tutorial-done") === "1"; } catch { /* ignore */ }
    if (!done) resetGame("tutorial");
    else G.phase = "home";
    force((n) => n + 1);
  }, []);
  return (
    <div className="fixed inset-0 bg-black">
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 3.2, 12], fov: 72, near: 0.1, far: 3000 }}>
        <color attach="background" args={["#e8dcc4"]} />
        <fog attach="fog" args={["#e8dcc4", 250, 1400]} />
        <ambientLight intensity={0.7} color="#ffe8c8" />
        <directionalLight
          position={[-120, 500, -180]}
          intensity={1.8}
          color="#fff2d8"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-360}
          shadow-camera-right={360}
          shadow-camera-top={360}
          shadow-camera-bottom={-360}
          shadow-camera-far={1500}
        />
        <Environment>
          <Lightformer intensity={1.5} position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={[30, 20, 1]} color="#fff1dc" />
          <Lightformer intensity={1} position={[0, 6, -20]} scale={[20, 6, 1]} color="#cfe6ff" />
        </Environment>
        <World />
      </Canvas>
      <HUD />
      <Menu />
      <Home />
      <WinScreen />
    </div>
  );
}
