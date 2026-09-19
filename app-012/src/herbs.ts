import type { HerbMeta } from './types';

export const HERBS: HerbMeta[] = [
  { name: '白芍', color: '#f5f0e8', similar: ['赤芍'] },
  { name: '赤芍', color: '#c85a54', similar: ['白芍'] },
  { name: '生地', color: '#8b4513', similar: ['熟地'] },
  { name: '熟地', color: '#2a0a0a', similar: ['生地'] },
  { name: '黄芪', color: '#d4b896', similar: [] },
  { name: '当归', color: '#8b3a3a', similar: [] },
  { name: '川芎', color: '#e8d4c4', similar: [] },
  { name: '白术', color: '#c8bca0', similar: ['苍术'] },
  { name: '苍术', color: '#6b5b3e', similar: ['白术'] },
  { name: '茯苓', color: '#f0ebe0', similar: [] },
  { name: '党参', color: '#d4a574', similar: ['丹参'] },
  { name: '丹参', color: '#8b4513', similar: ['党参'] },
  { name: '甘草', color: '#e8dcc8', similar: [] },
  { name: '桂枝', color: '#c8956c', similar: [] },
  { name: '柴胡', color: '#a0826d', similar: [] },
  { name: '黄芩', color: '#d4af37', similar: ['黄连'] },
  { name: '黄连', color: '#c9b037', similar: ['黄芩'] },
  { name: '黄柏', color: '#8b8b00', similar: [] },
  { name: '知母', color: '#f5f5dc', similar: [] },
  { name: '贝母', color: '#e8e0d4', similar: [] },
  { name: '杏仁', color: '#d2b48c', similar: ['桃仁'] },
  { name: '桃仁', color: '#8b4513', similar: ['杏仁'] },
  { name: '红花', color: '#dc143c', similar: [] },
  { name: '枸杞', color: '#8b0000', similar: [] },
  { name: '菊花', color: '#fffacd', similar: [] },
  { name: '薄荷', color: '#98fb98', similar: [] },
  { name: '陈皮', color: '#d2691e', similar: ['青皮'] },
  { name: '青皮', color: '#8fbc8f', similar: ['陈皮'] },
  { name: '半夏', color: '#f5f5dc', similar: [] },
  { name: '远志', color: '#daa520', similar: [] },
  { name: '酸枣仁', color: '#8b4513', similar: [] },
  { name: '五味子', color: '#4a0e0e', similar: [] },
];

export function getHerbByName(name: string): HerbMeta | undefined {
  return HERBS.find(h => h.name === name);
}

export function getRandomHerbs(count: number, includeSimilar: boolean): HerbMeta[] {
  const pool = includeSimilar ? HERBS : HERBS.filter(h => !h.similar || h.similar.length === 0);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const selected: HerbMeta[] = [];
  const usedNames = new Set<string>();

  for (const herb of shuffled) {
    if (selected.length >= count) break;
    if (usedNames.has(herb.name)) continue;
    selected.push(herb);
    usedNames.add(herb.name);
    if (herb.similar && herb.similar.length > 0 && includeSimilar) {
      const similar = HERBS.find(h => h.name === herb.similar![0]);
      if (similar && !usedNames.has(similar.name)) {
        selected.push(similar);
        usedNames.add(similar.name);
      }
    }
  }

  while (selected.length < count) {
    const idx = Math.floor(Math.random() * HERBS.length);
    const h = HERBS[idx];
    if (!usedNames.has(h.name)) {
      selected.push(h);
      usedNames.add(h.name);
    }
  }

  return selected.slice(0, count).sort(() => Math.random() - 0.5);
}
