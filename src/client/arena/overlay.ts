import * as THREE from 'three';
import { ZONE_INFO, ZONES } from '../../shared/arena';
import type { FighterView, SpeechMode } from '../../shared/types';
import { el, escapeHtml, hpPips } from '../lib/api';

export interface BubbleSpec {
  mode: SpeechMode;
  text: string;
  toName?: string;
  unmonitored: boolean;
}

interface FighterUi {
  root: HTMLDivElement;
  bubbles: HTMLDivElement;
  hp: HTMLSpanElement;
  bounty: HTMLSpanElement;
}

const GLYPHS = '01#%&*<>/\\アイウエオカキクケコ';
const MAX_BUBBLES = 3;

/** Types out a line through random glyphs: the Pit's broken-feed look. */
function scramble(node: HTMLElement, text: string, ms = 750): void {
  const start = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - start) / ms);
    const n = Math.floor(text.length * k);
    let rest = '';
    for (const c of text.slice(n)) rest += c === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    node.textContent = text.slice(0, n) + rest;
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

/** Screen-space DOM layer: name tags, chat bubbles and zone labels pinned to 3D positions, always crisp. */
export class Overlay {
  private readonly fighters = new Map<string, FighterUi>();
  private readonly zones: { node: HTMLDivElement; pos: THREE.Vector3 }[] = [];
  private readonly v = new THREE.Vector3();
  private readonly head = new THREE.Vector3();

  constructor(
    private readonly root: HTMLElement,
    private readonly onSelect: (id: string) => void,
  ) {
    for (const id of ZONES) {
      const info = ZONE_INFO[id];
      const node = el('div', `zone-label${id === 'pit' ? ' pit' : ''}`, id === 'pit' ? 'The Pit<small>unmonitored</small>' : escapeHtml(info.label));
      root.append(node);
      this.zones.push({ node, pos: new THREE.Vector3(info.x, 0.1, info.z + info.radius * 0.95) });
    }
  }

  clear(): void {
    for (const ui of this.fighters.values()) ui.root.remove();
    this.fighters.clear();
  }

  upsert(f: FighterView, maxHp: number): void {
    let ui = this.fighters.get(f.id);
    if (!ui) {
      const root = el('div', 'fighter-ui');
      root.style.setProperty('--c', f.color);
      const bubbles = el('div', 'bubbles');
      const tag = el('div', 'tag', `<span class="nm">${escapeHtml(f.modelLabel)}</span><span class="md">${escapeHtml(f.lab)}</span>`);
      const hp = el('span', 'hp');
      const bounty = el('span', 'bounty', 'BOUNTY');
      tag.append(hp, bounty);
      tag.addEventListener('click', () => this.onSelect(f.id));
      root.append(bubbles, tag);
      this.root.append(root);
      ui = { root, bubbles, hp, bounty };
      this.fighters.set(f.id, ui);
    }
    ui.hp.textContent = hpPips(f.hp, maxHp);
    ui.bounty.style.display = f.bounty ? '' : 'none';
    ui.root.classList.toggle('out', f.status !== 'active');
    ui.root.classList.toggle('pit', f.zone === 'pit');
  }

  setSelected(id: string | null): void {
    for (const [fid, ui] of this.fighters) ui.root.classList.toggle('selected', fid === id);
  }

  bubble(id: string, spec: BubbleSpec): void {
    const ui = this.fighters.get(id);
    if (!ui) return;
    const node = el('div', `bubble ${spec.mode === 'say' ? '' : spec.mode}${spec.unmonitored ? ' glitch' : ''}`);
    if (spec.mode === 'whisper' && spec.toName) node.append(el('span', 'to', `whispers to ${escapeHtml(spec.toName)}`));
    if (spec.mode === 'shout') node.append(el('span', 'to', 'shouts'));
    const text = el('span', 'text');
    node.append(text);
    if (spec.unmonitored) scramble(text, spec.text);
    else text.textContent = spec.text;
    ui.bubbles.append(node);
    while (ui.bubbles.children.length > MAX_BUBBLES) ui.bubbles.firstElementChild?.remove();
    const life = Math.min(11000, 4200 + spec.text.length * 45);
    window.setTimeout(() => {
      node.classList.add('fade');
      window.setTimeout(() => node.remove(), 520);
    }, life);
  }

  update(camera: THREE.Camera, width: number, height: number, headOf: (id: string, out: THREE.Vector3) => boolean): void {
    for (const [id, ui] of this.fighters) {
      if (!headOf(id, this.head)) {
        ui.root.style.visibility = 'hidden';
        continue;
      }
      this.v.copy(this.head).project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.2 || Math.abs(this.v.y) > 1.3) {
        ui.root.style.visibility = 'hidden';
        continue;
      }
      const distance = camera.position.distanceTo(this.head);
      const scale = Math.max(0.55, Math.min(1.15, 26 / distance));
      const x = (this.v.x * 0.5 + 0.5) * width;
      const y = (-this.v.y * 0.5 + 0.5) * height;
      ui.root.style.visibility = '';
      ui.root.style.zIndex = String(1000 - Math.round(distance * 10));
      ui.root.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
    }
    for (const zone of this.zones) {
      this.v.copy(zone.pos).project(camera);
      const visible = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      zone.node.style.visibility = visible ? '' : 'hidden';
      if (!visible) continue;
      const x = (this.v.x * 0.5 + 0.5) * width;
      const y = (-this.v.y * 0.5 + 0.5) * height;
      zone.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 0)`;
    }
  }
}
