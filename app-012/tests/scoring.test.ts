import { describe, it, expect } from 'vitest';
import { scoreRound, calculateSatisfactionChange } from '../src/scoring';
import { judgeWeight } from '../src/weighing';

describe('scoreRound', () => {
  it('should return base score for ok result', () => {
    const result = judgeWeight(10, 10, 1);
    const score = scoreRound(result, 1, 0, 5, 60);
    expect(score.base).toBe(100);
    expect(score.precisionBonus).toBe(50);
    expect(score.total).toBeGreaterThan(100);
  });

  it('should give precision bonus based on accuracy', () => {
    const perfect = judgeWeight(10, 10, 1);
    const good = judgeWeight(10.5, 10, 1);
    const warn = judgeWeight(10.8, 10, 1);

    const s1 = scoreRound(perfect, 1, 0, 5, 60);
    const s2 = scoreRound(good, 1, 0, 5, 60);
    const s3 = scoreRound(warn, 1, 0, 5, 60);

    expect(s1.precisionBonus).toBe(50);
    expect(s2.precisionBonus).toBe(30);
    expect(s3.precisionBonus).toBe(10);
  });

  it('should add combo bonus', () => {
    const result = judgeWeight(10, 10, 1);
    const s1 = scoreRound(result, 1, 0, 5, 60);
    const s2 = scoreRound(result, 1, 3, 5, 60);
    expect(s2.comboBonus).toBeGreaterThan(s1.comboBonus);
  });

  it('should cap combo bonus at 50', () => {
    const result = judgeWeight(10, 10, 1);
    const score = scoreRound(result, 1, 100, 5, 60);
    expect(score.comboBonus).toBe(50);
  });

  it('should apply time penalty for slow play', () => {
    const result = judgeWeight(10, 10, 1);
    const fast = scoreRound(result, 1, 0, 10, 60);
    const slow = scoreRound(result, 1, 0, 55, 60);
    expect(slow.timePenalty).toBeLessThan(fast.timePenalty);
  });

  it('should zero precision bonus and add penalty for fail', () => {
    const result = judgeWeight(15, 10, 1);
    const score = scoreRound(result, 1, 0, 5, 60);
    expect(score.precisionBonus).toBe(0);
    expect(score.timePenalty).toBeLessThan(-20);
    expect(score.total).toBe(0);
  });

  it('should halve precision bonus for warning', () => {
    const result = judgeWeight(11.2, 10, 0.5);
    const score = scoreRound(result, 0.5, 0, 5, 60);
    expect(score.precisionBonus).toBeLessThan(25);
  });

  it('should never return negative total', () => {
    const result = judgeWeight(20, 10, 1);
    const score = scoreRound(result, 1, 0, 100, 60);
    expect(score.total).toBe(0);
  });
});

describe('calculateSatisfactionChange', () => {
  it('should increase for all ok results', () => {
    const results = [
      judgeWeight(10, 10, 1),
      judgeWeight(12, 12, 1),
    ];
    expect(calculateSatisfactionChange(results, 1)).toBe(10);
  });

  it('should decrease for warning results', () => {
    const results = [judgeWeight(10.7, 10, 0.5)];
    expect(calculateSatisfactionChange(results, 0.5)).toBe(-5);
  });

  it('should decrease more for fail results', () => {
    const results = [judgeWeight(13, 10, 0.5)];
    expect(calculateSatisfactionChange(results, 0.5)).toBe(-15);
  });

  it('should handle mixed results', () => {
    const results = [
      judgeWeight(10, 10, 1),
      judgeWeight(10.7, 10, 0.5),
      judgeWeight(10.3, 10, 0.5),
    ];
    expect(calculateSatisfactionChange(results, 0.5)).toBe(5);
  });
});
