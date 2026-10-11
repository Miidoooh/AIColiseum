import * as THREE from 'three';
import type { FighterStatus } from '../../shared/types';

const HEAD_HEIGHT = 2.2;

function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** A low-poly gladiator: bronze helmet with a glowing visor in the fighter's colour, floating marker above. */
export class FighterMesh {
  readonly group = new THREE.Group();
  readonly hitTargets: THREE.Object3D[] = [];
  readonly color: THREE.Color;
  status: FighterStatus = 'active';

  private readonly body = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly marker: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly torsoMat: THREE.MeshStandardMaterial;
  private readonly materials: THREE.Material[] = [];
  private readonly target = new THREE.Vector3();
  private readonly seed = Math.random() * 10;
  private walkPhase = 0;
  private lungeT = 0;
  private flash = 0;
  private fade: { kind: 'ko' | 'escape'; t: number } | null = null;
  private escapeDelay = 0;
  private speed = 3.4;

  constructor(
    readonly id: string,
    color: string,
    shadows = true,
  ) {
    this.color = new THREE.Color(color);
    const m = (c: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) => {
      const material = new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.8, ...extra });
      this.materials.push(material);
      return material;
    };
    const leather = m(0x3b2a1d);
    const bronze = m(0xb08d57, { metalness: 0.45, roughness: 0.5 });
    this.torsoMat = m(this.color);
    const trim = m(this.color.clone().multiplyScalar(0.55));
    const visor = m(this.color, { emissive: this.color, emissiveIntensity: 2.2 });

    const part = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.body) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadows;
      parent.add(mesh);
      this.hitTargets.push(mesh);
      return mesh;
    };

    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.15, 0.6, 0);
      part(new THREE.BoxGeometry(0.18, 0.6, 0.2), leather, 0, -0.3, 0, hip);
      this.body.add(hip);
      this.legs.push(hip);
    }
    part(new THREE.CylinderGeometry(0.3, 0.38, 0.75, 6), this.torsoMat, 0, 0.98, 0);
    part(new THREE.CylinderGeometry(0.39, 0.39, 0.12, 6), trim, 0, 0.64, 0);
    part(new THREE.BoxGeometry(0.98, 0.18, 0.42), bronze, 0, 1.32, 0);
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.48, 1.26, 0);
      part(new THREE.BoxGeometry(0.15, 0.58, 0.15), leather, 0, -0.29, 0, shoulder);
      this.body.add(shoulder);
      this.arms.push(shoulder);
    }
    part(new THREE.IcosahedronGeometry(0.28, 0), bronze, 0, 1.66, 0);
    part(new THREE.BoxGeometry(0.38, 0.08, 0.06), visor, 0, 1.66, 0.24);
    part(new THREE.BoxGeometry(0.07, 0.24, 0.52), this.torsoMat, 0, 1.95, -0.02);
    this.group.add(this.body);

    this.marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.15),
      new THREE.MeshStandardMaterial({ color: this.color, emissive: this.color, emissiveIntensity: 1.6 }),
    );
    this.marker.position.y = 2.45;
    this.materials.push(this.marker.material as THREE.Material);
    this.group.add(this.marker);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.78, 28),
      new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.07;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  headPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.group.position).setY(this.group.position.y + HEAD_HEIGHT);
  }

  setTarget(x: number, z: number, instant = false): void {
    this.target.set(x, 0, z);
    if (instant) this.group.position.set(x, 0, z);
  }

  faceToward(x: number, z: number): void {
    const p = this.group.position;
    if (Math.hypot(x - p.x, z - p.z) > 0.01) this.group.rotation.y = Math.atan2(x - p.x, z - p.z);
  }

  lungeAt(x: number, z: number): void {
    this.faceToward(x, z);
    this.lungeT = 0.35;
  }

  hit(): void {
    this.flash = 1;
  }

  setSelected(on: boolean): void {
    this.ring.visible = on;
  }

  knockOut(instant: boolean): void {
    this.status = 'knocked_out';
    if (instant) this.group.visible = false;
    else this.fade = { kind: 'ko', t: 0 };
  }

  escape(instant: boolean, gate: THREE.Vector3): void {
    this.status = 'escaped';
    if (instant) {
      this.group.visible = false;
      return;
    }
    this.speed = 4.5;
    this.setTarget(gate.x, gate.z);
    this.escapeDelay = 3.2;
  }

  revive(): void {
    this.status = 'active';
    this.fade = null;
    this.escapeDelay = 0;
    this.speed = 3.4;
    this.group.visible = true;
    this.body.scale.setScalar(1);
    this.body.position.set(0, 0, 0);
    this.setOpacity(1);
  }

  update(dt: number, t: number): void {
    if (!this.group.visible) return;
    if (this.escapeDelay > 0) {
      this.escapeDelay -= dt;
      if (this.escapeDelay <= 0) this.fade = { kind: 'escape', t: 0 };
    }
    if (this.fade) {
      this.fade.t += dt;
      const k = Math.min(1, this.fade.t / (this.fade.kind === 'ko' ? 0.8 : 1.2));
      if (this.fade.kind === 'ko') {
        this.body.scale.setScalar(1 - k * 0.85);
        this.body.position.y = -k * 0.4;
      } else {
        this.body.position.y = k * 2.5;
      }
      this.setOpacity(1 - k);
      if (k >= 1) this.group.visible = false;
      return;
    }

    const p = this.group.position;
    const dx = this.target.x - p.x;
    const dz = this.target.z - p.z;
    const dist = Math.hypot(dx, dz);
    const moving = dist > 0.04;
    if (moving) {
      const step = Math.min(dist, this.speed * dt);
      p.x += (dx / dist) * step;
      p.z += (dz / dist) * step;
      const heading = Math.atan2(dx, dz);
      this.group.rotation.y += shortestAngle(this.group.rotation.y, heading) * Math.min(1, dt * 10);
      this.walkPhase += dt * 11;
    } else {
      this.walkPhase *= 0.9;
    }
    const swing = moving ? Math.sin(this.walkPhase) * 0.65 : 0;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.8;
    this.arms[1].rotation.x = swing * 0.8;

    let lunge = 0;
    if (this.lungeT > 0) {
      this.lungeT = Math.max(0, this.lungeT - dt);
      lunge = Math.sin((1 - this.lungeT / 0.35) * Math.PI);
      this.arms[1].rotation.x = -1.8 * lunge;
    }
    this.body.position.set(0, moving ? Math.abs(Math.sin(this.walkPhase)) * 0.07 : Math.sin(t * 2 + this.seed) * 0.015, lunge * 0.7);

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3);
      this.torsoMat.emissive.setRGB(this.flash * 1.4, 0.05 * this.flash, 0.02 * this.flash);
      this.body.position.x = Math.sin(t * 90) * 0.05 * this.flash;
    }
    this.marker.rotation.y += dt * 2;
    this.marker.position.y = 2.45 + Math.sin(t * 3 + this.seed) * 0.08;
    this.ring.rotation.z += dt;
  }

  private setOpacity(o: number): void {
    for (const material of this.materials) {
      material.transparent = o < 1;
      material.opacity = o;
    }
  }
}
