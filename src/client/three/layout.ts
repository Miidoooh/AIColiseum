import { ZONE_INFO } from '../../shared/arena';
import type { ZoneId } from '../../shared/types';

const ZONE_SPIN: Record<ZoneId, number> = { sand: 0.3, gate: 1.2, balcony: 2.1, well: 0.7, pit: 2.6, yard: 1.7 };

/** Where the i-th of `count` fighters stands inside a zone. */
export function slotPosition(zone: ZoneId, index: number, count: number): { x: number; z: number } {
  const info = ZONE_INFO[zone];
  if (count <= 1) return { x: info.x + 0.4, z: info.z + 0.4 };
  const radius = Math.min(info.radius - 0.4, 0.9 + count * 0.28);
  const angle = (index / count) * Math.PI * 2 + ZONE_SPIN[zone];
  return { x: info.x + Math.cos(angle) * radius, z: info.z + Math.sin(angle) * radius };
}

/** Spot where loot lying on the ground is drawn for a zone. */
export function lootSpot(zone: ZoneId): { x: number; z: number } {
  const info = ZONE_INFO[zone];
  const toCenter = Math.atan2(-info.z, -info.x);
  const angle = zone === 'sand' ? 0.8 : toCenter + 0.9;
  const r = zone === 'sand' ? 1.2 : info.radius * 0.75;
  return { x: info.x + Math.cos(angle) * r, z: info.z + Math.sin(angle) * r };
}
