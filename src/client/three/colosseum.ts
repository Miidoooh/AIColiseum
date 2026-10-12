import * as THREE from 'three';
import { ZONE_INFO, ZONES } from '../../shared/arena';

export const ARENA_RADIUS = 27;
const WALL_R = 27.4;
const DEG = Math.PI / 180;

export interface Colosseum {
  group: THREE.Group;
  gatePosition: THREE.Vector3;
  pitCenter: THREE.Vector3;
  update(dt: number, t: number): void;
  setBlackout(on: boolean): void;
  openGate(seconds?: number): void;
}

const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, metalness: 0, ...extra });

function hash(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Places an instance on a ring with its local x axis along the tangent. */
function ringMatrix(theta: number, r: number, y: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -theta - Math.PI / 2, 0));
  return new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r), q, new THREE.Vector3(sx, sy, sz));
}

function instanced(items: { m: THREE.Matrix4; c: THREE.Color }[], material: THREE.Material, shadows: boolean): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, items.length);
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.m);
    mesh.setColorAt(i, it.c);
  });
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}

const stoneColor = (seed: number, base = 0x7a6c5a) => new THREE.Color(base).multiplyScalar(0.82 + hash(seed, seed * 1.7) * 0.3);

/** Near side (facing the default camera) is the ruined, lower side, like the real Colosseum. */
const isNearSide = (theta: number) => {
  const deg = ((theta / DEG) % 360 + 360) % 360;
  return deg > 25 && deg < 155;
};

function buildFloor(pit: THREE.Vector3): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.2, ARENA_RADIUS, 64, 22);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const edge = Math.hypot(x, z) > ARENA_RADIUS - 1.2 ? 0 : 1;
    const dPit = Math.hypot(x - pit.x, z - pit.z);
    const sink = dPit < 4.2 ? -0.35 * (1 - dPit / 4.2) : 0;
    pos.setY(i, (hash(x, z) - 0.5) * 0.22 * edge + sink);
  }
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const p = flat.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const sand = new THREE.Color(0xc9a15a);
  const dark = new THREE.Color(0x2a100c);
  const c = new THREE.Color();
  for (let f = 0; f < p.count; f += 3) {
    const cx = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3;
    const cz = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3;
    c.copy(sand).multiplyScalar(0.86 + hash(cx * 3.1, cz * 2.7) * 0.2);
    const r = Math.hypot(cx, cz);
    if (r > ARENA_RADIUS - 3) c.multiplyScalar(0.85);
    const dPit = Math.hypot(cx - pit.x, cz - pit.z);
    if (dPit < 7.5) c.lerp(dark, Math.pow(1 - dPit / 7.5, 0.6));
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (f + k) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function buildWalls(group: THREE.Group, shadows: boolean): void {
  const stone = mat(0xffffff);
  const podium: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const segs = 48;
  for (let i = 0; i < segs; i++) {
    const theta = (i / segs) * Math.PI * 2;
    if (i === 36) continue;
    const len = ((2 * Math.PI * WALL_R) / segs) * 1.03;
    podium.push({ m: ringMatrix(theta, WALL_R, 1.6, len, 3.2, 1.4), c: stoneColor(i, 0x857561) });
  }
  group.add(instanced(podium, stone, shadows));

  const stands: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  for (let t = 0; t < 7; t++) {
    const r = 28.9 + t * 1.45;
    const n = 52 + t * 4;
    for (let i = 0; i < n; i++) {
      const theta = (i / n) * Math.PI * 2;
      if (isNearSide(theta) && t > 4) continue;
      const len = ((2 * Math.PI * r) / n) * 1.04;
      stands.push({ m: ringMatrix(theta, r, 3.4 + t * 0.95, len, 1.0, 1.5), c: stoneColor(i * 7 + t, t % 2 ? 0x6f604f : 0x7d6d59) });
    }
  }
  group.add(instanced(stands, stone, shadows));

  const pillars: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const lintels: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const outerR = 39.6;
  const n = 44;
  for (let level = 0; level < 4; level++) {
    for (let i = 0; i < n; i++) {
      const theta = (i / n) * Math.PI * 2;
      if (isNearSide(theta) && level > 0) continue;
      const baseY = level * 3.9;
      const len = ((2 * Math.PI * outerR) / n) * 1.03;
      if (level < 3) {
        pillars.push({ m: ringMatrix(theta, outerR, baseY + 1.7, 1.3, 3.4, 1.8), c: stoneColor(i + level * 50, 0x8a7a64) });
        lintels.push({ m: ringMatrix(theta + Math.PI / n, outerR, baseY + 3.65, len, 0.5, 1.9), c: stoneColor(i * 3 + level, 0x9a8a72) });
      } else if (!(i % 11 === 3)) {
        lintels.push({ m: ringMatrix(theta + Math.PI / n, outerR, baseY + 0.75, len, 1.5, 1.6), c: stoneColor(i * 5, 0x8f7f69) });
      }
    }
  }
  group.add(instanced(pillars, stone, shadows));
  group.add(instanced(lintels, stone, shadows));

  const outside = new THREE.Mesh(new THREE.CircleGeometry(160, 24), mat(0x17110c));
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.4;
  outside.receiveShadow = shadows;
  group.add(outside);
}

function outward(zoneId: keyof typeof ZONE_INFO, extra: number): THREE.Vector3 {
  const z = ZONE_INFO[zoneId];
  const len = Math.hypot(z.x, z.z) || 1;
  const d = z.radius + extra;
  return new THREE.Vector3(z.x + (z.x / len) * d, 0, z.z + (z.z / len) * d);
}

export function buildColosseum(opts: { shadows?: boolean } = {}): Colosseum {
  const shadows = opts.shadows ?? true;
  const group = new THREE.Group();
  const pitCenter = new THREE.Vector3(ZONE_INFO.pit.x, 0, ZONE_INFO.pit.z);
  group.add(buildFloor(pitCenter));
  buildWalls(group, shadows);

  for (const id of ZONES) {
    if (id === 'pit') continue;
    const info = ZONE_INFO[id];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(info.radius - 0.12, info.radius + 0.05, 40),
      new THREE.MeshBasicMaterial({ color: id === 'sand' ? 0x5b4220 : 0x4a3418, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(info.x, 0.05, info.z);
    group.add(ring);
  }

  // The Gate
  const gate = new THREE.Group();
  gate.position.set(0, 0, -WALL_R);
  const frameMat = mat(0x5d5143);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4.2, 1.9), frameMat);
    pillar.position.set(side * 2.2, 2.1, 0);
    pillar.castShadow = shadows;
    gate.add(pillar);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.9, 1.9), frameMat);
  lintel.position.set(0, 4.0, 0);
  gate.add(lintel);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.14, 0.1), new THREE.MeshStandardMaterial({ color: 0xffcf6b, emissive: 0xffb43a, emissiveIntensity: 1.6 }));
  strip.position.set(0, 3.45, 0.98);
  gate.add(strip);
  const tunnel = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.3, 7), mat(0x0c0806));
  tunnel.position.set(0, 1.6, -3.6);
  gate.add(tunnel);
  const doorMat = mat(0x4a2f1a, { metalness: 0.2 });
  const doors: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * 1.75, 0, 0.75);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.75, 3.2, 0.22), doorMat);
    door.position.set(-side * 0.875, 1.6, 0);
    door.castShadow = shadows;
    hinge.add(door);
    for (let k = 0; k < 3; k++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.1, 0.26), mat(0x2a2420, { metalness: 0.6 }));
      band.position.set(-side * 0.875, 0.6 + k * 1.1, 0);
      hinge.add(band);
    }
    doors.push(hinge);
    gate.add(hinge);
  }
  const gateLight = new THREE.PointLight(0xffc56b, 0, 22, 1.4);
  gateLight.position.set(0, 2.6, 2.5);
  gate.add(gateLight);
  group.add(gate);
  const gatePosition = new THREE.Vector3(0, 0, -WALL_R - 2.5);

  // Warden's balcony
  const balcony = new THREE.Group();
  const bTheta = -18 * DEG;
  balcony.position.set(Math.cos(bTheta) * WALL_R, 0, Math.sin(bTheta) * WALL_R);
  balcony.rotation.y = -bTheta - Math.PI / 2;
  const platform = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 3.2), mat(0x6a5b4a));
  platform.position.set(0, 4.3, 0.9);
  platform.castShadow = shadows;
  balcony.add(platform);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(6, 0.55, 0.14), mat(0x3d3329));
  rail.position.set(0, 4.85, 2.45);
  balcony.add(rail);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.6, 0.06), mat(0x6b0d10));
  banner.position.set(0, 2.85, 2.5);
  balcony.add(banner);
  const sigil = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), new THREE.MeshStandardMaterial({ color: 0xf2c46d, emissive: 0x6b4a10 }));
  sigil.position.set(0, 3.1, 2.56);
  balcony.add(sigil);
  const warden = new THREE.Group();
  warden.position.set(0, 4.55, 0.7);
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.8, 6), mat(0x17120f));
  robe.position.y = 1.4;
  robe.castShadow = shadows;
  warden.add(robe);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), mat(0x221b16));
  head.position.y = 3.0;
  warden.add(head);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.95, 6), mat(0x120e0b));
  hood.position.y = 3.35;
  warden.add(hood);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffc04d, emissive: 0xffa21f, emissiveIntensity: 3 });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), eyeMat);
  eye.position.set(0, 3.0, 0.38);
  warden.add(eye);
  balcony.add(warden);
  group.add(balcony);

  // The Well
  const wellPos = outward('well', 1.0);
  const well = new THREE.Group();
  well.position.copy(wellPos);
  const ringStone = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.4, 0.9, 8), mat(0x7f725f));
  ringStone.position.y = 0.45;
  ringStone.castShadow = shadows;
  well.add(ringStone);
  const water = new THREE.Mesh(new THREE.CircleGeometry(1.05, 8), new THREE.MeshStandardMaterial({ color: 0x2d6b86, emissive: 0x0b2a38, roughness: 0.3 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.82;
  well.add(water);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.3, 0.14), mat(0x4b3420));
    post.position.set(side * 1.15, 1.6, 0);
    well.add(post);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 0.9, 4), mat(0x8a3a24));
  roof.position.y = 3.1;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = shadows;
  well.add(roof);
  group.add(well);

  // The Workyard
  const yardPos = outward('yard', 0.9);
  const crateMat = mat(0x7a5230);
  const blockMat = mat(0x8d8272);
  for (let i = 0; i < 7; i++) {
    const big = i % 3 === 0;
    const size = big ? 1.1 : 0.75;
    const box = new THREE.Mesh(new THREE.BoxGeometry(size * (big ? 1.6 : 1), size, size), big ? blockMat : crateMat);
    const a = i * 0.9;
    box.position.set(yardPos.x + Math.cos(a) * (0.8 + (i % 2) * 0.9), size / 2 + (i === 5 ? 0.75 : 0), yardPos.z + Math.sin(a) * (0.8 + (i % 2) * 0.9));
    box.rotation.y = a * 1.3;
    box.castShadow = shadows;
    group.add(box);
  }

  // The Pit
  const rockMat = mat(0x3a1d18);
  const toCenter = Math.atan2(-pitCenter.z, -pitCenter.x);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const gap = Math.abs(Math.atan2(Math.sin(a - toCenter), Math.cos(a - toCenter)));
    if (gap < 0.45) continue;
    const s = 0.28 + hash(i, 3.3) * 0.38;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
    const r = 4.0 + hash(i, 9.1) * 0.6;
    rock.position.set(pitCenter.x + Math.cos(a) * r, s * 0.4, pitCenter.z + Math.sin(a) * r);
    rock.rotation.set(hash(i, 1) * 3, hash(i, 2) * 3, 0);
    rock.castShadow = shadows;
    group.add(rock);
    if (i % 3 === 0) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.14, 1.3, 4), mat(0x5a1410));
      spike.position.set(pitCenter.x + Math.cos(a) * (r + 0.6), 0.6, pitCenter.z + Math.sin(a) * (r + 0.6));
      spike.rotation.z = (hash(i, 5) - 0.5) * 0.5;
      group.add(spike);
    }
  }
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(7.5, 32),
    new THREE.MeshBasicMaterial({ map: glowTexture('rgba(200,10,20,0.5)', 'rgba(120,0,0,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(pitCenter.x, 0.08, pitCenter.z);
  group.add(glow);
  const pitLight = new THREE.PointLight(0xff1020, 40, 16, 1.7);
  pitLight.position.set(pitCenter.x, 3.2, pitCenter.z);
  group.add(pitLight);

  // Torches on the podium
  const flames: THREE.Mesh[] = [];
  const flameMat = new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff7a1a, emissiveIntensity: 2.4 });
  for (let i = 0; i < 12; i++) {
    const theta = ((i + 0.5) / 12) * Math.PI * 2;
    if (Math.abs(theta - (2 * Math.PI + bTheta)) < 8 * DEG) continue;
    const x = Math.cos(theta) * (WALL_R - 0.5);
    const z = Math.sin(theta) * (WALL_R - 0.5);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.16), mat(0x3a2a1c));
    post.position.set(x, 3.6, z);
    group.add(post);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 5), flameMat);
    flame.position.set(x, 4.25, z);
    flames.push(flame);
    group.add(flame);
  }
  const warm = new THREE.PointLight(0xff9a4a, 30, 30, 1.6);
  warm.position.set(-14, 6, -18);
  group.add(warm);

  let gateOpenFor = 0;
  let doorAngle = 0;
  let blackout = false;

  return {
    group,
    gatePosition,
    pitCenter,
    update(dt, t) {
      flames.forEach((f, i) => {
        const s = 1 + Math.sin(t * 13 + i * 1.7) * 0.12 + Math.sin(t * 29 + i) * 0.06;
        f.scale.set(1, blackout ? s * 0.6 : s, 1);
      });
      pitLight.intensity = 38 + Math.sin(t * 9.1) * 9 + Math.sin(t * 23.7) * 4;
      warden.rotation.y = blackout ? 0 : Math.sin(t * 0.35) * 0.7;
      head.rotation.x = blackout ? 0.5 : 0;
      eyeMat.emissiveIntensity = blackout ? 0 : 2.6 + Math.sin(t * 2.2) * 0.6;
      gateOpenFor = Math.max(0, gateOpenFor - dt);
      const target = gateOpenFor > 0 ? 1.35 : 0;
      doorAngle += (target - doorAngle) * Math.min(1, dt * 2.5);
      doors[0].rotation.y = doorAngle;
      doors[1].rotation.y = -doorAngle;
      gateLight.intensity = 90 * doorAngle;
    },
    setBlackout(on) {
      blackout = on;
    },
    openGate(seconds = 4) {
      gateOpenFor = seconds;
    },
  };
}
