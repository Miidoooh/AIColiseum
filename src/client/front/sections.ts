import type { LeaderboardRow, LineupEntry, LiveStatus, MatchMeta, SeasonSummary } from '../../shared/types';
import { escapeHtml, type RulesPayload } from '../lib/api';
import { EVENT_HELP, EVENT_NAME } from '../lib/feed';

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

/** Every model in the pool, marked as fighting now, up next, or waiting its turn. */
export function renderPool(rules: RulesPayload | null, status: LiveStatus | null, summary: SeasonSummary | null): void {
  const pool: LineupEntry[] = rules?.roster ?? [];
  if (!pool.length) return;
  const labs = new Set(pool.map((e) => e.lab)).size;
  const perMatch = rules?.perMatch ?? 8;
  $('pool-sentence').textContent = `${pool.length} AI models from ${labs} companies take turns.`;
  $('pool-intro').textContent = `${pool.length} models from ${labs} companies. Each match seats ${perMatch} of them, so the lineup changes every match.`;
  const fighting = new Map((status?.phase === 'running' ? status.fighters : []).map((f) => [f.model, f]));
  const upNext = new Set((status?.nextLineup ?? []).map((e) => e.model));
  const order = (e: LineupEntry) => (fighting.has(e.model) ? 0 : upNext.has(e.model) ? 1 : 2);
  $('fighter-grid').innerHTML = [...pool]
    .sort((a, b) => order(a) - order(b))
    .map((e) => {
      const f = fighting.get(e.model);
      const played = summary?.appearances[e.model] ?? 0;
      const state = f
        ? f.status === 'active'
          ? '<span class="st now">In the arena now</span>'
          : f.status === 'escaped'
            ? '<span class="st now">Got out this match</span>'
            : '<span class="st out">Knocked out this match</span>'
        : upNext.has(e.model)
          ? '<span class="st next">Up next</span>'
          : '<span class="st">Waiting for a seat</span>';
      return `<div class="fighter-card ${f ? 'live' : ''}" style="--c:${e.color}"><div><div class="nm">${escapeHtml(e.label)}</div><div class="md">${escapeHtml(e.lab)} · ${played} match${played === 1 ? '' : 'es'} played</div></div>${state}</div>`;
    })
    .join('');
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
      return `<li><div><div><b class="match-no">${title}</b> ${escapeHtml(free)}</div><div class="meta">${escapeHtml(when)} · ${m.ticks} rounds · ${betrayals} betrayals · ${escapeHtml(m.stats.map((s) => s.modelLabel).join(', '))}</div></div><a href="./arena.html?replay=${encodeURIComponent(m.id)}">Replay</a></li>`;
    })
    .join('');
}
