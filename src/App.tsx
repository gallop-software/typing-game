import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Stars, Text } from "@react-three/drei";
import * as THREE from "three";
import "./ui/ui.css";

// ─── Types ───
interface Ship {
  id: number;
  pos: THREE.Vector3;
  targetX: number;
  targetY: number;
  wobble: number;
}

interface Letter {
  id: number;
  char: string;
  pos: THREE.Vector3;
  speed: number;
}

interface Boom {
  id: number;
  pos: THREE.Vector3;
  color: string;
  birth: number;
}

interface Laser {
  id: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  color: string;
  birth: number;
}

interface UfoEvent {
  id: number;
  startPos: THREE.Vector3; // above the planet
  endPos: THREE.Vector3;   // center of play area where it fires
  birth: number;
  fired: boolean;          // whether the letter burst has been released yet
}

interface SurfaceBoom {
  id: number;
  pos: THREE.Vector3;
  birth: number;
}

interface Asteroid {
  id: number;
  angle: number;
  radius: number;
  y: number;
  size: number;
}

type Phase = "menu" | "playing" | "gameover";
type PlanetState = "alive" | "destroyed";

// ─── Mutable game state (not React state — avoids re-render cost) ───
const game = {
  phase: "menu" as Phase,
  score: 0,
  combo: 0,
  maxCombo: 0,
  lives: 10,
  elapsed: 0,
  hits: 0,
  ships: [] as Ship[],
  letters: [] as Letter[],
  booms: [] as Boom[],
  damageFlash: 0,
  nextId: 1,
  wave: 0,
  waveTimer: 0,
  waveActive: true,
  ufoEvents: [] as UfoEvent[],
  lasers: [] as Laser[],
  ufoTimer: 0,
  planetState: "alive" as PlanetState,
  planetSurfaceBooms: [] as SurfaceBoom[],
  planetExplosionCount: 0,
  planetBigBoomBirth: null as number | null,
  asteroids: [] as Asteroid[],
};

// Fixed lane positions — first 7 for normal play, all 20 for rage mode
const SHIP_LANES = [
  { x: -20, y: 6 },  { x: 0, y: -7 },   { x: 20, y: 5 },
  { x: -12, y: -8 }, { x: 12, y: 8 },   { x: -24, y: -3 }, { x: 24, y: -4 },
  { x: -32, y: 2 },  { x: 32, y: -2 },  { x: -8, y: 11 },  { x: 8, y: -11 },
  { x: -16, y: 0 },  { x: 16, y: 0 },   { x: 0, y: 13 },   { x: -28, y: -12 },
  { x: 28, y: 12 },  { x: -4, y: -14 }, { x: 4, y: 14 },   { x: -36, y: 6 }, { x: 36, y: -6 },
];

function resetGame() {
  game.phase = "playing";
  game.score = 0;
  game.combo = 0;
  game.maxCombo = 0;
  game.lives = 10;
  game.elapsed = 0;
  game.hits = 0;
  game.letters = [];
  game.booms = [];
  game.damageFlash = 0;
  game.ships = [];
  game.ufoEvents = [];
  game.lasers = [];
  game.ufoTimer = 0;
  game.planetState = "alive";
  game.planetSurfaceBooms = [];
  game.planetExplosionCount = 0;
  game.planetBigBoomBirth = null;
  game.asteroids = [];
  game.wave = 1;
  game.waveTimer = 0;
  game.waveActive = true;
  for (let i = 0; i < 3; i++) spawnShip();
}

function spawnShip() {
  const lane = SHIP_LANES[game.ships.length % SHIP_LANES.length];
  const z = -55 - Math.random() * 15;
  game.ships.push({
    id: game.nextId++,
    pos: new THREE.Vector3(lane.x, lane.y, z),
    targetX: lane.x,
    targetY: lane.y,
    wobble: Math.random() * Math.PI * 2,
  });
}

const CHAR_POOLS = [
  "asdfjkl;",
  "abcdefghijklmnopqrstuvwxyz",
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP",
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
];

function getPool() {
  if (game.wave <= 3) return CHAR_POOLS[0]; // home row only
  if (game.wave <= 6) return CHAR_POOLS[1]; // all lowercase
  if (game.wave <= 9) return CHAR_POOLS[2]; // + some uppercase
  return CHAR_POOLS[3]; // full mixed case
}

// Wave durations: active shooting phase, then a calm break
const WAVE_ACTIVE_DURATION = 12; // seconds of shooting
const WAVE_BREAK_DURATION = 4; // seconds of calm (no new letters)

function getFireRate() {
  const w = game.wave;
  if (w <= 2) return 5.0;
  if (w <= 4) return 4.0;
  if (w <= 6) return 3.5;
  if (w <= 8) return 3.0;
  return 2.5;
}

function getMaxLetters() {
  const w = game.wave;
  if (w <= 2) return 3;
  if (w <= 4) return 4;
  if (w <= 6) return 5;
  return 6;
}

function getShipCount() {
  if (game.wave <= 2) return 3;
  if (game.wave <= 4) return 4;
  if (game.wave <= 6) return 5;
  if (game.wave <= 8) return 6;
  return 7;
}

function spawnUfo() {
  if (game.planetState === "destroyed") return;
  game.ufoEvents.push({
    id: game.nextId++,
    startPos: new THREE.Vector3(PLANET_POS.x, PLANET_POS.y + 32, -88),
    endPos: new THREE.Vector3(5 + (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6, -88),
    birth: Date.now(),
    fired: false,
  });
}

function letterColor(c: string) {
  if (c >= "a" && c <= "z") return "#00ff88";
  if (c >= "A" && c <= "Z") return "#ff4444";
  return "#ffcc00";
}

// ─── 3D Components ───

const PLANET_POS = new THREE.Vector3(95, 0, -160);
const SURFACE_BOOM_DURATION = 2.2;
const PLANET_BIG_BOOM_DURATION = 4.5;

// Surface explosion on the planet during self-destruct sequence
function PlanetSurfaceBoom({ boom }: { boom: SurfaceBoom }) {
  const ref = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const dirs = useMemo(
    () => Array.from({ length: 14 }, () => new THREE.Vector3().randomDirection()),
    [],
  );
  useFrame(() => {
    if (!ref.current) return;
    const age = (Date.now() - boom.birth) / 1000;
    if (age > SURFACE_BOOM_DURATION) { ref.current.visible = false; return; }
    const t = age / SURFACE_BOOM_DURATION;
    ref.current.children.forEach((c, i) => {
      if (i < dirs.length) {
        (c as THREE.Mesh).position.copy(dirs[i]!.clone().multiplyScalar(age * 28));
        (c as THREE.Mesh).scale.setScalar(Math.max(0, 1 - t));
      }
    });
    const flash = ref.current.children[dirs.length] as THREE.Mesh;
    if (flash) {
      flash.scale.setScalar(age * 18);
      (flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.65 - t);
    }
    if (lightRef.current) lightRef.current.intensity = Math.max(0, 35 * (1 - t));
  });
  return (
    <group ref={ref} position={boom.pos}>
      {dirs.map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[3.5, 6, 6]} />
          <meshBasicMaterial color="#ff6600" toneMapped={false} />
        </mesh>
      ))}
      <mesh>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color="#ffcc00" transparent opacity={0.65} toneMapped={false} />
      </mesh>
      <pointLight ref={lightRef} color="#ff4400" intensity={35} distance={150} />
    </group>
  );
}

// Giant explosion when the planet fully destroys
function PlanetBigBoom({ birth }: { birth: number }) {
  const ref = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const shards = useMemo(
    () =>
      Array.from({ length: 28 }, () => ({
        dir: new THREE.Vector3().randomDirection(),
        size: 4 + Math.random() * 7,
        color: (["#ff8800", "#ff4400", "#ffcc00", "#ffffff"] as const)[
          Math.floor(Math.random() * 4)
        ],
      })),
    [],
  );
  useFrame(() => {
    if (!ref.current) return;
    const age = (Date.now() - birth) / 1000;
    if (age > PLANET_BIG_BOOM_DURATION) { ref.current.visible = false; return; }
    const t = age / PLANET_BIG_BOOM_DURATION;
    ref.current.children.forEach((c, i) => {
      if (i < shards.length) {
        (c as THREE.Mesh).position.copy(shards[i]!.dir.clone().multiplyScalar(age * 70));
        (c as THREE.Mesh).scale.setScalar(Math.max(0, 1 - t * 0.7));
      }
    });
    const sphere = ref.current.children[shards.length] as THREE.Mesh;
    if (sphere) {
      sphere.scale.setScalar(age * 35 + 1);
      (sphere.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - t);
    }
    if (lightRef.current) lightRef.current.intensity = Math.max(0, 250 * (1 - t * 0.6));
  });
  return (
    <group position={PLANET_POS}>
      {shards.map((s, i) => (
        <mesh key={i}>
          <dodecahedronGeometry args={[s.size, 0]} />
          <meshBasicMaterial color={s.color} toneMapped={false} />
        </mesh>
      ))}
      <mesh>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <pointLight ref={lightRef} color="#ff8800" intensity={250} distance={700} />
    </group>
  );
}

// Asteroid belt — replaces the planet after it is destroyed
function AsteroidBelt() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.06;
  });
  return (
    <group ref={ref} position={PLANET_POS}>
      {game.asteroids.map((ast) => (
        <mesh
          key={ast.id}
          position={[
            Math.cos(ast.angle) * ast.radius,
            ast.y,
            Math.sin(ast.angle) * ast.radius,
          ]}
        >
          <dodecahedronGeometry args={[ast.size, 0]} />
          <meshStandardMaterial color="#887766" roughness={0.95} metalness={0.05} />
        </mesh>
      ))}
      <pointLight color="#ff5500" intensity={4} distance={220} />
    </group>
  );
}

function PlanetMesh() {
  const bodyRef = useRef<THREE.Mesh>(null);
  const flickerRef = useRef<THREE.PointLight>(null);
  useFrame((_, delta) => {
    if (game.planetState === "destroyed") return;
    if (bodyRef.current) bodyRef.current.rotation.y += delta * 0.04;
    if (flickerRef.current && game.planetExplosionCount > 0) {
      flickerRef.current.intensity = 4 + Math.sin(Date.now() * 0.012) * 3 + Math.random() * 4;
    }
  });
  if (game.planetState === "destroyed") return null;
  return (
    <group position={PLANET_POS}>
      {/* Atmosphere glow (rendered behind body) */}
      <mesh>
        <sphereGeometry args={[32, 32, 32]} />
        <meshBasicMaterial
          color="#8844ff"
          transparent
          opacity={0.08}
          side={THREE.BackSide}
        />
      </mesh>
      {/* Planet body */}
      <mesh ref={bodyRef}>
        <sphereGeometry args={[28, 48, 48]} />
        <meshStandardMaterial
          color="#2a0e5e"
          emissive="#3a0e7e"
          emissiveIntensity={0.35}
          roughness={0.85}
          metalness={0.05}
        />
      </mesh>
      {/* Surface highlight band */}
      <mesh>
        <torusGeometry args={[16, 4, 8, 48]} />
        <meshStandardMaterial
          color="#4a2090"
          emissive="#220055"
          emissiveIntensity={0.4}
          roughness={0.6}
        />
      </mesh>
      {/* Rings */}
      <mesh rotation={[1.1, 0.3, 0]}>
        <torusGeometry args={[42, 2.5, 4, 80]} />
        <meshStandardMaterial
          color="#7755cc"
          emissive="#441188"
          emissiveIntensity={0.5}
          transparent
          opacity={0.75}
        />
      </mesh>
      <mesh rotation={[1.1, 0.3, 0]}>
        <torusGeometry args={[50, 1.2, 4, 80]} />
        <meshStandardMaterial
          color="#553399"
          emissive="#220066"
          emissiveIntensity={0.4}
          transparent
          opacity={0.5}
        />
      </mesh>
      {/* Planet glow light — flickers during self-destruct */}
      <pointLight ref={flickerRef} color="#8844ff" intensity={4} distance={200} />
    </group>
  );
}

const ISD_TRAVEL = 1.8; // seconds to swoop from planet to firing position

// Imperial Star Destroyer — swoops from above the planet on every 10-combo milestone
function UfoMesh({ event }: { event: UfoEvent }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const age = (Date.now() - event.birth) / 1000;

    // Ease-out cubic swoop from planet to play area
    const t = Math.min(age / ISD_TRAVEL, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    const x = THREE.MathUtils.lerp(event.startPos.x, event.endPos.x, ease);
    const y = THREE.MathUtils.lerp(event.startPos.y, event.endPos.y, ease);
    const z = THREE.MathUtils.lerp(event.startPos.z, event.endPos.z, ease);

    // Gentle hover wobble once arrived
    const hoverAge = Math.max(0, age - ISD_TRAVEL);
    ref.current.position.set(
      x + Math.sin(hoverAge * 0.5) * 1.5,
      y + Math.sin(hoverAge * 0.35) * 0.8,
      z,
    );

    // Fade out after hovering for 2.5s
    const fadeStart = ISD_TRAVEL + 2.5;
    const fade = age > fadeStart ? Math.max(0, 1 - (age - fadeStart) / 0.8) : 1;
    ref.current.scale.setScalar(fade);
  });

  return (
    <group ref={ref}>
      {/* Main wedge hull — 3-segment cone (triangular cross-section), tip toward camera */}
      <mesh rotation={[Math.PI / 2, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0, 9, 30, 3, 1]} />
        <meshStandardMaterial
          color="#aabbcc"
          emissive="#3355aa"
          emissiveIntensity={0.55}
          metalness={0.9}
          roughness={0.12}
        />
      </mesh>
      {/* Upper hull layer — slightly smaller wedge on top for depth */}
      <mesh position={[0, 3, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0, 7, 24, 3, 1]} />
        <meshStandardMaterial
          color="#bbccdd"
          emissive="#4466bb"
          emissiveIntensity={0.45}
          metalness={0.85}
          roughness={0.18}
        />
      </mesh>
      {/* Bridge command tower */}
      <mesh position={[0, 9, -2]}>
        <boxGeometry args={[3.5, 5.5, 4.5]} />
        <meshStandardMaterial
          color="#aabbcc"
          emissive="#2244cc"
          emissiveIntensity={0.7}
          metalness={0.9}
          roughness={0.1}
        />
      </mesh>
      {/* Bridge sensor array on top */}
      <mesh position={[0, 12.5, -1.5]}>
        <boxGeometry args={[2, 1.5, 3]} />
        <meshStandardMaterial
          color="#ccdde8"
          emissive="#5577dd"
          emissiveIntensity={0.9}
          metalness={0.95}
          roughness={0.05}
        />
      </mesh>
      {/* Hangar bay indent strip on belly */}
      <mesh position={[0, -1.2, 2]}>
        <boxGeometry args={[6, 0.4, 10]} />
        <meshBasicMaterial color="#5577aa" />
      </mesh>
      {/* Ion engine bank — 4 blue thruster ports at the stern */}
      {([-5, -1.8, 1.8, 5] as number[]).map((x, i) => (
        <group key={i} position={[x, 0, 13]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[1.3, 1.3, 0.6, 14]} />
            <meshBasicMaterial color="#44aaff" />
          </mesh>
          <pointLight color="#3399ff" intensity={6} distance={18} />
        </group>
      ))}
      {/* Strong overall ship glow so it reads clearly */}
      <pointLight color="#66aaff" intensity={30} distance={80} />
    </group>
  );
}

function ShipMesh({ ship }: { ship: Ship }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) {
      ref.current.position.copy(ship.pos);
      ref.current.lookAt(0, 0, 5);
    }
  });
  return (
    <group ref={ref}>
      <mesh rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[1.8, 3.5, 6]} />
        <meshStandardMaterial
          color="#556677"
          emissive="#223344"
          emissiveIntensity={1}
          metalness={0.7}
          roughness={0.2}
        />
      </mesh>
      <mesh position={[-1.8, 0, 0]} rotation={[0, 0, 0.35]}>
        <boxGeometry args={[2, 0.15, 0.9]} />
        <meshStandardMaterial
          color="#445566"
          emissive="#ff2200"
          emissiveIntensity={1.5}
        />
      </mesh>
      <mesh position={[1.8, 0, 0]} rotation={[0, 0, -0.35]}>
        <boxGeometry args={[2, 0.15, 0.9]} />
        <meshStandardMaterial
          color="#445566"
          emissive="#ff2200"
          emissiveIntensity={1.5}
        />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.45, 12, 12]} />
        <meshBasicMaterial color="#00ff44" />
      </mesh>
      <pointLight
        position={[0, 0, -1]}
        color="#ff4400"
        intensity={2}
        distance={12}
      />
    </group>
  );
}

function LetterMesh({ letter }: { letter: Letter }) {
  const ref = useRef<THREE.Group>(null);
  const color = letterColor(letter.char);
  useFrame(() => {
    if (ref.current) ref.current.position.copy(letter.pos);
  });
  return (
    <group ref={ref}>
      <Text
        fontSize={2.2}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.08}
        outlineColor={color}
      >
        {letter.char}
        <meshBasicMaterial color={color} toneMapped={false} />
      </Text>
      <mesh>
        <sphereGeometry args={[0.5, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.25} />
      </mesh>
      <pointLight color={color} intensity={3} distance={12} />
    </group>
  );
}

const BOOM_DURATION = 0.9;

function BoomEffect({ boom }: { boom: Boom }) {
  const ref = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const dirs = useMemo(
    () => Array.from({ length: 16 }, () => new THREE.Vector3().randomDirection()),
    [],
  );
  useFrame(() => {
    if (!ref.current) return;
    const age = (Date.now() - boom.birth) / 1000;
    if (age > BOOM_DURATION) { ref.current.visible = false; return; }
    const t = age / BOOM_DURATION;

    // Debris particles
    ref.current.children.forEach((c, i) => {
      if (i < dirs.length) {
        const d = dirs[i]!;
        (c as THREE.Mesh).position.copy(d.clone().multiplyScalar(age * 18));
        (c as THREE.Mesh).scale.setScalar(Math.max(0, 1 - t));
      }
    });

    // Central flash sphere (child after dirs)
    const flash = ref.current.children[dirs.length] as THREE.Mesh;
    if (flash) {
      flash.scale.setScalar(age * 12);
      (flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.7 - t * 1.4);
    }

    // Shockwave ring
    const ring = ref.current.children[dirs.length + 1] as THREE.Mesh;
    if (ring) {
      ring.scale.setScalar(age * 16);
      (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - t * 2);
    }

    // Light flash
    if (lightRef.current) {
      lightRef.current.intensity = Math.max(0, 40 * (1 - t * 1.5));
    }
  });
  return (
    <group ref={ref} position={boom.pos}>
      {dirs.map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.4, 6, 6]} />
          <meshBasicMaterial color={boom.color} toneMapped={false} />
        </mesh>
      ))}
      {/* Central flash */}
      <mesh>
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.7} toneMapped={false} />
      </mesh>
      {/* Shockwave ring */}
      <mesh>
        <torusGeometry args={[1, 0.12, 6, 32]} />
        <meshBasicMaterial color={boom.color} transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <pointLight ref={lightRef} color={boom.color} intensity={40} distance={30} />
    </group>
  );
}

function LaserMesh({ laser }: { laser: Laser }) {
  const ref = useRef<THREE.Mesh>(null);
  const { mid, quaternion, length } = useMemo(() => {
    const dir = laser.to.clone().sub(laser.from);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.normalize(),
    );
    return { mid: laser.from.clone().add(laser.to).multiplyScalar(0.5), quaternion: q, length: len };
  }, [laser.from, laser.to]);

  useFrame(() => {
    if (!ref.current) return;
    const age = (Date.now() - laser.birth) / 1000;
    const opacity = Math.max(0, 1 - age / 0.18);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = opacity;
  });

  return (
    <mesh ref={ref} position={mid} quaternion={quaternion}>
      <cylinderGeometry args={[0.08, 0.08, length, 6]} />
      <meshBasicMaterial color={laser.color} transparent opacity={1} toneMapped={false} />
    </mesh>
  );
}

// ─── Main game loop (runs inside Canvas) ───
function GameEngine({ onUpdate }: { onUpdate: () => void }) {
  const lastFire = useRef<Map<number, number>>(new Map());

  useFrame((_, rawDelta) => {
    if (game.phase !== "playing") return;
    const delta = Math.min(rawDelta, 0.05);
    game.elapsed += delta;
    game.damageFlash = Math.max(0, game.damageFlash - delta * 3);

    const projSpeed = 3.5 + game.wave * 0.3;
    const fireRate = getFireRate();
    const maxLetters = getMaxLetters();
    const desiredShips = getShipCount();
    const pool = getPool();
    const now = Date.now();

    // UFO cruiser spawns every 30 seconds
    game.ufoTimer += delta;
    if (game.ufoTimer >= 30) {
      game.ufoTimer = 0;
      spawnUfo();
    }

    // Wave timer — alternate between active shooting and calm breaks
    game.waveTimer += delta;
    if (game.waveActive && game.waveTimer >= WAVE_ACTIVE_DURATION) {
      game.waveActive = false;
      game.waveTimer = 0;
    } else if (!game.waveActive && game.waveTimer >= WAVE_BREAK_DURATION) {
      game.waveActive = true;
      game.waveTimer = 0;
      game.wave++;
    }

    // Clean old planet surface booms
    game.planetSurfaceBooms = game.planetSurfaceBooms.filter(
      (b) => (now - b.birth) / 1000 < SURFACE_BOOM_DURATION + 0.1,
    );

    // Adjust ship count
    while (game.ships.length < desiredShips) spawnShip();
    if (game.ships.length > desiredShips) game.ships.length = desiredShips;

    // Ships hover in place with gentle wobble — they do NOT approach
    for (let si = 0; si < game.ships.length; si++) {
      const ship = game.ships[si];
      const t = now / 1000;
      ship.pos.x = ship.targetX + Math.sin(t * 0.8 + ship.wobble) * 1.5;
      ship.pos.y = ship.targetY + Math.cos(t * 0.6 + ship.wobble) * 1.0;

      // Only fire during active wave phase
      if (game.waveActive) {
        const lf = lastFire.current.get(ship.id) ?? 0;
        if ((now - lf) / 1000 >= fireRate && game.letters.length < maxLetters) {
          const ch = pool[Math.floor(Math.random() * pool.length)];
          const spreadX = (Math.random() - 0.5) * 14;
          const spreadY = (Math.random() - 0.5) * 8;
          game.letters.push({
            id: game.nextId++,
            char: ch,
            pos: new THREE.Vector3(
              ship.pos.x + spreadX,
              ship.pos.y + spreadY,
              ship.pos.z + 2,
            ),
            speed: projSpeed,
          });
          lastFire.current.set(ship.id, now);
        }
      }
    }

    // Move letters
    for (let i = game.letters.length - 1; i >= 0; i--) {
      const l = game.letters[i];
      l.pos.z += l.speed * delta;
      if (l.pos.z >= 4) {
        game.booms.push({
          id: game.nextId++,
          pos: l.pos.clone(),
          color: "#ff0000",
          birth: now,
        });
        game.letters.splice(i, 1);
        game.lives--;
        game.combo = 0;
        game.damageFlash = 1;
      }
    }

    // Fire letters from ISD once it arrives at its destination
    for (const ufo of game.ufoEvents) {
      if (!ufo.fired && (now - ufo.birth) / 1000 >= ISD_TRAVEL) {
        ufo.fired = true;
        const burstPool = getPool();
        const burstSpeed = 4.5 + game.wave * 0.3;
        for (let i = 0; i < 5; i++) {
          game.letters.push({
            id: game.nextId++,
            char: burstPool[Math.floor(Math.random() * burstPool.length)],
            pos: new THREE.Vector3(
              ufo.endPos.x + (Math.random() - 0.5) * 22,
              ufo.endPos.y + (Math.random() - 0.5) * 14,
              ufo.endPos.z + 2,
            ),
            speed: burstSpeed,
          });
        }
      }
    }

    // Clean old booms, lasers, and UFO events
    game.booms = game.booms.filter((b) => (now - b.birth) / 1000 < BOOM_DURATION + 0.1);
    game.lasers = game.lasers.filter((l) => (now - l.birth) / 1000 < 0.25);
    game.ufoEvents = game.ufoEvents.filter((u) => (now - u.birth) / 1000 < 5.5);

    // Check death
    if (game.lives <= 0) {
      game.lives = 0;
      game.phase = "gameover";
    }

    onUpdate();
  });

  return null;
}

// ─── Scene ───
function GameScene({ onUpdate }: { onUpdate: () => void }) {
  const starsRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (starsRef.current) starsRef.current.rotation.z += delta * 0.015;
  });

  return (
    <>
      <color attach="background" args={["#000008"]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 0, 5]} intensity={2} />
      <directionalLight
        position={[5, 5, -10]}
        intensity={0.6}
        color="#4466ff"
      />

      <group ref={starsRef}>
        <Stars
          radius={300}
          depth={200}
          count={6000}
          factor={5}
          saturation={0.3}
          fade={false}
          speed={2}
        />
      </group>

      <PlanetMesh />
      {game.planetState === "destroyed" && game.asteroids.length > 0 && <AsteroidBelt />}
      {game.planetSurfaceBooms.map((b) => (
        <PlanetSurfaceBoom key={b.id} boom={b} />
      ))}
      {game.planetBigBoomBirth !== null && <PlanetBigBoom birth={game.planetBigBoomBirth} />}

      {game.ufoEvents.map((u) => (
        <UfoMesh key={u.id} event={u} />
      ))}

      {game.ships.map((s) => (
        <ShipMesh key={s.id} ship={s} />
      ))}
      {game.letters.map((l) => (
        <LetterMesh key={l.id} letter={l} />
      ))}
      {game.booms.map((b) => (
        <BoomEffect key={b.id} boom={b} />
      ))}
      {game.lasers.map((l) => (
        <LaserMesh key={l.id} laser={l} />
      ))}

      <GameEngine onUpdate={onUpdate} />
    </>
  );
}

// ─── Top-level App ───
export default function App() {
  const [, forceUpdate] = useState(0);
  const triggerUpdate = useCallback(() => forceUpdate((n) => n + 1), []);

  // Keyboard input
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (game.phase === "menu" || game.phase === "gameover") {
          resetGame();
          triggerUpdate();
        }
        return;
      }

      if (game.phase === "playing" && e.key.length === 1) {
        e.preventDefault();
        // Find closest matching letter (highest Z = closest to player)
        let best: Letter | null = null;
        for (const l of game.letters) {
          if (l.char === e.key) {
            if (!best || l.pos.z > best.pos.z) best = l;
          }
        }
        if (best) {
          const hitColor = letterColor(best.char);
          game.booms.push({
            id: game.nextId++,
            pos: best.pos.clone(),
            color: hitColor,
            birth: Date.now(),
          });
          game.lasers.push({
            id: game.nextId++,
            from: new THREE.Vector3(0, 0, 3),
            to: best.pos.clone(),
            color: hitColor,
            birth: Date.now(),
          });
          game.letters = game.letters.filter((l) => l.id !== best!.id);
          game.combo++;
          game.maxCombo = Math.max(game.maxCombo, game.combo);
          game.score += 10 + (game.combo - 1) * 2;
          game.hits++;

          // Every 10 hits: one explosion on the planet
          if (game.hits % 10 === 0 && game.planetState === "alive") {
            const phi = Math.random() * Math.PI;
            const theta = Math.random() * Math.PI * 2;
            game.planetSurfaceBooms.push({
              id: game.nextId++,
              pos: new THREE.Vector3(
                PLANET_POS.x + 28 * Math.sin(phi) * Math.cos(theta),
                PLANET_POS.y + 28 * Math.cos(phi),
                PLANET_POS.z + 28 * Math.sin(phi) * Math.sin(theta),
              ),
              birth: Date.now(),
            });
            game.planetExplosionCount++;
            if (game.planetExplosionCount >= 10) {
              game.planetState = "destroyed";
              game.planetBigBoomBirth = Date.now();
              for (let i = 0; i < 20; i++) {
                game.asteroids.push({
                  id: game.nextId++,
                  angle: (i / 20) * Math.PI * 2 + (Math.random() - 0.5) * 0.4,
                  radius: 32 + Math.random() * 24,
                  y: (Math.random() - 0.5) * 22,
                  size: 2.5 + Math.random() * 5.5,
                });
              }
            }
          }

          triggerUpdate();
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triggerUpdate]);

  const phase = game.phase;
  const wpm =
    game.elapsed > 0 ? Math.round(game.hits / 5 / (game.elapsed / 60)) : 0;
  const survived = `${Math.floor(game.elapsed / 60)}:${String(Math.floor(game.elapsed % 60)).padStart(2, "0")}`;

  return (
    <>
      <Canvas
        camera={{ fov: 75, near: 0.1, far: 500, position: [0, 0, 5] }}
        style={{ position: "fixed", inset: 0 }}
      >
        <GameScene onUpdate={triggerUpdate} />
      </Canvas>

      {/* Damage flash */}
      {game.damageFlash > 0 && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 10,
            background: `radial-gradient(ellipse at center, transparent 30%, rgba(255,0,0,${game.damageFlash * 0.5}) 100%)`,
          }}
        />
      )}

      {/* UI Overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 5,
        }}
      >
        {phase === "menu" && (
          <div className="screen start-screen">
            <h1 className="title">
              <span className="title-line">THE EXTRATERRESTRIAL</span>
              <span className="subtitle-line">ALIENS STRIKE BACK</span>
            </h1>
            <p className="tagline">TYPE TO SURVIVE</p>
            <div className="instructions">
              <p>Alien ships will fire letters at you.</p>
              <p>Type the matching key to neutralize each letter.</p>
              <p className="case-warning">
                CASE SENSITIVE: <span className="key-example lower">a</span> and{" "}
                <span className="key-example upper">A</span> are different!
              </p>
            </div>
            <p className="prompt pulse">PRESS SPACE TO START</p>
          </div>
        )}

        {phase === "playing" && (
          <>
            <div className="hud-top-right">
              <div className="score">{game.score}</div>
              {game.combo > 1 && (
                <div className="combo" key={game.combo}>
                  {game.combo}x COMBO
                </div>
              )}
            </div>
            <div className="hud-top-left">
              <div className="lives-label">SHIELDS</div>
              <div className="lives-container">
                {Array.from({ length: 10 }, (_, i) => (
                  <div
                    key={i}
                    className={`shield-icon ${i < game.lives ? "active" : "depleted"} ${game.lives <= 3 && i < game.lives ? "warning" : ""}`}
                  />
                ))}
              </div>
            </div>
            {/* Wave / event indicator */}
            <div
              style={{
                position: "absolute",
                bottom: "2rem",
                left: "50%",
                transform: "translateX(-50%)",
                fontFamily: "Orbitron, sans-serif",
                letterSpacing: "0.2em",
                fontSize: "0.8rem",
                color: game.planetExplosionCount > 0 && game.planetState === "alive"
                  ? "#ff6600"
                  : game.waveActive
                    ? "#ff6644"
                    : "#44aaff",
                textShadow: game.planetExplosionCount > 0 && game.planetState === "alive"
                  ? "0 0 12px #ff4400"
                  : game.waveActive
                    ? "0 0 10px #ff4400"
                    : "0 0 10px #0088ff",
              }}
            >
              {game.planetExplosionCount > 0 && game.planetState === "alive"
                ? `PLANET DAMAGE ${game.planetExplosionCount}/10`
                : game.waveActive
                  ? `WAVE ${game.wave}`
                  : "INCOMING WAVE..."}
            </div>
            <div
              className="crosshair"
              style={{ position: "fixed", zIndex: 5 }}
            />
          </>
        )}

        {phase === "gameover" && (
          <div className="screen gameover-screen">
            <h1 className="gameover-title">GAME OVER</h1>
            <div className="stats">
              <div className="stat">
                <span className="stat-label">SCORE</span>
                <span className="stat-value">{game.score}</span>
              </div>
              <div className="stat">
                <span className="stat-label">MAX COMBO</span>
                <span className="stat-value">{game.maxCombo}x</span>
              </div>
              <div className="stat">
                <span className="stat-label">WPM</span>
                <span className="stat-value">{wpm}</span>
              </div>
              <div className="stat">
                <span className="stat-label">TIME</span>
                <span className="stat-value">{survived}</span>
              </div>
              <div className="stat">
                <span className="stat-label">NEUTRALIZED</span>
                <span className="stat-value">{game.hits}</span>
              </div>
              <div className="stat">
                <span className="stat-label">WAVES SURVIVED</span>
                <span className="stat-value">{game.wave}</span>
              </div>
            </div>
            <p className="prompt pulse">PRESS SPACE TO PLAY AGAIN</p>
          </div>
        )}
      </div>
    </>
  );
}
