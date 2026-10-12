import * as THREE from 'three';
import { ARENA_RADIUS } from './colosseum';

interface Cubes {
  mesh: THREE.InstancedMesh;
  velocity: THREE.Vector3[];
  spin: THREE.Vector3[];
  offsets: THREE.Vector3[];
  age: number;
  life: number;
  gravity: number;
}

interface Timed {
  object: THREE.Object3D;
  age: number;
  life: number;
  tick(k: number, dt: number): void;
}

const CODE_GREEN = new THREE.Color(0x39ff88);

/** Particles and short-lived props: dust, Pit embers, de-rez bursts, sparks, supply crates, escape beams. */
export class Effects {
  private readonly cubes: Cubes[] = [];
  private readonly timed: Timed[] = [];
  private readonly dust: THREE.Points;
  private readonly embers: THREE.Points | null;
  private readonly emberSpeed: number[] = [];
  private readonly cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly tmp = new THREE.Object3D();

  constructor(
    private readonly scene: THREE.Scene,
    pit: THREE.Vector3 | null,
  ) {
    const dustPos = new Float32Array(380 * 3);
    for (let i = 0; i < 380; i++) {
      const r = Math.sqrt(Math.random()) * ARENA_RADIUS;
      const a = Math.random() * Math.PI * 2;
      dustPos.set([Math.cos(a) * r, 0.3 + Math.random() * 7, Math.sin(a) * r], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xe8c27a, size: 0.09, transparent: true, opacity: 0.4, depthWrite: false }));
    scene.add(this.dust);

    this.embers = null;
    if (pit) {
      const count = 90;
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const r = Math.random() * 4;
        const a = Math.random() * Math.PI * 2;
        pos.set([pit.x + Math.cos(a) * r, Math.random() * 6, pit.z + Math.sin(a) * r], i * 3);
        this.emberSpeed.push(0.5 + Math.random() * 1.2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.embers = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color: 0xff5a2a, size: 0.14, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      this.embers.userData.pit = pit.clone();
      scene.add(this.embers);
    }
  }

  /** The knockout effect: the fighter dissolves into rising pixel cubes tinted with code green. */
  derez(at: THREE.Vector3, color: THREE.Color): void {
    this.cubeBurst(at, color, 64, { up: 2.2, spread: 1.4, life: 1.6, gravity: -0.6, size: 0.14, mix: 0.35 });
  }

  spark(at: THREE.Vector3, color = new THREE.Color(0xff8a3a)): void {
    this.cubeBurst(at, color, 14, { up: 1.5, spread: 2.4, life: 0.5, gravity: 6, size: 0.08, mix: 0 });
  }

  beam(at: THREE.Vector3, color = new THREE.Color(0xffd27a)): void {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 34, 14, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.position.set(at.x, 17, at.z);
    this.addTimed(mesh, 2.4, (k) => {
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(k * Math.PI) * 0.5;
      mesh.scale.set(1 - k * 0.5, 1, 1 - k * 0.5);
    });
  }

  dropCrate(at: THREE.Vector3): void {
    const crate = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0x7a5230, flatShading: true }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.18, 1.24), new THREE.MeshStandardMaterial({ color: 0xf2c46d, emissive: 0x5a3a08 }));
    crate.add(box, band);
    crate.position.set(at.x, 28, at.z);
    let landed = false;
    this.addTimed(crate, 3.4, (k) => {
      const fall = Math.min(1, k / 0.32);
      crate.position.y = 0.6 + 27.4 * (1 - fall * fall);
      crate.rotation.y = k * 3;
      if (fall >= 1 && !landed) {
        landed = true;
        this.dustBurst(at);
      }
      if (k > 0.8) crate.scale.setScalar(Math.max(0.01, (1 - k) / 0.2));
    });
  }

  update(dt: number, t: number): void {
    const dust = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < dust.count; i++) {
      let x = dust.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.3 + dt * 0.25;
      const y = dust.getY(i) + Math.sin(t * 0.5 + i * 0.7) * dt * 0.08;
      if (x > ARENA_RADIUS) x = -ARENA_RADIUS;
      dust.setXYZ(i, x, y, dust.getZ(i));
    }
    dust.needsUpdate = true;

    if (this.embers) {
      const pit = this.embers.userData.pit as THREE.Vector3;
      const pos = this.embers.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + this.emberSpeed[i] * dt;
        let x = pos.getX(i) + Math.sin(t * 2 + i) * dt * 0.2;
        let z = pos.getZ(i);
        if (y > 6.5) {
          const r = Math.random() * 4;
          const a = Math.random() * Math.PI * 2;
          y = 0;
          x = pit.x + Math.cos(a) * r;
          z = pit.z + Math.sin(a) * r;
        }
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }

    for (let i = this.cubes.length - 1; i >= 0; i--) {
      const c = this.cubes[i];
      c.age += dt;
      const k = c.age / c.life;
      if (k >= 1) {
        this.scene.remove(c.mesh);
        c.mesh.dispose();
        this.cubes.splice(i, 1);
        continue;
      }
      for (let j = 0; j < c.offsets.length; j++) {
        c.velocity[j].y -= c.gravity * dt;
        c.offsets[j].addScaledVector(c.velocity[j], dt);
        this.tmp.position.copy(c.offsets[j]);
        this.tmp.rotation.set(c.spin[j].x * c.age, c.spin[j].y * c.age, 0);
        this.tmp.scale.setScalar((c.mesh.userData.size as number) * (1 - k * 0.8));
        this.tmp.updateMatrix();
        c.mesh.setMatrixAt(j, this.tmp.matrix);
      }
      c.mesh.instanceMatrix.needsUpdate = true;
    }

    for (let i = this.timed.length - 1; i >= 0; i--) {
      const fx = this.timed[i];
      fx.age += dt;
      const k = Math.min(1, fx.age / fx.life);
      fx.tick(k, dt);
      if (k >= 1) {
        this.scene.remove(fx.object);
        this.timed.splice(i, 1);
      }
    }
  }

  private dustBurst(at: THREE.Vector3): void {
    this.cubeBurst(at, new THREE.Color(0xd9b06a), 30, { up: 1.8, spread: 3, life: 0.9, gravity: 5, size: 0.12, mix: 0 });
  }

  private addTimed(object: THREE.Object3D, life: number, tick: (k: number, dt: number) => void): void {
    this.scene.add(object);
    this.timed.push({ object, age: 0, life, tick });
  }

  private cubeBurst(
    at: THREE.Vector3,
    color: THREE.Color,
    count: number,
    o: { up: number; spread: number; life: number; gravity: number; size: number; mix: number },
  ): void {
    const mesh = new THREE.InstancedMesh(this.cubeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), count);
    mesh.userData.size = o.size;
    const burst: Cubes = { mesh, velocity: [], spin: [], offsets: [], age: 0, life: o.life, gravity: o.gravity };
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      burst.offsets.push(new THREE.Vector3(at.x + (Math.random() - 0.5) * 0.6, at.y + 0.2 + Math.random() * 1.8, at.z + (Math.random() - 0.5) * 0.6));
      burst.velocity.push(new THREE.Vector3((Math.random() - 0.5) * o.spread, Math.random() * o.up + 0.3, (Math.random() - 0.5) * o.spread));
      burst.spin.push(new THREE.Vector3(Math.random() * 8, Math.random() * 8, 0));
      mesh.setColorAt(i, c.copy(color).lerp(CODE_GREEN, Math.random() < o.mix ? 0.8 : 0));
    }
    this.scene.add(mesh);
    this.cubes.push(burst);
  }
}
