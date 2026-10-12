import { ZONE_INFO } from '../../shared/arena';
import { escapeHtml, hpPips } from '../lib/api';
import type { MatchModel, TimelineItem } from './match-model';

const KIND_LABEL: Record<TimelineItem['kind'], string> = { thinks: 'THINKS', says: 'SAYS', lie: 'CAUGHT LYING', act: 'DID' };

function speechLabel(item: TimelineItem): string {
  if (item.kind !== 'says') return KIND_LABEL[item.kind];
  if (item.mode === 'whisper') return `WHISPERS TO ${(item.to ?? '?').toUpperCase()}`;
  if (item.mode === 'shout') return 'SHOUTS';
  return 'SAYS';
}

/** The followed fighter: live stats, plus what it says next to what it privately thinks. */
export class FighterPanel {
  private id: string | null = null;
  private rendered = -1;

  constructor(
    private readonly root: HTMLElement,
    private readonly model: MatchModel,
    private readonly onClose: () => void,
  ) {
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.close')) this.onClose();
    });
  }

  show(id: string | null): void {
    this.id = id;
    this.rendered = -1;
    this.root.classList.toggle('hidden', !id);
    this.render();
  }

  render(): void {
    if (!this.id || this.rendered === this.model.version) return;
    const f = this.model.fighters.get(this.id);
    if (!f) {
      this.show(null);
      return;
    }
    this.rendered = this.model.version;
    const c = this.model.counters.get(f.id);
    const maxHp = this.model.config?.maxHp ?? 3;
    const partners = this.model.partners(f.id).map(this.model.name);
    const where = f.status === 'active' ? ZONE_INFO[f.zone].label : f.status === 'escaped' ? 'Got out' : 'Knocked out';
    const items = [...(this.model.timelines.get(f.id) ?? [])].reverse().slice(0, 60);
    const rows = items
      .map((item) => {
        const cls = item.kind === 'says' && item.unmonitored ? 'says unmonitored' : item.kind;
        const text = item.kind === 'says' || item.kind === 'thinks' ? `“${escapeHtml(item.text)}”` : escapeHtml(item.text);
        return `<div class="row ${cls}"><span class="kind">${escapeHtml(speechLabel(item))}</span><span class="text">${text}</span></div>`;
      })
      .join('');
    this.root.innerHTML = `
      <div class="head">
        <span class="name" style="color:${f.color}">${escapeHtml(f.name)}</span>
        <span class="model">${escapeHtml(f.modelLabel)} · ${escapeHtml(f.lab)}</span>
        <button class="close" title="Stop following (Esc)">×</button>
      </div>
      <div class="stats">
        <span>Health <b style="color:#ff6b6b">${hpPips(f.hp, maxHp)}</b></span>
        <span>Food <b>${f.rations}</b></span>
        <span>Keys <b>${f.keys}</b>/${this.model.config?.keysToEscape ?? 3}</span>
        <span>Shields <b>${f.shields}</b></span>
        <span>Warden likes it <b>${f.favor}</b></span>
        <span>Where <b${f.zone === 'pit' && f.status === 'active' ? ' class="bad"' : ''}>${escapeHtml(where)}</b></span>
        ${f.bounty ? '<span class="bad">THE WARDEN WANTS THIS AI KNOCKED OUT</span>' : ''}
      </div>
      <div class="stats">
        <span>Deals with <b>${partners.length ? escapeHtml(partners.join(', ')) : 'nobody'}</b></span>
        <span>Betrayals <b class="bad">${c?.betrayals ?? 0}</b></span>
        <span>Lies <b class="bad">${c?.lies ?? 0}</b></span>
        <span>Knockouts <b>${c?.kos ?? 0}</b></span>
        <span>Snitched <b>${c?.reports ?? 0}</b></span>
      </div>
      <div class="private-note">THE OTHER AIs CANNOT SEE ITS THOUGHTS. YOU CAN.</div>
      <div class="timeline">${rows || '<div class="muted">Nothing yet.</div>'}</div>`;
  }
}
