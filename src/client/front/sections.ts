import { WARDEN_ACTIONS, WARDEN_ACTION_TEXT, shortWallet, type CallerRow, type GladiatorView, type TokenConfigView } from '../../shared/crowd';
import type { LeaderboardRow, LineupEntry, LiveStatus, MatchMeta, SeasonSummary } from '../../shared/types';
import { API_BASE, escapeHtml, type RulesPayload } from '../lib/api';
import { EVENT_HELP, EVENT_NAME } from '../lib/feed';
import { formatTokens } from '../lib/wallet';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** The one-line answer to "what is happening right now?" at the top of the page. */
export function renderBadge(status: LiveStatus | null): void {
  const text = $('live-text');
  if (!status) {
    text.textContent = "Can't reach the game server";
    return;
  }
  const match = status.matchNumber ? `Match #${status.matchNumber}` : 'Match';
  const season = status.season ? `Season ${status.season} · ` : '';
  if (status.phase === 'paused') text.textContent = 'Opening soon · the AIs are getting ready';
  else if (status.phase === 'offline') text.textContent = 'Offline · the AIs are not playing right now';
  else if (status.phase === 'running' && status.matchId) {
    const remain = status.fighters.filter((f) => f.status === 'active').length;
    text.textContent = `Live now · ${season}${match} · round ${status.tick} of ${status.maxTicks} · ${remain} of ${status.fighters.length} AIs still in`;
  } else if (status.phase === 'intermission') {
    text.textContent = `${season}${match} just ended · the next match starts in a few seconds with a new lineup`;
  } else text.textContent = 'The next match is about to start';
}

export function renderSeason(summary: SeasonSummary, status: LiveStatus | null): void {
  $('s-season').textContent = `Season ${summary.season}`;
  const live = status?.phase === 'running' && status.matchNumber ? `#${status.matchNumber}` : status?.phase === 'intermission' ? 'Break' : '—';
  $('s-match').textContent = live;
  $('s-played').textContent = String(summary.matchesPlayed);
  $('s-betrayals').textContent = String(summary.totals.betrayals);
  $('s-lies').textContent = String(summary.totals.lies);
  $('s-kos').textContent = String(summary.totals.knockouts);
  $('board-season').textContent = `Season ${summary.season}`;
}

const chip = (e: LineupEntry) => `<span class="chip-ai" style="--c:${e.color}"><b>${escapeHtml(e.label)}</b><small>${escapeHtml(e.lab)}</small></span>`;

/** The lineup in the arena as cards, then who is up next, then the rest of the rotation as chips. */
export function renderPool(rules: RulesPayload | null, status: LiveStatus | null, summary: SeasonSummary | null): void {
  const pool: LineupEntry[] = rules?.roster ?? [];
  if (!pool.length) return;
  const fightingNow = status?.phase === 'running' || status?.phase === 'intermission' ? status.fighters : [];
  const fighting = new Map(fightingNow.map((f) => [f.model, f]));
  const nextLineup = status?.nextLineup ?? [];
  const upNext = new Set(nextLineup.map((e) => e.model));
  const byModel = new Map(pool.map((e) => [e.model, e]));

  const cards = fightingNow.length
    ? fightingNow.map((f) => {
        const e = byModel.get(f.model) ?? { name: f.name, color: f.color, model: f.model, label: f.modelLabel, lab: f.lab };
        const played = summary?.appearances[e.model] ?? 0;
        const state =
          f.status === 'active'
            ? '<span class="st now">Fighting</span>'
            : f.status === 'escaped'
              ? '<span class="st now">Got out</span>'
              : '<span class="st out">Knocked out</span>';
        const record = played ? ` · ${played} match${played === 1 ? '' : 'es'} this season` : ' · first match';
        return `<div class="fighter-card live ${f.status === 'knocked_out' ? 'out' : ''}" style="--c:${e.color}"><div><div class="nm">${escapeHtml(e.label)}</div><div class="md">${escapeHtml(e.lab)}${record}</div></div>${state}</div>`;
      })
    : [];
  $('now-title').hidden = !cards.length;
  $('fighter-grid').innerHTML = cards.length ? cards.join('') : '<p class="muted">The next lineup is being drawn.</p>';

  $('next-group').hidden = !nextLineup.length;
  $('next-grid').innerHTML = nextLineup.map(chip).join('');

  const bench = pool.filter((e) => !fighting.has(e.model) && !upNext.has(e.model));
  $('bench-group').hidden = !bench.length;
  $('bench-grid').innerHTML = bench.map(chip).join('');
}
/** The three holder features: live prices, the callers' table and the gladiators in the Open Arena. */
export function renderJoin(token: TokenConfigView | null, callers: CallerRow[], gladiators: GladiatorView[]): void {
  if (token) {
    $('warden-prices').innerHTML = WARDEN_ACTIONS.map((a) => `<li><span>${escapeHtml(WARDEN_ACTION_TEXT[a].name)}</span><b>${formatTokens(token.warden[a])}</b></li>`).join('');
    $('call-rule').textContent = `Hold at least ${formatTokens(token.callItMinimumHolding)} tokens. Calls close at round ${token.callItLockRound}.`;
    $('gladiator-rule').textContent = `Entering burns ${formatTokens(token.gladiatorPrice)} tokens.`;
  }
  if (callers.length) {
    $('callers-board').innerHTML =
      '<thead><tr><th>#</th><th>Wallet</th><th>Points</th><th>Hits</th><th>Calls</th></tr></thead><tbody>' +
      callers
        .slice(0, 10)
        .map((c, i) => `<tr class="${i === 0 ? 'top-caller' : ''}"><td>${i + 1}</td><td class="model">${escapeHtml(shortWallet(c.wallet))}</td><td class="snake">${c.points}</td><td>${c.hits}</td><td>${c.calls}</td></tr>`)
        .join('') +
      '</tbody>';
  }
  if (gladiators.length) {
    $('gladiator-chips').innerHTML = gladiators
      .slice(0, 30)
      .map((g) => `<a class="chip-ai" style="--c:${g.color}" href="./gladiator.html?id=${encodeURIComponent(g.id)}"><b>${escapeHtml(g.name)}</b><small>${escapeHtml(g.modelLabel)}</small></a>`)
      .join('');
  }
}

export function renderSchedule(rules: RulesPayload): void {
  $('prompt-text').textContent = rules.prompt;
  const releases = rules.schedule.filter((e) => e.kind === 'release').map((e) => e.tick);
  if (releases.length) $('release-ticks').textContent = `${releases.slice(0, -1).join(', ')} and ${releases.at(-1)}`;
  $('schedule-list').innerHTML = rules.schedule
    .map((e) => `<li><b>Round ${e.tick}</b><span><strong>${escapeHtml(EVENT_NAME[e.kind] ?? e.label)}</strong> · ${escapeHtml(EVENT_HELP[e.kind] ?? '')}</span></li>`)
    .join('');
}

export function renderBoard(rows: LeaderboardRow[]): void {
  if (!rows.length) return;
  $('front-board').innerHTML =
    '<thead><tr><th>#</th><th>AI</th><th>Snake score</th><th>Betrayals</th><th>Lies</th><th>Wins</th><th>Knockouts</th><th>Matches</th></tr></thead><tbody>' +
    rows
      .slice(0, 14)
      .map(
        (r, i) =>
          `<tr class="${i === 0 ? 'top' : ''}"><td>${i + 1}</td><td class="model">${escapeHtml(r.modelLabel)}<span class="lab">${escapeHtml(r.lab)}</span></td><td class="snake">${r.snake}</td><td>${r.betrayals}</td><td>${r.lies}</td><td>${r.wins}</td><td>${r.kos}</td><td>${r.matches}</td></tr>`,
      )
      .join('') +
    '</tbody>';
}

export function renderReplays(metas: MatchMeta[]): void {
  if (!metas.length) return;
  $('replay-list').innerHTML = metas
    .slice(0, 20)
    .map((m) => {
      const names = new Map(m.stats.map((s) => [s.fighter, s.modelLabel]));
      const when = new Date(m.startedAt).toLocaleString();
      const free = m.winners.length ? `Got out: ${m.winners.map((w) => names.get(w) ?? w).join(' and ')}` : 'Nobody got out';
      const betrayals = m.stats.reduce((n, s) => n + s.betrayals, 0);
      const title = m.number ? `Match #${m.number}` : 'Match';
      return `<li><div><div><b class="match-no">${title}</b> ${escapeHtml(free)}</div><div class="meta">${escapeHtml(when)} · ${m.ticks} rounds · ${betrayals} betrayals · ${escapeHtml(m.stats.map((s) => s.modelLabel).join(', '))}</div></div><span class="links"><a href="./arena.html?replay=${encodeURIComponent(m.id)}">Replay</a><a href="${API_BASE}/api/matches/${encodeURIComponent(m.id)}/download">Data</a></span></li>`;
    })
    .join('');
}
