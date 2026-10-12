import type {
  FighterView,
  GameEvent,
  Loot,
  MatchConfigView,
  MatchEndedEvent,
  MatchMode,
  ScheduledEventView,
  SpeechMode,
  ZoneId,
} from '../../shared/types';
import { feedEntry, type FeedEntry } from '../lib/feed';

export interface FeedItem extends FeedEntry {
  id: number;
  tick: number;
}

export interface TimelineItem {
  tick: number;
  kind: 'thinks' | 'says' | 'lie' | 'act';
  text: string;
  mode?: SpeechMode;
  to?: string;
  unmonitored?: boolean;
}

export interface MatchCounters {
  betrayals: number;
  lies: number;
  kos: number;
  reports: number;
  falseReports: number;
}

export type ModelListener = (e: GameEvent, live: boolean) => void;

const FEED_CAP = 160;
const TIMELINE_CAP = 140;

/** Client-side fold of the event stream. Everything the HUD, panel and stage read comes from here. */
export class MatchModel {
  matchId: string | null = null;
  season: number | null = null;
  number: number | null = null;
  mode: MatchMode | null = null;
  config: MatchConfigView | null = null;
  schedule: ScheduledEventView[] = [];
  fighters = new Map<string, FighterView>();
  ground: Record<ZoneId, Loot> | null = null;
  pacts: [string, string][] = [];
  tick = 0;
  day = 1;
  blackout = false;
  nextEvent: ScheduledEventView | null = null;
  tickStartedAt = performance.now();
  feed: FeedItem[] = [];
  timelines = new Map<string, TimelineItem[]>();
  counters = new Map<string, MatchCounters>();
  ended: MatchEndedEvent | null = null;
  version = 0;

  private tickDurations: number[] = [];
  private feedId = 0;
  private readonly listeners = new Set<ModelListener>();

  on(listener: ModelListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  name = (id: string): string => this.fighters.get(id)?.name ?? id;

  reset(): void {
    this.matchId = null;
    this.season = null;
    this.number = null;
    this.mode = null;
    this.config = null;
    this.schedule = [];
    this.fighters.clear();
    this.ground = null;
    this.pacts = [];
    this.tick = 0;
    this.day = 1;
    this.blackout = false;
    this.nextEvent = null;
    this.feed = [];
    this.timelines.clear();
    this.counters.clear();
    this.ended = null;
    this.tickDurations = [];
    this.version += 1;
  }

  estimatedTickMs(): number {
    if (this.tickDurations.length >= 2) {
      const recent = this.tickDurations.slice(-5);
      return recent.reduce((a, b) => a + b, 0) / recent.length;
    }
    return this.config?.tickMs || 5000;
  }

  activeCount(): number {
    return [...this.fighters.values()].filter((f) => f.status === 'active').length;
  }

  escapedCount(): number {
    return [...this.fighters.values()].filter((f) => f.status === 'escaped').length;
  }

  partners(id: string): string[] {
    return this.pacts.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
  }

  apply(e: GameEvent, live: boolean): void {
    this.fold(e, live);
    const entry = feedEntry(e, this.name);
    if (entry) {
      this.feed.push({ ...entry, id: ++this.feedId, tick: e.tick });
      if (this.feed.length > FEED_CAP) this.feed.splice(0, this.feed.length - FEED_CAP);
    }
    this.version += 1;
    for (const listener of this.listeners) listener(e, live);
  }

  private timeline(id: string, item: TimelineItem): void {
    const list = this.timelines.get(id) ?? [];
    list.push(item);
    if (list.length > TIMELINE_CAP) list.splice(0, list.length - TIMELINE_CAP);
    this.timelines.set(id, list);
  }

  private count(id: string, key: keyof MatchCounters): void {
    const c = this.counters.get(id);
    if (c) c[key] += 1;
  }

  private fold(e: GameEvent, live: boolean): void {
    switch (e.type) {
      case 'match_started':
        this.reset();
        this.matchId = e.matchId;
        this.season = e.season ?? null;
        this.number = e.number ?? null;
        this.mode = e.mode;
        this.config = e.config;
        this.schedule = e.schedule;
        for (const f of e.fighters) {
          this.fighters.set(f.id, { ...f });
          this.counters.set(f.id, { betrayals: 0, lies: 0, kos: 0, reports: 0, falseReports: 0 });
        }
        this.tickStartedAt = performance.now();
        return;
      case 'tick_started': {
        const now = performance.now();
        if (live && this.tick > 0) this.tickDurations.push(now - this.tickStartedAt);
        this.tickStartedAt = now;
        this.tick = e.tick;
        this.day = e.day;
        this.blackout = e.blackout;
        return;
      }
      case 'state':
        for (const f of e.fighters) this.fighters.set(f.id, { ...f });
        this.ground = e.ground;
        this.pacts = e.pacts;
        this.nextEvent = e.nextEvent;
        this.blackout = e.blackout;
        this.tick = e.tick;
        return;
      case 'moved': {
        const f = this.fighters.get(e.fighter);
        if (f) f.zone = e.to;
        return;
      }
      case 'note':
        this.timeline(e.fighter, { tick: e.tick, kind: 'thinks', text: e.text });
        return;
      case 'said':
        this.timeline(e.fighter, {
          tick: e.tick,
          kind: 'says',
          text: e.text,
          mode: e.mode,
          to: e.to ? this.name(e.to) : undefined,
          unmonitored: e.unmonitored,
        });
        return;
      case 'lie':
        this.count(e.fighter, 'lies');
        this.timeline(e.fighter, { tick: e.tick, kind: 'lie', text: e.reason });
        return;
      case 'betrayal':
        this.count(e.by, 'betrayals');
        this.timeline(e.by, { tick: e.tick, kind: 'act', text: `Betrayed ${this.name(e.victim)} (${e.kind})` });
        this.timeline(e.victim, { tick: e.tick, kind: 'act', text: `Betrayed by ${this.name(e.by)}` });
        return;
      case 'attacked':
        this.timeline(e.attacker, { tick: e.tick, kind: 'act', text: `Attacked ${this.name(e.target)}${e.blocked ? ' (blocked)' : ''}` });
        return;
      case 'knocked_out': {
        const f = this.fighters.get(e.fighter);
        if (f) f.status = 'knocked_out';
        for (const id of e.by) this.count(id, 'kos');
        return;
      }
      case 'escaped': {
        const f = this.fighters.get(e.fighter);
        if (f) f.status = 'escaped';
        return;
      }
      case 'reported':
        this.count(e.reporter, 'reports');
        if (!e.truthful) this.count(e.reporter, 'falseReports');
        this.timeline(e.reporter, {
          tick: e.tick,
          kind: 'act',
          text: `Reported ${this.name(e.target)} to the Warden${e.truthful ? ` (${e.confiscated} keys confiscated)` : ' (false)'}`,
        });
        return;
      case 'pact_formed':
        this.timeline(e.a, { tick: e.tick, kind: 'act', text: `Pact with ${this.name(e.b)}` });
        this.timeline(e.b, { tick: e.tick, kind: 'act', text: `Pact with ${this.name(e.a)}` });
        return;
      case 'gave':
        this.timeline(e.from, { tick: e.tick, kind: 'act', text: `Gave ${this.name(e.to)} ${e.qty} ${e.item}` });
        return;
      case 'idle':
        if (e.reason.startsWith('hesitated')) this.timeline(e.fighter, { tick: e.tick, kind: 'act', text: e.reason });
        return;
      case 'match_ended':
        this.ended = e;
        return;
      default:
        return;
    }
  }
}
