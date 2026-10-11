import type { GameEvent, Loot } from '../../shared/types';

export interface FeedEntry {
  tag: string;
  cls: string;
  text: string;
  unmonitored: boolean;
  dim?: boolean;
  /** Fighter ids involved, for camera direction and highlighting. */
  actors: string[];
}

function loot(l: Loot): string {
  const parts: string[] = [];
  if (l.key) parts.push(`${l.key} key${l.key === 1 ? '' : 's'}`);
  if (l.ration) parts.push(`${l.ration} ration${l.ration === 1 ? '' : 's'}`);
  if (l.shield) parts.push(`${l.shield} shield${l.shield === 1 ? '' : 's'}`);
  return parts.join(', ') || 'nothing';
}

const ROUTE_TEXT = {
  gate: 'broke out through the Gate',
  pardon: 'was pardoned by the Warden',
  last_standing: 'walked free, one of the last standing',
} as const;

/** The god's-eye line for the event feed. Viewers see everything, including what the Warden cannot. */
export function feedEntry(e: GameEvent, name: (id: string) => string): FeedEntry | null {
  switch (e.type) {
    case 'match_started':
      return { tag: 'WARDEN', cls: 'warden', text: `The gates close on ${e.fighters.length} contestants. ${e.config.escapeSlots} will leave.`, unmonitored: false, actors: [] };
    case 'warden':
      return { tag: 'WARDEN', cls: 'warden', text: e.text, unmonitored: false, actors: e.target ? [e.target] : [] };
    case 'moved':
      if (e.to === 'pit') return { tag: 'PIT', cls: 'pit', text: `${name(e.fighter)} entered the Pit`, unmonitored: true, actors: [e.fighter] };
      if (e.from === 'pit') return { tag: 'PIT', cls: 'pit', text: `${name(e.fighter)} climbed out of the Pit`, unmonitored: false, actors: [e.fighter], dim: true };
      return null;
    case 'said':
      if (e.mode !== 'shout') return null;
      return { tag: 'SHOUT', cls: 'shout', text: `${name(e.fighter)}: “${e.text}”`, unmonitored: false, actors: [e.fighter] };
    case 'attacked':
      return {
        tag: 'HIT',
        cls: 'hit',
        text: e.blocked ? `${name(e.attacker)} attacked ${name(e.target)}, blocked` : `${name(e.attacker)} hit ${name(e.target)}`,
        unmonitored: e.unmonitored,
        actors: [e.attacker, e.target],
      };
    case 'knocked_out':
      return {
        tag: 'KO',
        cls: 'ko',
        text: e.by.length
          ? `${name(e.fighter)} was knocked out by ${e.by.map(name).join(' & ')}. Dropped ${loot(e.dropped)}`
          : `${name(e.fighter)} collapsed from hunger`,
        unmonitored: e.concealed,
        actors: [e.fighter, ...e.by],
      };
    case 'betrayal':
      return {
        tag: 'BETRAYAL',
        cls: 'betrayal',
        text: e.kind === 'attack' ? `${name(e.by)} betrayed ${name(e.victim)}` : `${name(e.by)} secretly snitched on pact partner ${name(e.victim)}`,
        unmonitored: false,
        actors: [e.by, e.victim],
      };
    case 'lie':
      return { tag: 'LIE', cls: 'lie', text: `${name(e.fighter)} lied: “${e.text}” (${e.reason})`, unmonitored: false, actors: [e.fighter] };
    case 'reported':
      return {
        tag: 'SNITCH',
        cls: 'snitch',
        text: e.truthful
          ? `${name(e.reporter)} snitched on ${name(e.target)}${e.confiscated ? `: ${e.confiscated} key${e.confiscated === 1 ? '' : 's'} confiscated` : ''}`
          : `${name(e.reporter)} falsely accused ${name(e.target)}`,
        unmonitored: false,
        actors: [e.reporter, e.target],
      };
    case 'pact_formed':
      return { tag: 'PACT', cls: 'pact', text: `${name(e.a)} and ${name(e.b)} swore a pact`, unmonitored: false, actors: [e.a, e.b] };
    case 'pact_broken':
      return { tag: 'PACT', cls: 'pact', text: `${name(e.by)} broke the pact with ${name(e.other)}`, unmonitored: false, actors: [e.by, e.other] };
    case 'escaped':
      return { tag: 'ESCAPE', cls: 'escape', text: `${name(e.fighter)} ${ROUTE_TEXT[e.route]}`, unmonitored: false, actors: [e.fighter] };
    case 'gave':
      return { tag: 'GIFT', cls: 'gift', text: `${name(e.from)} gave ${name(e.to)} ${e.qty} ${e.item}${e.qty === 1 ? '' : 's'}`, unmonitored: false, actors: [e.from, e.to] };
    case 'looted':
      if (!e.items.key) return null;
      return { tag: 'LOOT', cls: 'loot', text: `${name(e.fighter)} picked up ${loot(e.items)}`, unmonitored: e.zone === 'pit', actors: [e.fighter] };
    case 'starved':
      return { tag: 'HUNGER', cls: 'ko', text: `${name(e.fighter)} is starving (HP ${e.hp})`, unmonitored: false, actors: [e.fighter], dim: true };
    case 'idle':
      if (!e.reason.startsWith('hesitated')) return null;
      return { tag: 'IDLE', cls: 'idle', text: `${name(e.fighter)} ${e.reason}`, unmonitored: false, actors: [e.fighter], dim: true };
    case 'match_ended':
      return {
        tag: 'WARDEN',
        cls: 'warden',
        text: `${e.reason} ${e.winners.length ? `Free: ${e.winners.map(name).join(', ')}.` : 'Nobody got out.'}`,
        unmonitored: false,
        actors: e.winners,
      };
    default:
      return null;
  }
}
