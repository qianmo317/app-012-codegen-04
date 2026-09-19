import { describe, it, expect } from 'vitest';
import { judgeWeight, getWeightStatus, calculatePointerPosition, fineTuneWeight } from '../src/weighing';

describe('judgeWeight', () => {
  it('should pass when exact match', () => {
    const result = judgeWeight(10, 10, 1);
    expect(result.ok).toBe(true);
    expect(result.deltaG).toBe(0);
  });

  it('should pass within tolerance', () => {
    const result = judgeWeight(10.5, 10, 1);
    expect(result.ok).toBe(true);
    expect(result.deltaG).toBe(0.5);
  });

  it('should fail when exceeding tolerance', () => {
    const result = judgeWeight(12, 10, 1);
    expect(result.ok).toBe(false);
    expect(result.deltaG).toBe(2);
  });

  it('should handle negative delta', () => {
    const result = judgeWeight(9.5, 10, 1);
    expect(result.ok).toBe(true);
    expect(result.deltaG).toBe(-0.5);
  });

  it('should set herb and target fields', () => {
    const result = judgeWeight(10, 15, 0.5);
    expect(result.target).toBe(15);
    expect(result.actual).toBe(10);
    expect(result.herb).toBe('');
  });
});

describe('getWeightStatus', () => {
  it('should return perfect for very small delta', () => {
    const result = judgeWeight(10, 10, 1);
    expect(getWeightStatus(result, 1)).toBe('perfect');
  });

  it('should return good for within tolerance', () => {
    const result = judgeWeight(10.6, 10, 1);
    expect(getWeightStatus(result, 1)).toBe('good');
  });

  it('should return warning for within 2x tolerance', () => {
    const result = judgeWeight(10.7, 10, 0.5);
    expect(getWeightStatus(result, 0.5)).toBe('warning');
  });

  it('should return fail for exceeding 2x tolerance', () => {
    const result = judgeWeight(13, 10, 1);
    expect(getWeightStatus(result, 1)).toBe('fail');
  });
});

describe('calculatePointerPosition', () => {
  it('should return 0 at zero offset', () => {
    expect(calculatePointerPosition(0, 0, 50)).toBe(0);
  });

  it('should return 1 at full scale', () => {
    expect(calculatePointerPosition(50, 0, 50)).toBe(1);
  });

  it('should return 0.5 at half scale', () => {
    expect(calculatePointerPosition(25, 0, 50)).toBe(0.5);
  });

  it('should clamp below 0', () => {
    expect(calculatePointerPosition(-5, 0, 50)).toBe(0);
  });

  it('should clamp above 1', () => {
    expect(calculatePointerPosition(100, 0, 50)).toBe(1);
  });

  it('should account for zero offset', () => {
    expect(calculatePointerPosition(15, 5, 50)).toBe(0.2);
  });
});

describe('fineTuneWeight', () => {
  it('should increase weight by 0.5', () => {
    expect(fineTuneWeight(10, 1)).toBe(10.5);
  });

  it('should decrease weight by 0.5', () => {
    expect(fineTuneWeight(10, -1)).toBe(9.5);
  });

  it('should not go below 0', () => {
    expect(fineTuneWeight(0.2, -1)).toBe(0);
  });
});
