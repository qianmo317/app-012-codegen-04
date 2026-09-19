import type { ScoreBreakdown, WeighResult } from './types';

export function scoreRound(result: WeighResult, tolerance: number, combo: number, timeUsed: number, timeLimit: number | null): ScoreBreakdown {
  const base = 100;
  const absDelta = Math.abs(result.deltaG);

  let precisionBonus = 0;
  if (absDelta <= tolerance * 0.3) {
    precisionBonus = 50;
  } else if (absDelta <= tolerance * 0.6) {
    precisionBonus = 30;
  } else if (absDelta <= tolerance) {
    precisionBonus = 10;
  }

  const comboBonus = Math.min(50, combo * 10);

  let timePenalty = 0;
  if (timeLimit && timeLimit > 0) {
    const ratio = timeUsed / timeLimit;
    if (ratio > 0.8) timePenalty = -20;
    else if (ratio > 0.6) timePenalty = -10;
  }

  let total = 0;
  if (absDelta > tolerance * 2) {
    precisionBonus = 0;
    timePenalty -= 30;
    total = 0;
  } else if (absDelta > tolerance) {
    precisionBonus = Math.floor(precisionBonus / 2);
    total = Math.max(0, base + precisionBonus + comboBonus + timePenalty);
  } else {
    total = Math.max(0, base + precisionBonus + comboBonus + timePenalty);
  }

  return { base, precisionBonus, comboBonus, timePenalty, total };
}

export function calculateSatisfactionChange(results: WeighResult[], tolerance: number): number {
  let change = 0;
  for (const r of results) {
    const status = Math.abs(r.deltaG) <= tolerance ? 'ok' : Math.abs(r.deltaG) <= tolerance * 2 ? 'warn' : 'fail';
    if (status === 'ok') change += 5;
    else if (status === 'warn') change -= 5;
    else change -= 15;
  }
  return change;
}
