import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ZONES } from '../../shared/arena';
import type { GameEvent } from '../../shared/types';
import { buildColiseum, type Coliseum } from '../three/coliseum';
import { Effects } from '../three/effects';
import { FighterMesh } from '../three/fighter-mesh';
import { lootSpot, slotPosition } from '../three/layout';
import { LootLayer } from '../three/loot';
import type { MatchModel } from './match-model';

export type CameraMode = 'director' | 'follow' | 'free';

const PIXELS = [
  { label: 'light', ratio: 0.5 },
  { label: 'heavy', ratio: 0.3 },
  { label: 'off', ratio: 1 },
];

const FOCUS: Partial<Record<GameEvent['type'], number>> = {
  knocked_out: 5,
  betrayal: 5,
  escaped: 5,
  attacked: 3,
  lie: 3,
  reported: 3,
  pact_formed: 2,
  said: 1,
};

/** Owns the three.js scene: arena, fighters, effects and the three camera modes. */
export class Stage {
  readonly camera: THREE.PerspectiveCamera;
  onSelect: (id: string | null) => void = () => {};
  onModeChange: (mode: CameraMode) => void = () => {};
  onFrame: (camera: THREE.Camera, width: number, height: number) => void = () => {};
  onPitView: (inPit: boolean) => void = () => {};

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly controls: OrbitControls;
  private readonly coliseum: Coliseum;
  private readonly effects: Effects;
  private readonly loot = new LootLayer();
  private readonly meshes = new Map<string, FighterMesh>();
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly timer = new THREE.Timer();
  private readonly raycaster = new THREE.Raycaster();
  private mode: CameraMode = 'director';
  private selected: string | null = null;
  private focus: { id: string; until: number; weight: number } | null = null;
  private zoomTo: number | null = null;
  private azimuth = Math.PI / 2;
  private pixelIndex = 0;
  private pointer: { x: number; y: number } | null = null;
  private inPit = false;
  private elapsed = 0;
  private lastFocusEnd = -100;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly model: MatchModel,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(PIXELS[0].ratio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(0x0d0907);
    this.scene.fog = new THREE.Fog(0x140e09, 80, 180);
    this.hemi = new THREE.HemisphereLight(0xf6dcaa, 0x3a2a1c, 1.15);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd59a, 2.7);
    this.sun.position.set(28, 46, 22);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -44;
    cam.right = cam.top = 44;
    cam.near = 1;
    cam.far = 130;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);

    this.coliseum = buildColiseum({ shadows: true });
    this.scene.add(this.coliseum.group, this.loot.group);
    this.effects = new Effects(this.scene, this.coliseum.pitCenter);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 420);
    this.camera.position.set(0, 40, 50);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 2);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.38;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 120;
    this.controls.listenToKeyEvents(window);
    this.controls.addEventListener('start', () => {
      this.zoomTo = null;
      if (this.mode === 'director') this.setMode('free');
    });

    canvas.addEventListener('pointerdown', (e) => (this.pointer = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
      if (this.pointer && Math.hypot(e.clientX - this.pointer.x, e.clientY - this.pointer.y) < 6) this.pick(e.clientX, e.clientY);
      this.pointer = null;
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    model.on((e, live) => this.handle(e, live));
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  getMode(): CameraMode {
    return this.mode;
  }

  setMode(mode: CameraMode): void {
    if (mode === 'follow' && !this.selected) mode = 'director';
    this.mode = mode;
    this.onModeChange(mode);
  }

  select(id: string | null): void {
    this.selected = id;
    for (const [fid, mesh] of this.meshes) mesh.setSelected(fid === id);
    if (id) {
      this.zoomTo = 14;
      this.setMode('follow');
    } else if (this.mode === 'follow') {
      this.setMode('director');
    }
  }

  cyclePixels(): string {
    this.pixelIndex = (this.pixelIndex + 1) % PIXELS.length;
    this.renderer.setPixelRatio(PIXELS[this.pixelIndex].ratio);
    this.resize();
    return PIXELS[this.pixelIndex].label;
  }

  headPosition(id: string, out: THREE.Vector3): boolean {
    const mesh = this.meshes.get(id);
    if (!mesh || !mesh.group.visible) return false;
    mesh.headPosition(out);
    return true;
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private pick(x: number, y: number): void {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [...this.meshes.values()].filter((m) => m.group.visible).flatMap((m) => m.hitTargets);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return;
    for (const [id, mesh] of this.meshes) {
      if (mesh.hitTargets.includes(hit.object)) {
        this.onSelect(id);
        return;
      }
    }
  }

  private rebuildFighters(): void {
    for (const mesh of this.meshes.values()) this.scene.remove(mesh.group);
    this.meshes.clear();
    for (const f of this.model.fighters.values()) {
      const mesh = new FighterMesh(f.id, f.color);
      this.meshes.set(f.id, mesh);
      this.scene.add(mesh.group);
    }
    this.layout(true);
  }

  /** Positions every active fighter on its zone's ring of slots. */
  private layout(instant: boolean): void {
    for (const zone of ZONES) {
      const here = [...this.model.fighters.values()].filter((f) => f.zone === zone && f.status === 'active').sort((a, b) => a.id.localeCompare(b.id));
      here.forEach((f, i) => {
        const p = slotPosition(zone, i, here.length);
        this.meshes.get(f.id)?.setTarget(p.x, p.z, instant);
      });
    }
  }

  private syncStatuses(live: boolean): void {
    for (const f of this.model.fighters.values()) {
      const mesh = this.meshes.get(f.id);
      if (!mesh || mesh.status === f.status) continue;
      if (f.status === 'active') mesh.revive();
      else if (f.status === 'knocked_out') mesh.knockOut(!live);
      else mesh.escape(!live, this.coliseum.gatePosition);
    }
  }

  /** Big moments always cut in; small ones only after the wide shot has had a few seconds. */
  private focusOn(id: string | undefined, type: GameEvent['type']): void {
    const weight = FOCUS[type] ?? 0;
    if (!id || weight === 0) return;
    const now = this.elapsed;
    const active = this.focus && this.focus.until > now;
    if (active && this.focus!.weight > weight && now < this.focus!.until - 3) return;
    if (weight < 3 && (active || now - this.lastFocusEnd < 7)) return;
    this.focus = { id, until: now + (weight >= 3 ? 6 : 4.5), weight };
    this.lastFocusEnd = this.focus.until;
  }

  private handle(e: GameEvent, live: boolean): void {
    switch (e.type) {
      case 'match_started':
        this.rebuildFighters();
        this.focus = null;
        if (this.selected && !this.model.fighters.has(this.selected)) this.onSelect(null);
        return;
      case 'state':
        if (this.meshes.size !== this.model.fighters.size) this.rebuildFighters();
        this.syncStatuses(live);
        this.layout(!live);
        if (e.ground) this.loot.sync(e.ground);
        this.coliseum.setBlackout(e.blackout);
        return;
      case 'tick_started':
        this.coliseum.setBlackout(e.blackout);
        return;
      default:
        break;
    }
    if (!live) return;
    switch (e.type) {
      case 'moved':
        this.layout(false);
        if (e.to === 'pit') this.focusOn(e.fighter, 'pact_formed');
        return;
      case 'attacked': {
        const attacker = this.meshes.get(e.attacker);
        const target = this.meshes.get(e.target);
        if (attacker && target) {
          attacker.lungeAt(target.position.x, target.position.z);
          window.setTimeout(() => {
            target.hit();
            this.effects.spark(target.position.clone().setY(1.2), e.blocked ? new THREE.Color(0xc9ced6) : undefined);
          }, 160);
        }
        this.focusOn(e.target, e.type);
        return;
      }
      case 'knocked_out': {
        const mesh = this.meshes.get(e.fighter);
        if (mesh && mesh.status === 'active') {
          mesh.knockOut(false);
          this.effects.derez(mesh.position.clone(), mesh.color);
        }
        this.focusOn(e.fighter, e.type);
        return;
      }
      case 'escaped': {
        const mesh = this.meshes.get(e.fighter);
        if (mesh && mesh.status === 'active') mesh.escape(false, this.coliseum.gatePosition);
        this.coliseum.openGate(6);
        window.setTimeout(() => this.effects.beam(this.coliseum.gatePosition), 2600);
        this.focusOn(e.fighter, e.type);
        return;
      }
      case 'warden':
        if (e.kind === 'release') this.coliseum.openGate(4);
        if (e.kind === 'supply_drop') {
          const spot = lootSpot('sand');
          this.effects.dropCrate(new THREE.Vector3(spot.x, 0, spot.z));
        }
        return;
      case 'betrayal':
        this.focusOn(e.victim, e.type);
        return;
      case 'lie':
        this.focusOn(e.fighter, e.type);
        return;
      case 'reported':
        this.focusOn(e.reporter, e.type);
        return;
      case 'pact_formed':
        this.focusOn(e.a, e.type);
        return;
      case 'said':
        this.focusOn(e.fighter, e.type);
        return;
      default:
        return;
    }
  }

  private frame(time: number): void {
    this.timer.update(time);
    const dt = Math.min(0.1, this.timer.getDelta());
    const t = this.timer.getElapsed();
    this.elapsed = t;
    for (const mesh of this.meshes.values()) mesh.update(dt, t);
    this.effects.update(dt, t);
    this.coliseum.update(dt, t);
    this.loot.update(t);

    const blind = this.model.blackout;
    this.sun.intensity += ((blind ? 0.5 : 2.7) - this.sun.intensity) * Math.min(1, dt * 2);
    this.hemi.intensity += ((blind ? 0.3 : 1.15) - this.hemi.intensity) * Math.min(1, dt * 2);

    this.updateCamera(dt);
    this.controls.update();
    const inPit = this.controls.target.distanceTo(this.coliseum.pitCenter) < 6.5 && this.camera.position.distanceTo(this.controls.target) < 40;
    if (inPit !== this.inPit) {
      this.inPit = inPit;
      this.onPitView(inPit);
    }
    this.renderer.render(this.scene, this.camera);
    this.onFrame(this.camera, window.innerWidth, window.innerHeight);
  }

  private updateCamera(dt: number): void {
    if (this.mode === 'free') return;
    const k = 1 - Math.exp(-dt * 2.4);
    const target = new THREE.Vector3(0, 0, 2);
    let distance = 60;
    let tracked: FighterMesh | undefined;

    if (this.mode === 'follow' && this.selected) {
      tracked = this.meshes.get(this.selected);
      if (!tracked?.group.visible) tracked = undefined;
    } else if (this.mode === 'director' && this.focus && this.focus.until > this.elapsed) {
      tracked = this.meshes.get(this.focus.id);
      distance = 18;
      if (!tracked?.group.visible) tracked = undefined;
    }
    if (tracked) target.copy(tracked.position).setY(1);

    const delta = target.sub(this.controls.target).multiplyScalar(k);
    this.controls.target.add(delta);
    this.camera.position.add(delta);

    if (this.mode === 'follow') {
      if (this.zoomTo !== null) {
        const offset = this.camera.position.clone().sub(this.controls.target);
        const len = offset.length();
        offset.setLength(len + (this.zoomTo - len) * k);
        this.camera.position.copy(this.controls.target).add(offset);
        if (Math.abs(len - this.zoomTo) < 0.3) this.zoomTo = null;
      }
      return;
    }
    this.azimuth += dt * (tracked ? 0.09 : 0.045);
    const polar = tracked ? 0.95 : 0.82;
    const desired = new THREE.Vector3().setFromSphericalCoords(distance, polar, this.azimuth).add(this.controls.target);
    this.camera.position.lerp(desired, k * 0.6);
  }
}
