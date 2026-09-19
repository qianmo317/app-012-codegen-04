import type { WeighResult } from './types';

export function judgeWeight(actual: number, target: number, tolerance: number): WeighResult {
  const deltaG = actual - target;
  const absDelta = Math.abs(deltaG);
  const ok = absDelta <= tolerance;
  return { herb: '', target, actual, ok, deltaG };
}

export function getWeightStatus(result: WeighResult, tolerance: number): 'perfect' | 'good' | 'warning' | 'fail' {
  const absDelta = Math.abs(result.deltaG);
  if (absDelta <= tolerance * 0.3) return 'perfect';
  if (absDelta <= tolerance) return 'good';
  if (absDelta <= tolerance * 2) return 'warning';
  return 'fail';
}

export function calculatePointerPosition(loadGrams: number, zeroOffset: number, fullScale: number): number {
  return Math.max(0, Math.min(1, (loadGrams - zeroOffset) / fullScale));
}

export function discreteWeight(delta: number, currentWeight: number): number {
  const step = delta > 0 ? getWeightStep(currentWeight) : -getWeightStep(currentWeight);
  return Math.max(0, parseFloat((currentWeight + step).toFixed(1)));
}

function getWeightStep(weight: number): number {
  if (weight >= 50) return 10;
  if (weight >= 20) return 5;
  if (weight >= 10) return 2;
  return 1;
}

export function fineTuneWeight(currentWeight: number, direction: number): number {
  return Math.max(0, parseFloat((currentWeight + direction * 0.5).toFixed(1)));
}
