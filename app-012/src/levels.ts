import type { LevelConfig } from './types';

export const LEVELS: LevelConfig[] = [
  { level: 1, herbCount: 3, tolerance: 1.0, timeLimit: null, hasSimilarHerbs: false, requireTare: false, requireOrganize: false, enableDecoctSplit: false },
  { level: 2, herbCount: 3, tolerance: 1.0, timeLimit: null, hasSimilarHerbs: false, requireTare: false, requireOrganize: false, enableDecoctSplit: false },
  { level: 3, herbCount: 3, tolerance: 1.0, timeLimit: null, hasSimilarHerbs: false, requireTare: false, requireOrganize: false, enableDecoctSplit: false },
  { level: 4, herbCount: 5, tolerance: 0.5, timeLimit: 120, hasSimilarHerbs: true, requireTare: false, requireOrganize: false, enableDecoctSplit: false },
  { level: 5, herbCount: 5, tolerance: 0.5, timeLimit: 120, hasSimilarHerbs: true, requireTare: false, requireOrganize: false, enableDecoctSplit: false },
  { level: 6, herbCount: 5, tolerance: 0.5, timeLimit: 120, hasSimilarHerbs: true, requireTare: false, requireOrganize: false, enableDecoctSplit: false },
  { level: 7, herbCount: 5, tolerance: 0.5, timeLimit: 120, hasSimilarHerbs: true, requireTare: false, requireOrganize: false, enableDecoctSplit: false },
  { level: 8, herbCount: 5, tolerance: 0.5, timeLimit: 120, hasSimilarHerbs: true, requireTare: false, requireOrganize: false, enableDecoctSplit: false },
  { level: 9, herbCount: 6, tolerance: 0.5, timeLimit: 90, hasSimilarHerbs: true, requireTare: true, requireOrganize: false, enableDecoctSplit: true },
  { level: 10, herbCount: 6, tolerance: 0.5, timeLimit: 90, hasSimilarHerbs: true, requireTare: true, requireOrganize: false, enableDecoctSplit: true },
  { level: 11, herbCount: 7, tolerance: 0.5, timeLimit: 90, hasSimilarHerbs: true, requireTare: true, requireOrganize: true, enableDecoctSplit: true },
  { level: 12, herbCount: 7, tolerance: 0.3, timeLimit: 75, hasSimilarHerbs: true, requireTare: true, requireOrganize: true, enableDecoctSplit: true },
];

export function getLevelConfig(level: number): LevelConfig {
  if (level <= LEVELS.length) return LEVELS[level - 1];

  const base = LEVELS[LEVELS.length - 1];
  const extra = level - LEVELS.length;
  return {
    ...base,
    level,
    herbCount: Math.min(8, base.herbCount + Math.floor(extra / 3)),
    tolerance: Math.max(0.2, base.tolerance - extra * 0.05),
    timeLimit: base.timeLimit ? Math.max(30, base.timeLimit - extra * 5) : 60,
    requireOrganize: true,
  };
}
