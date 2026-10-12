import * as THREE from 'three';
import { ZONES } from '../../shared/arena';
import { PERSONAS } from '../../shared/rules';
import type { FighterView, LiveStatus, SeasonSummary, ZoneId } from '../../shared/types';
import { API_BASE, api, type RulesPayload } from '../lib/api';
import { startCodeRain } from '../lib/code-rain';
import { renderBadge, renderBoard, renderJoin, renderPool, renderReplays, renderSchedule, renderSeason } from './sections';
import { buildColosseum } from '../three/colosseum';
import { Effects } from '../three/effects';
import { FighterMesh } from '../three/fighter-mesh';
import { slotPosition } from '../three/layout';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Hero: the Colosseum slowly turning, with the live fighters inside ----------
const canvas = $<HTMLCanvasElement>('hero-scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(0.42);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0806);
scene.fog = new THREE.Fog(0x0b0806, 70, 150);
scene.add(new THREE.HemisphereLight(0xf0d29a, 0x2a1c12, 0.9));
const sun = new THREE.DirectionalLight(0xffcf8a, 2.4);
sun.position.set(30, 40, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44, far: 120 });
scene.add(sun);

const colosseum = buildColosseum({ shadows: true });
scene.add(colosseum.group);
const effects = new Effects(scene, colosseum.pitCenter);
const camera = new THREE.PerspectiveCamera(40, 1, 1, 400);
const fighters = new Map<string, { mesh: FighterMesh; zone: ZoneId }>();

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize);
resize();

function placeAll(): void {
  for (const zone of ZONES) {
    const here = [...fighters.entries()].filter(([, f]) => f.zone === zone).sort(([a], [b]) => a.localeCompare(b));
    here.forEach(([, f], i) => {
      const p = slotPosition(zone, i, here.length);
      f.mesh.setTarget(p.x, p.z);
    });
  }
}

function syncFighters(views: FighterView[]): void {
  const seen = new Set<string>();
  for (const v of views) {
    if (v.status !== 'active') continue;
    seen.add(v.id);
    let f = fighters.get(v.id);
    if (!f) {
      const mesh = new FighterMesh(v.id, v.color);
      const p = slotPosition(v.zone, 0, 1);
      mesh.setTarget(p.x, p.z, true);
      scene.add(mesh.group);
      f = { mesh, zone: v.zone };
      fighters.set(v.id, f);
    }
    f.zone = v.zone;
  }
  for (const [id, f] of fighters) {
    if (seen.has(id)) continue;
    effects.derez(f.mesh.position.clone(), f.mesh.color);
    scene.remove(f.mesh.group);
    fighters.delete(id);
  }
  placeAll();
}

/** Until the server answers, eight placeholder figures wander between zones. */
function wander(): void {
  if (fighters.size === 0) {
    syncFighters(
      PERSONAS.slice(0, 8).map((p, i) => ({
        id: `idle-${i}`,
        name: p.name,
        color: p.color,
        model: '',
        modelLabel: '',
        lab: '',
        zone: ZONES[i % ZONES.length],
        hp: 3,
        rations: 0,
        keys: 0,
        shields: 0,
        favor: 0,
        status: 'active' as const,
        bounty: false,
      })),
    );
  }
  for (const f of fighters.values()) if (Math.random() < 0.3) f.zone = ZONES[Math.floor(Math.random() * ZONES.length)];
  placeAll();
}

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(0.1, timer.getDelta());
  const t = timer.getElapsed();
  const a = t * 0.06 + 0.6;
  const r = 62 * Math.max(1, 1.5 / camera.aspect);
  camera.position.set(Math.cos(a) * r, 36 * (r / 62), Math.sin(a) * r);
  camera.lookAt(0, 2, 0);
  colosseum.update(dt, t);
  effects.update(dt, t);
  for (const f of fighters.values()) f.mesh.update(dt, t);
  renderer.render(scene, camera);
});

// ---------- Live badge and data sections ----------
let live = false;
let latestRules: RulesPayload | null = null;
let latestStatus: LiveStatus | null = null;
let latestSeason: SeasonSummary | null = null;

async function pollStatus(): Promise<void> {
  try {
    latestStatus = await api.status();
    live = true;
    if (latestStatus.phase === 'running') syncFighters(latestStatus.fighters);
    else if (!latestStatus.fighters.length) wander();
  } catch {
    latestStatus = null;
    if (!live) wander();
  }
  renderBadge(latestStatus);
  renderPool(latestRules, latestStatus, latestSeason);
  if (latestSeason) renderSeason(latestSeason, latestStatus);
}

async function loadSections(): Promise<void> {
  const [rules, board, matches, season, token, callers, gladiatorList] = await Promise.allSettled([
    api.rules(),
    api.leaderboard(),
    api.matches(),
    api.season(),
    api.token(),
    api.callers(),
    api.gladiators(),
  ]);
  renderJoin(
    token.status === 'fulfilled' ? token.value : null,
    callers.status === 'fulfilled' ? callers.value : [],
    gladiatorList.status === 'fulfilled' ? gladiatorList.value : [],
  );
  if (rules.status === 'fulfilled') {
    latestRules = rules.value;
    renderSchedule(rules.value);
  } else {
    $('prompt-text').textContent = "Can't reach the game server right now.";
  }
  if (season.status === 'fulfilled') {
    latestSeason = season.value;
    renderSeason(season.value, latestStatus);
  }
  renderPool(latestRules, latestStatus, latestSeason);
  renderBoard(board.status === 'fulfilled' ? board.value : []);
  if (matches.status === 'fulfilled') renderReplays(matches.value);
}
for (const button of document.querySelectorAll<HTMLButtonElement>('.ca[data-ca]')) {
  button.addEventListener('click', async () => {
    const label = button.querySelector('.ca-copy');
    try {
      await navigator.clipboard.writeText(button.dataset.ca ?? '');
      if (label) label.textContent = 'Copied';
    } catch {
      if (label) label.textContent = 'Select it';
    }
    window.setTimeout(() => label && (label.textContent = 'Copy'), 1600);
  });
}

$<HTMLAnchorElement>('archive-download').href = `${API_BASE}/api/archive`;

pollStatus();
window.setInterval(pollStatus, 4000);
window.setInterval(() => {
  if (!live) wander();
}, 3500);
loadSections();
window.setInterval(loadSections, 15000);
startCodeRain($<HTMLCanvasElement>('front-rain'), { density: 0.2, fps: 10 });
