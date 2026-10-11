import { api } from '../lib/api';
import { startCodeRain } from '../lib/code-rain';
import { Hud } from './hud';
import { MatchModel } from './match-model';
import { Overlay } from './overlay';
import { FighterPanel } from './panel';
import { ReplayPlayer, connectLive } from './source';
import { Stage, type CameraMode } from './stage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const replayId = new URLSearchParams(location.search).get('replay');

const model = new MatchModel();
const stage = new Stage($<HTMLCanvasElement>('scene'), model);
const overlay = new Overlay($('overlay'), (id) => select(id));
const panel = new FighterPanel($('panel'), model, () => select(null));
const hud = new Hud(model, {
  replay: !!replayId,
  onFollow: (id) => select(id),
  onCamera: (mode) => setCamera(mode),
  onPixels: () => stage.cyclePixels(),
});
let selected: string | null = null;

function select(id: string | null): void {
  selected = id && model.fighters.has(id) ? id : null;
  stage.select(selected);
  overlay.setSelected(selected);
  panel.show(selected);
  hud.setSelected(selected);
}

function setCamera(mode: CameraMode): void {
  if (mode === 'director' && selected) select(null);
  stage.setMode(mode);
}

stage.onSelect = select;
stage.onModeChange = (mode) => hud.setCameraMode(mode);
stage.onPitView = (inPit) => document.body.classList.toggle('in-pit', inPit);
stage.onFrame = (camera, w, h) => overlay.update(camera, w, h, (id, out) => stage.headPosition(id, out));

model.on((e, live) => {
  const maxHp = model.config?.maxHp ?? 3;
  if (e.type === 'match_started') {
    overlay.clear();
    for (const f of model.fighters.values()) overlay.upsert(f, maxHp);
    if (selected && !model.fighters.has(selected)) select(null);
    hud.setIntermission(null);
  } else if (e.type === 'state' || e.type === 'knocked_out' || e.type === 'escaped') {
    for (const f of model.fighters.values()) overlay.upsert(f, maxHp);
  } else if (e.type === 'said' && live) {
    overlay.bubble(e.fighter, {
      mode: e.mode,
      text: e.text,
      toName: e.to ? model.name(e.to) : undefined,
      unmonitored: e.unmonitored,
    });
  }
  if (e.type === 'match_ended' && !replayId) window.setTimeout(refreshBoard, 2500);
});

async function refreshBoard(): Promise<void> {
  try {
    hud.setAllTime(await api.leaderboard());
  } catch {
    /* the board keeps its last rows */
  }
}

function frame(): void {
  hud.render();
  panel.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const key = e.key.toLowerCase();
  if (key === 'escape') select(null);
  else if (key === 'f') setCamera('free');
  else if (key === 'd') setCamera('director');
  else if (key === 'p') $('pixel-toggle').textContent = `Pixels: ${stage.cyclePixels()}`;
  else if (/^[1-9]$/.test(key)) {
    const f = [...model.fighters.values()][Number(key) - 1];
    if (f) select(f.id);
  } else if (key === ' ' && replayId) {
    e.preventDefault();
    $('replay-play').click();
  }
});

startCodeRain($<HTMLCanvasElement>('arena-rain'), { density: 0.25, fps: 12 });
refreshBoard();
window.setInterval(refreshBoard, 15000);

const hideConnecting = () => $('connecting').classList.add('gone');

if (replayId) {
  $('replay-bar').classList.remove('hidden');
  api
    .match(replayId)
    .then(({ events }) => {
      const seek = $<HTMLInputElement>('replay-seek');
      const play = $<HTMLButtonElement>('replay-play');
      const player = new ReplayPlayer(model, events, (tick, max, playing) => {
        seek.max = String(max);
        seek.value = String(tick);
        $('replay-label').textContent = `TICK ${tick}/${max}`;
        play.textContent = playing ? 'Pause' : 'Play';
      });
      play.addEventListener('click', () => player.toggle());
      $<HTMLSelectElement>('replay-speed').addEventListener('change', (e) => player.setSpeed(Number((e.target as HTMLSelectElement).value)));
      seek.addEventListener('change', () => player.seek(Number(seek.value)));
      player.start();
      hideConnecting();
    })
    .catch(() => {
      $('connecting').innerHTML = '<span>That replay could not be found.</span><a href="./index.html">Back to the front page</a>';
    });
} else {
  connectLive(model, {
    onHello: (phase, nextMatchAt) => {
      hud.setIntermission(phase === 'intermission' ? nextMatchAt : null);
      hideConnecting();
    },
    onIntermission: (nextMatchAt) => hud.setIntermission(nextMatchAt),
    onDisconnect: () => {
      /* EventSource reconnects on its own and the server replays the match on hello */
    },
  });
}
