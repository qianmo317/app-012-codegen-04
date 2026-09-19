import { describe, it, expect } from 'vitest';
import { getLevelConfig, LEVELS } from '../src/levels';

describe('LEVELS', () => {
  it('should have 12 predefined levels', () => {
    expect(LEVELS.length).toBe(12);
  });

  it('should have increasing difficulty', () => {
    expect(LEVELS[0].herbCount).toBe(3);
    expect(LEVELS[0].tolerance).toBe(1.0);
    expect(LEVELS[3].herbCount).toBe(5);
    expect(LEVELS[3].tolerance).toBe(0.5);
  });

  it('should not require tare for early levels', () => {
    expect(LEVELS[0].requireTare).toBe(false);
    expect(LEVELS[8].requireTare).toBe(true);
  });

  it('should enable decoct split from level 9', () => {
    expect(LEVELS[7].enableDecoctSplit).toBe(false);
    expect(LEVELS[8].enableDecoctSplit).toBe(true);
  });
});

describe('getLevelConfig', () => {
  it('should return predefined config for levels 1-12', () => {
    expect(getLevelConfig(1).level).toBe(1);
    expect(getLevelConfig(12).level).toBe(12);
  });

  it('should generate harder config for levels beyond 12', () => {
    const config = getLevelConfig(15);
    expect(config.level).toBe(15);
    expect(config.tolerance).toBeLessThanOrEqual(0.3);
    expect(config.timeLimit).toBeLessThanOrEqual(60);
  });

  it('should cap herb count at 8', () => {
    const config = getLevelConfig(100);
    expect(config.herbCount).toBeLessThanOrEqual(8);
  });

  it('should not let tolerance go below 0.2', () => {
    const config = getLevelConfig(1000);
    expect(config.tolerance).toBeGreaterThanOrEqual(0.2);
  });
});
