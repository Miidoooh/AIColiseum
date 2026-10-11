import type { ZoneInfo } from '../../shared/arena';
import type { GameEvent, LeaderboardRow, LiveStatus, MatchMeta, ScheduledEventView, ZoneId } from '../../shared/types';

export interface RulesPayload {
  prompt: string;
  schedule: ScheduledEventView[];
  rules: { releaseTicks?: number[] } & Record<string, unknown>;
  zones: Record<ZoneId, ZoneInfo>;
}

/** Where the game server lives. Empty means same origin; on Vercel, set VITE_API_URL to the Railway URL. */
export const API_BASE: string = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

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
};

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
