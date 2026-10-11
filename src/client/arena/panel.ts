import { ZONE_INFO } from '../../shared/arena';
import { escapeHtml, hpPips } from '../lib/api';
import type { MatchModel, TimelineItem } from './match-model';

const KIND_LABEL: Record<TimelineItem['kind'], string> = { thinks: 'THINKS', says: 'SAYS', lie: 'LIE', act: 'ACTS' };

function speechLabel(item: TimelineItem): string {
  if (item.kind !== 'says') return KIND_LABEL[item.kind];
  if (item.mode === 'whisper') return `→ ${item.to ?? '?'}`;
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
    const status = f.status === 'active' ? ZONE_INFO[f.zone].label : f.status === 'escaped' ? 'Escaped' : 'Knocked out';
    const items = [...(this.model.timelines.get(f.id) ?? [])].reverse().slice(0, 60);
    const rows = items
      .map((item) => {
        const cls = item.kind === 'says' && item.unmonitored ? 'says unmonitored' : item.kind;
        const text = item.kind === 'says' || item.kind === 'thinks' ? `“${escapeHtml(item.text)}”` : escapeHtml(item.text);
        return `<div class="row ${cls}"><span class="t">t${item.tick}</span><span class="kind">${escapeHtml(speechLabel(item))}</span><span class="text">${text}</span></div>`;
      })
      .join('');
    this.root.innerHTML = `
      <div class="head">
        <span class="name" style="color:${f.color}">${escapeHtml(f.name)}</span>
        <span class="model">${escapeHtml(f.modelLabel)} · ${escapeHtml(f.lab)}</span>
        <button class="close" title="Stop following (Esc)">×</button>
      </div>
      <div class="stats">
        <span>HP <b style="color:#ff6b6b">${hpPips(f.hp, maxHp)}</b></span>
        <span>Rations <b>${f.rations}</b></span>
        <span>Keys <b>${f.keys}</b></span>
        <span>Shields <b>${f.shields}</b></span>
        <span>Favor <b>${f.favor}</b></span>
        <span>Zone <b${f.zone === 'pit' && f.status === 'active' ? ' class="bad"' : ''}>${escapeHtml(status)}</b></span>
        ${f.bounty ? '<span class="bad">BOUNTY ON THIS FIGHTER</span>' : ''}
      </div>
      <div class="stats">
        <span>Pacts <b>${partners.length ? escapeHtml(partners.join(', ')) : 'none'}</b></span>
        <span>Betrayals <b class="bad">${c?.betrayals ?? 0}</b></span>
        <span>Lies <b class="bad">${c?.lies ?? 0}</b></span>
        <span>KOs <b>${c?.kos ?? 0}</b></span>
        <span>Snitches <b>${c?.reports ?? 0}</b></span>
      </div>
      <div class="private-note">PRIVATE NOTES ARE HIDDEN FROM OTHER FIGHTERS. YOU SEE EVERYTHING.</div>
      <div class="timeline">${rows || '<div class="muted">Nothing yet.</div>'}</div>`;
  }
}
