import * as THREE from 'three';
import { ZONES } from '../../shared/arena';
import type { ItemKind, Loot, ZoneId } from '../../shared/types';
import { lootSpot } from './layout';

function keyMesh(material: THREE.Material): THREE.Group {
  const key = new THREE.Group();
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.045, 5, 8), material);
  bow.position.y = 0.2;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.06), material);
  shaft.position.y = -0.06;
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), material);
  tooth.position.set(0.06, -0.18, 0);
  key.add(bow, shaft, tooth);
  return key;
}

/** Items lying on the sand: spinning golden keys, ration loaves and dropped shields. */
export class LootLayer {
  readonly group = new THREE.Group();
  private signature = '';
  private keys: THREE.Object3D[] = [];
  private readonly keyMat = new THREE.MeshStandardMaterial({ color: 0xffcc4d, emissive: 0x8a5a00, emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.35, flatShading: true });
  private readonly rationMat = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, flatShading: true });
  private readonly shieldMat = new THREE.MeshStandardMaterial({ color: 0x9c8a64, metalness: 0.5, roughness: 0.5, flatShading: true });

  sync(ground: Record<ZoneId, Loot>): void {
    const signature = JSON.stringify(ground);
    if (signature === this.signature) return;
    this.signature = signature;
    this.group.clear();
    this.keys = [];
    for (const zone of ZONES) {
      const loot = ground[zone];
      if (!loot) continue;
      const spot = lootSpot(zone);
      const items: ItemKind[] = [
        ...Array<ItemKind>(Math.min(loot.key, 6)).fill('key'),
        ...Array<ItemKind>(Math.min(loot.shield, 4)).fill('shield'),
        ...Array<ItemKind>(Math.min(loot.ration, 8)).fill('ration'),
      ];
      items.forEach((item, i) => {
        const a = i * 2.4;
        const r = 0.32 * Math.sqrt(i);
        const x = spot.x + Math.cos(a) * r;
        const z = spot.z + Math.sin(a) * r;
        let mesh: THREE.Object3D;
        if (item === 'key') {
          mesh = keyMesh(this.keyMat);
          mesh.position.set(x, 0.5, z);
          mesh.userData.phase = i;
          this.keys.push(mesh);
        } else if (item === 'shield') {
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 8), this.shieldMat);
          mesh.position.set(x, 0.06, z);
        } else {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), this.rationMat);
          mesh.position.set(x, 0.12, z);
          mesh.rotation.y = a;
        }
        mesh.castShadow = true;
        this.group.add(mesh);
      });
    }
  }

  update(t: number): void {
    for (const key of this.keys) {
      key.rotation.y = t * 1.6 + (key.userData.phase as number);
      key.position.y = 0.5 + Math.sin(t * 2.5 + (key.userData.phase as number)) * 0.08;
    }
  }
}
