import type { ZoneInfo } from '../../shared/arena';
import type { CallerRow, CallPicks, CallWindow, GladiatorProfile, GladiatorView, TokenConfigView } from '../../shared/crowd';
import type {
  GameEvent,
  LeaderboardRow,
  LineupEntry,
  LiveStatus,
  MatchMeta,
  ScheduledEventView,
  SeasonSummary,
  ZoneId,
} from '../../shared/types';

export interface RulesPayload {
  prompt: string;
  schedule: ScheduledEventView[];
  rules: { releaseTicks?: number[] } & Record<string, unknown>;
  zones: Record<ZoneId, ZoneInfo>;
  perMatch?: number;
  /** Every model in the pool, not only the ones fighting now. */
  roster?: LineupEntry[];
}

/** A bare host like "x.up.railway.app" would be fetched as a path on this site, so it gets https:// added. */
export function apiBase(raw: unknown): string {
  const value = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** Where the game server lives. Empty means same origin; on Vercel, set VITE_API_URL to the Railway URL. */
export const API_BASE: string = apiBase(import.meta.env.VITE_API_URL);

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  status: () => get<LiveStatus>('/api/status'),
  leaderboard: () => get<LeaderboardRow[]>('/api/leaderboard'),
  matches: () => get<MatchMeta[]>('/api/matches'),
  match: (id: string) => get<{ events: GameEvent[] }>(`/api/matches/${encodeURIComponent(id)}`),
  rules: () => get<RulesPayload>('/api/rules'),
  season: () => get<SeasonSummary>('/api/season'),
  token: () => get<TokenConfigView>('/api/token'),
  blockhash: () => get<{ blockhash: string; lastValidBlockHeight: number }>('/api/chain/blockhash'),
  callWindow: () => get<CallWindow>('/api/calls/window'),
  callers: () => get<CallerRow[]>('/api/calls/leaderboard'),
  gladiators: () => get<GladiatorView[]>('/api/gladiators'),
  gladiator: (id: string) => get<GladiatorProfile>(`/api/gladiators/${encodeURIComponent(id)}`),
  payWarden: (signature: string) => post<{ action: string; target?: string; payer: string; burned: number }>('/api/warden', { signature }),
  submitCall: (body: { wallet: string; picks: CallPicks; signature: string }) => post<{ ok: true; match: number }>('/api/calls', body),
  createGladiator: (body: Record<string, string>) => post<GladiatorView>('/api/gladiators', body),
};

/** POSTs JSON and surfaces the server's own error message, which is written for the visitor. */
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function hpPips(hp: number, max: number): string {
  return '■'.repeat(Math.max(0, hp)) + '□'.repeat(Math.max(0, max - hp));
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
