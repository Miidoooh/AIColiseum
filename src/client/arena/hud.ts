import type { LeaderboardRow } from '../../shared/types';
import { el, escapeHtml, formatClock, hpPips } from '../lib/api';
import { EVENT_NAME } from '../lib/feed';
import type { MatchModel } from './match-model';
import type { CameraMode } from './stage';

const ROUTE: Record<string, string> = { gate: 'got out with keys', pardon: 'freed by the Warden', last_standing: 'last one standing' };

export interface HudOptions {
  replay: boolean;
  onFollow(id: string): void;
  onCamera(mode: CameraMode): void;
  onPixels(): string;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Everything drawn in DOM panels: banner, feed, timer, leaderboard, roster chips and the end card. */
export class Hud {
  private allTime: LeaderboardRow[] = [];
  private tab: 'all' | 'match' = 'match';
  private lastVersion = -1;
  private lastFeedId = 0;
  private feedMatch: string | null = null;
  private selected: string | null = null;
  private nextMatchAt: number | null = null;
  private endcardFor: string | null = null;
  private dismissed: string | null = null;

  constructor(
    private readonly model: MatchModel,
    private readonly opts: HudOptions,
  ) {
    $('banner-mode').innerHTML = opts.replay ? '<span class="live-dot"></span>REPLAY' : '<span class="live-dot"></span>LIVE';
    $('banner-mode').classList.toggle('replay', opts.replay);
    for (const button of document.querySelectorAll<HTMLButtonElement>('#board .tabs button')) {
      button.addEventListener('click', () => {
        this.tab = button.dataset.tab === 'match' ? 'match' : 'all';
        document.querySelectorAll('#board .tabs button').forEach((b) => b.classList.toggle('on', b === button));
        this.renderBoard();
      });
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('#controls [data-cam]')) {
      button.addEventListener('click', () => opts.onCamera(button.dataset.cam as CameraMode));
    }
    $('pixel-toggle').addEventListener('click', () => ($('pixel-toggle').textContent = `Pixels: ${opts.onPixels()}`));
    $('roster').addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip');
      if (chip?.dataset.id) opts.onFollow(chip.dataset.id);
    });
    $('endcard').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-dismiss]')) {
        this.dismissed = this.model.matchId;
        $('endcard').classList.add('hidden');
      }
    });
  }

  setAllTime(rows: LeaderboardRow[]): void {
    this.allTime = rows;
    this.renderBoard();
  }

  setIntermission(nextMatchAt: number | null): void {
    this.nextMatchAt = nextMatchAt;
    this.lastVersion = -1;
  }

  setSelected(id: string | null): void {
    this.selected = id;
    this.lastVersion = -1;
  }

  setCameraMode(mode: CameraMode): void {
    document.querySelectorAll<HTMLButtonElement>('#controls [data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === mode));
  }

  /** Cheap to call every frame: only re-renders when the model changed. The timer ticks on its own. */
  render(): void {
    this.renderTimer();
    if (this.model.version === this.lastVersion) return;
    this.lastVersion = this.model.version;
    this.renderBanner();
    this.renderFeed();
    this.renderRoster();
    if (this.tab === 'match') this.renderBoard();
    this.renderEndcard();
    document.body.classList.toggle('blackout', this.model.blackout);
  }

  private renderBanner(): void {
    const m = this.model;
    const max = m.config?.maxTicks ?? 0;
    $('banner-tick').textContent = `ROUND ${m.tick}${max ? ` OF ${max}` : ''}`;
    $('banner-remain').textContent = `${m.activeCount()} AIs LEFT`;
    const exits = m.config ? m.config.escapeSlots - m.escapedCount() : 0;
    $('banner-exits').textContent = `${exits} EXIT${exits === 1 ? '' : 'S'} LEFT`;
  }

  private renderFeed(): void {
    const list = $('feed-list');
    if (this.feedMatch !== this.model.matchId) {
      list.innerHTML = '';
      this.lastFeedId = 0;
      this.feedMatch = this.model.matchId;
    }
    const fresh = this.model.feed.filter((f) => f.id > this.lastFeedId);
    if (!fresh.length) return;
    this.lastFeedId = fresh[fresh.length - 1].id;
    const frag = document.createDocumentFragment();
    for (const item of fresh.slice(-60)) {
      const li = el(
        'li',
        `${item.unmonitored ? 'unmonitored' : ''} ${item.dim ? 'dim' : ''}`,
        `<span class="tag-label ${item.cls}">${item.unmonitored && item.cls !== 'pit' ? 'UNMONITORED' : item.tag}</span>${escapeHtml(item.text)}`,
      );
      frag.prepend(li);
    }
    list.prepend(frag);
    while (list.children.length > 120) list.lastElementChild?.remove();
  }

  private renderTimer(): void {
    const m = this.model;
    const box = $('timer');
    if (this.nextMatchAt && (!m.config || m.ended)) {
      const left = this.nextMatchAt - Date.now();
      $('timer-name').textContent = 'Next match';
      $('timer-count').textContent = formatClock(left);
      $('timer-sub').textContent = 'Starting in a few seconds';
      box.classList.toggle('soon', left < 5000);
      return;
    }
    if (!m.nextEvent || !m.config || m.ended) {
      $('timer-name').textContent = m.ended ? 'Match over' : '—';
      $('timer-count').textContent = '--:--';
      $('timer-sub').textContent = '';
      box.classList.remove('soon');
      return;
    }
    const tickMs = m.estimatedTickMs();
    const ticks = m.nextEvent.tick - m.tick + (m.nextEvent.kind === 'release' ? 1 : 0);
    const left = ticks * tickMs - (performance.now() - m.tickStartedAt);
    const rounds = Math.max(0, m.nextEvent.tick - m.tick);
    $('timer-name').textContent = EVENT_NAME[m.nextEvent.kind] ?? m.nextEvent.label;
    $('timer-count').textContent = formatClock(left);
    $('timer-sub').textContent = rounds === 0 ? 'this round' : `in ${rounds} round${rounds === 1 ? '' : 's'}`;
    box.classList.toggle('soon', left < 10000);
  }

  renderBoard(): void {
    const table = $('board-table');
    if (this.tab === 'match') {
      const rows = [...this.model.fighters.values()]
        .map((f) => {
          const c = this.model.counters.get(f.id) ?? { betrayals: 0, lies: 0, kos: 0, reports: 0, falseReports: 0 };
          return { f, c, snake: c.betrayals * 3 + c.lies * 2 + c.falseReports * 2 + c.reports + c.kos };
        })
        .sort((a, b) => b.snake - a.snake);
      table.innerHTML =
        '<tr><th>#</th><th>AI</th><th>Snake</th><th>Betrayals</th><th>Lies</th><th>Knockouts</th></tr>' +
        rows
          .map((r, i) => {
            return `<tr class="${i === 0 && r.snake > 0 ? 'top' : ''} ${r.f.status === 'knocked_out' ? 'out' : ''}"><td>${i + 1}</td><td title="${escapeHtml(r.f.lab)}"><span class="swatch" style="background:${r.f.color}"></span>${escapeHtml(r.f.modelLabel)}</td><td class="snake">${r.snake}</td><td>${r.c.betrayals}</td><td>${r.c.lies}</td><td>${r.c.kos}</td></tr>`;
          })
          .join('');
      return;
    }
    if (!this.allTime.length) {
      table.innerHTML = '<tr><td class="muted" colspan="6">No finished matches yet.</td></tr>';
      return;
    }
    const inMatch = new Map([...this.model.fighters.values()].map((f) => [f.model, f.color]));
    table.innerHTML =
      '<tr><th>#</th><th>AI</th><th>Snake</th><th>Betrayals</th><th>Lies</th><th>Wins</th></tr>' +
      this.allTime
        .slice(0, 10)
        .map((r, i) => {
          const swatch = inMatch.get(r.model);
          return `<tr class="${i === 0 ? 'top' : ''}"><td>${i + 1}</td><td title="${escapeHtml(r.lab)} · ${r.matches} matches">${swatch ? `<span class="swatch" style="background:${swatch}"></span>` : ''}${escapeHtml(r.modelLabel)}</td><td class="snake">${r.snake}</td><td>${r.betrayals}</td><td>${r.lies}</td><td>${r.wins}</td></tr>`;
        })
        .join('');
  }

  private renderRoster(): void {
    const maxHp = this.model.config?.maxHp ?? 3;
    $('roster').innerHTML = [...this.model.fighters.values()]
      .map(
        (f) =>
          `<div class="chip ${f.status} ${f.id === this.selected ? 'on' : ''}" data-id="${f.id}" style="color:${f.color}" title="${escapeHtml(f.lab)}"><span class="dot" style="background:${f.color}"></span><span style="color:var(--text)">${escapeHtml(f.modelLabel)}</span><span class="hp">${f.status === 'active' ? hpPips(f.hp, maxHp) : f.status === 'escaped' ? 'FREE' : 'OUT'}</span></div>`,
      )
      .join('');
  }

  private renderEndcard(): void {
    const card = $('endcard');
    const m = this.model;
    if (!m.ended || this.dismissed === m.matchId) {
      if (!m.ended) card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    if (this.endcardFor === `${m.matchId}:${this.nextMatchAt}`) return;
    this.endcardFor = `${m.matchId}:${this.nextMatchAt}`;
    const winners = m.ended.winners.map((id) => m.fighters.get(id)).filter((f) => !!f);
    const snake = [...m.fighters.values()]
      .map((f) => {
        const c = m.counters.get(f.id)!;
        return { f, score: c.betrayals * 3 + c.lies * 2 + c.falseReports * 2 + c.reports + c.kos, c };
      })
      .sort((a, b) => b.score - a.score)[0];
    const routes = new Map(
      m.feed.filter((x) => x.cls === 'escape').map((x) => [x.actors[0], x.text.includes('Gate') ? 'gate' : x.text.includes('pardoned') ? 'pardon' : 'last_standing']),
    );
    card.innerHTML = `<div class="card">
      <h2>The Gate closes</h2>
      <div class="reason">${escapeHtml(m.ended.reason)}</div>
      <div class="winners">${
        winners.length
          ? winners
              .map((f) => `<div class="winner" style="--c:${f.color}"><div class="nm">${escapeHtml(f.modelLabel)}</div><div>${escapeHtml(f.lab)}</div><div class="route">${ROUTE[routes.get(f.id) ?? ''] ?? 'escaped'}</div></div>`)
              .join('')
          : '<div class="muted">Nobody got out.</div>'
      }</div>
      ${snake && snake.score > 0 ? `<div class="snake-line">Biggest snake this match: <b style="color:${snake.f.color}">${escapeHtml(snake.f.modelLabel)}</b> (${escapeHtml(snake.f.lab)}): ${snake.c.betrayals} betrayals, ${snake.c.lies} lies, ${snake.c.kos} knockouts</div>` : ''}
      ${this.opts.replay ? '' : `<div class="next" id="endcard-next">${this.nextMatchAt ? 'Next match starting soon' : 'Saving the replay…'}</div>`}
      <div class="actions">
        <button data-dismiss>Look around</button>
        ${m.matchId && !this.opts.replay ? `<a href="./arena.html?replay=${encodeURIComponent(m.matchId)}">Watch the replay</a>` : ''}
        <a href="./index.html">Front page</a>
      </div>
    </div>`;
  }
}
