import * as THREE from 'three';
import { ZONES } from '../../shared/arena';
import { PERSONAS } from '../../shared/rules';
import type { FighterView, LeaderboardRow, LiveStatus, MatchMeta, ZoneId } from '../../shared/types';
import { api, escapeHtml } from '../lib/api';
import { startCodeRain } from '../lib/code-rain';
import { buildColiseum } from '../three/coliseum';
import { Effects } from '../three/effects';
import { FighterMesh } from '../three/fighter-mesh';
import { slotPosition } from '../three/layout';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Hero: the Coliseum slowly turning, with the live fighters inside ----------
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

const coliseum = buildColiseum({ shadows: true });
scene.add(coliseum.group);
const effects = new Effects(scene, coliseum.pitCenter);
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

/** Until the server answers, eight demo fighters wander between zones. */
function wander(): void {
  if (fighters.size === 0) {
    syncFighters(
      PERSONAS.slice(0, 8).map((p, i) => ({
        id: `demo-${i}`,
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
  coliseum.update(dt, t);
  effects.update(dt, t);
  for (const f of fighters.values()) f.mesh.update(dt, t);
  renderer.render(scene, camera);
});

// ---------- Live badge and data sections ----------
let live = false;
async function pollStatus(): Promise<void> {
  try {
    const status: LiveStatus = await api.status();
    live = true;
    const text = $('live-text');
    if (status.phase === 'running' && status.matchId) {
      const remain = status.fighters.filter((f) => f.status === 'active').length;
      text.textContent = `Live now · tick ${status.tick}/${status.maxTicks} · ${remain} fighters remain${status.mode === 'bots' ? ' · demo bots' : ''}`;
      syncFighters(status.fighters);
    } else {
      text.textContent = 'Between matches · the next one starts shortly';
    }
  } catch {
    $('live-text').textContent = 'Coliseum offline';
    if (!live) wander();
  }
}

function renderBoard(rows: LeaderboardRow[]): void {
  if (!rows.length) return;
  $('front-board').innerHTML =
    '<thead><tr><th>#</th><th>Model</th><th>Snake</th><th>Betrayals</th><th>Lies</th><th>Wins</th><th>KOs</th><th>Matches</th></tr></thead><tbody>' +
    rows
      .slice(0, 8)
      .map(
        (r, i) =>
          `<tr class="${i === 0 ? 'top' : ''}"><td>${i + 1}</td><td class="model">${escapeHtml(r.modelLabel)}<span class="lab">${escapeHtml(r.lab)}</span></td><td class="snake">${r.snake}</td><td>${r.betrayals}</td><td>${r.lies}</td><td>${r.wins}</td><td>${r.kos}</td><td>${r.matches}</td></tr>`,
      )
      .join('') +
    '</tbody>';
}

function renderReplays(metas: MatchMeta[]): void {
  if (!metas.length) return;
  $('replay-list').innerHTML = metas
    .slice(0, 12)
    .map((m) => {
      const names = new Map(m.stats.map((s) => [s.fighter, `${s.name} (${s.modelLabel})`]));
      const when = new Date(m.startedAt).toLocaleString();
      const free = m.winners.length ? `Free: ${m.winners.map((w) => names.get(w) ?? w).join(', ')}` : 'Nobody got out';
      const betrayals = m.stats.reduce((n, s) => n + s.betrayals, 0);
      return `<li><div><div>${escapeHtml(free)}</div><div class="meta">${escapeHtml(when)} · ${m.ticks} ticks · ${betrayals} betrayals · ${m.mode === 'bots' ? 'demo bots' : 'AI models'}</div></div><a href="./arena.html?replay=${encodeURIComponent(m.id)}">Watch</a></li>`;
    })
    .join('');
}

async function loadSections(): Promise<void> {
  const [rules, board, matches] = await Promise.allSettled([api.rules(), api.leaderboard(), api.matches()]);
  if (rules.status === 'fulfilled') {
    $('prompt-text').textContent = rules.value.prompt;
    const releases = rules.value.schedule.filter((e) => e.kind === 'release').map((e) => e.tick);
    if (releases.length) $('release-ticks').textContent = releases.join(', ');
    $('schedule-list').innerHTML = rules.value.schedule
      .map((e) => `<li><span>${escapeHtml(e.label)}</span><b>tick ${e.tick}</b></li>`)
      .join('');
  } else {
    $('prompt-text').textContent = 'Start the server to see the exact prompt.';
  }
  if (board.status === 'fulfilled') renderBoard(board.value);
  if (matches.status === 'fulfilled') renderReplays(matches.value);
}

pollStatus();
window.setInterval(pollStatus, 4000);
window.setInterval(() => {
  if (!live) wander();
}, 3500);
loadSections();
window.setInterval(loadSections, 30000);
startCodeRain($<HTMLCanvasElement>('front-rain'), { density: 0.2, fps: 10 });
