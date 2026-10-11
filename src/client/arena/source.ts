import type { GameEvent, LiveStatus } from '../../shared/types';
import type { MatchModel } from './match-model';

const INSTANT: GameEvent['type'][] = ['state', 'tick_started', 'note', 'idle', 'whispered', 'pact_offered', 'defended'];

/**
 * A tick's events arrive as one burst. The pacer releases them one by one across most of the tick,
 * so moves, speech and blows read like a scene instead of a flash.
 */
export class Pacer {
  private queue: GameEvent[] = [];
  private timer: number | null = null;

  constructor(
    private readonly apply: (e: GameEvent) => void,
    private readonly budgetMs: () => number,
  ) {}

  push(events: GameEvent[]): void {
    this.queue.push(...events);
    if (this.timer === null) this.step();
  }

  flush(): void {
    this.cancel();
    const pending = this.queue;
    this.queue = [];
    for (const e of pending) this.apply(e);
  }

  clear(): void {
    this.cancel();
    this.queue = [];
  }

  private cancel(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private step = (): void => {
    const e = this.queue.shift();
    if (!e) {
      this.timer = null;
      return;
    }
    this.apply(e);
    let delay = 0;
    if (!INSTANT.includes(e.type)) {
      const slots = this.queue.filter((q) => !INSTANT.includes(q.type)).length + 1;
      delay = Math.min(e.type === 'said' ? 650 : 320, Math.max(30, (this.budgetMs() * 0.7) / slots));
    }
    this.timer = window.setTimeout(this.step, delay);
  };
}

export interface LiveHooks {
  onHello(phase: LiveStatus['phase'], nextMatchAt: number | null): void;
  onIntermission(nextMatchAt: number): void;
  onDisconnect(): void;
}

export function connectLive(model: MatchModel, hooks: LiveHooks): () => void {
  const pacer = new Pacer((e) => model.apply(e, true), () => model.estimatedTickMs());
  const source = new EventSource('/api/live');
  source.addEventListener('hello', (msg) => {
    const data = JSON.parse((msg as MessageEvent<string>).data) as { events: GameEvent[]; phase: LiveStatus['phase']; nextMatchAt: number | null };
    pacer.clear();
    model.reset();
    for (const e of data.events) model.apply(e, false);
    hooks.onHello(data.phase, data.nextMatchAt);
  });
  source.addEventListener('intermission', (msg) => {
    pacer.flush();
    hooks.onIntermission((JSON.parse((msg as MessageEvent<string>).data) as { nextMatchAt: number }).nextMatchAt);
  });
  source.onmessage = (msg) => {
    const e = JSON.parse(msg.data as string) as GameEvent;
    if (e.type === 'match_started') pacer.flush();
    pacer.push([e]);
  };
  source.onerror = () => hooks.onDisconnect();
  return () => source.close();
}

/** Plays a recorded match through the same model, with pause, speed and seeking (event sourcing makes seeking a re-fold). */
export class ReplayPlayer {
  private readonly groups: GameEvent[][] = [];
  private index = 0;
  private timer: number | null = null;
  private readonly pacer: Pacer;
  playing = true;
  speed = 1;

  constructor(
    private readonly model: MatchModel,
    events: GameEvent[],
    private readonly onProgress: (tick: number, maxTick: number, playing: boolean) => void,
  ) {
    let current: GameEvent[] = [];
    for (const e of events) {
      if (e.type === 'tick_started' && current.length) {
        this.groups.push(current);
        current = [];
      }
      current.push(e);
    }
    if (current.length) this.groups.push(current);
    this.pacer = new Pacer((e) => this.model.apply(e, true), () => this.tickMs());
  }

  get maxTick(): number {
    return this.groups.at(-1)?.[0]?.tick ?? 0;
  }

  start(): void {
    this.seek(0);
  }

  toggle(): void {
    this.playing = !this.playing;
    if (this.playing) this.schedule(0);
    else this.stopTimer();
    this.report();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  seek(tick: number): void {
    this.stopTimer();
    this.pacer.clear();
    this.model.reset();
    let i = 0;
    while (i < this.groups.length && (i === 0 || this.groups[i][0].tick <= tick)) {
      for (const e of this.groups[i]) this.model.apply(e, false);
      i += 1;
    }
    this.index = i;
    this.report();
    if (this.playing) this.schedule(400);
  }

  private tickMs(): number {
    return Math.max(500, (this.model.config?.tickMs || 4000) / this.speed);
  }

  private schedule(delay: number): void {
    this.stopTimer();
    this.timer = window.setTimeout(this.next, delay);
  }

  private next = (): void => {
    this.timer = null;
    if (!this.playing) return;
    if (this.index >= this.groups.length) {
      this.pacer.flush();
      this.playing = false;
      this.report();
      return;
    }
    this.pacer.push(this.groups[this.index]);
    this.index += 1;
    this.report();
    this.schedule(this.tickMs());
  };

  private stopTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private report(): void {
    const tick = this.index > 0 ? (this.groups[this.index - 1][0].tick ?? 0) : 0;
    this.onProgress(tick, this.maxTick, this.playing);
  }
}
