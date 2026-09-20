import { beforeAll, describe, expect, it } from 'vitest';
import { ScheduleStore } from './store';
import type { PatientInput, SchedulerConfig } from './types';

// 内存版 localStorage 垫片（本项目 jsdom 30/undici 8 在当前 Node 上无法初始化）
beforeAll(() => {
  const map = new Map<string, string>();
  (globalThis as { localStorage: Storage }).localStorage = {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
  };
});

function makePatient(id: string, startDate = '2026-09-20', doseCount = 3): PatientInput {
  return { id, name: `病人${id}`, startDate, daysPerDose: 1, doseCount, overrides: [] };
}

const config: SchedulerConfig = {
  closedDays: [],
  furnaceCapacity: 10,
  gatherLead: 1,
  decoctLead: 1,
};

describe('ScheduleStore', () => {
  it('初始排期可直接读取', () => {
    const store = new ScheduleStore({ patients: [makePatient('p1')], config });
    const r = store.getResult();
    expect(r.doses).toHaveLength(3);
    expect(r.doses[0]).toMatchObject({ gatherDate: '2026-09-17', sendDate: '2026-09-18', pickupDate: '2026-09-19' });
  });

  it('setOverride 改送煎日后自动重算，并返回受影响的剂', () => {
    const store = new ScheduleStore({ patients: [makePatient('p1')], config });
    const changed = store.setOverride('p1', 1, 'send', '2026-09-25');
    const d1 = store.getResult().doses[0];
    expect(d1.sendDate).toBe('2026-09-25');
    expect(d1.gatherDate).toBe('2026-09-24');
    expect(d1.pickupDate).toBe('2026-09-26');
    expect(d1.pinned).toBe('send');
    expect(changed.find(c => c.doseIndex === 1)?.fields).toContain('send');
  });

  it('同一剂再改别的环节按替换处理，不产生重复锁定', () => {
    const store = new ScheduleStore({ patients: [makePatient('p1')], config });
    store.setOverride('p1', 1, 'send', '2026-09-25');
    store.setOverride('p1', 1, 'pickup', '2026-09-26');
    const d1 = store.getResult().doses[0];
    expect(d1.pinned).toBe('pickup');
    expect(d1.pickupDate).toBe('2026-09-26');
  });

  it('取消锁定后恢复自动排期', () => {
    const store = new ScheduleStore({ patients: [makePatient('p1')], config });
    store.setOverride('p1', 1, 'send', '2026-09-25');
    const changed = store.setOverride('p1', 1, 'send', null);
    const d1 = store.getResult().doses[0];
    expect(d1.pinned).toBeNull();
    expect(d1.sendDate).toBe('2026-09-18');
    expect(changed.find(c => c.doseIndex === 1)).toBeTruthy();
  });

  it('改期挤掉后续剂的炉子时，受影响的后续日子一并重算', () => {
    const store = new ScheduleStore({
      patients: [makePatient('p1', '2026-09-22', 2)],
      config: { ...config, furnaceCapacity: 1 },
    });
    // 剂1 理想送 09-20、剂2 理想送 09-21；把剂1 强改到 09-21 → 剂2 顺延 09-22
    const changed = store.setOverride('p1', 1, 'send', '2026-09-21');
    const r = store.getResult();
    expect(r.doses[1].sendDate).toBe('2026-09-22');
    expect(changed.find(c => c.doseIndex === 2)?.fields).toContain('send');
  });

  it('更新歇业日后全部重算', () => {
    const store = new ScheduleStore({ patients: [makePatient('p1', '2026-09-20', 1)], config });
    store.updateConfig({ closedDays: ['2026-09-19'] });
    expect(store.getResult().doses[0].pickupDate).toBe('2026-09-18');
  });

  it('增减病人后重算', () => {
    const store = new ScheduleStore({ patients: [makePatient('p1', '2026-09-20', 1)], config });
    store.upsertPatient(makePatient('p2', '2026-09-20', 1));
    expect(store.getResult().doses).toHaveLength(2);
    store.removePatient('p1');
    expect(store.getResult().doses.map(d => d.patientId)).toEqual(['p2']);
  });

  it('对不存在的剂改期抛错', () => {
    const store = new ScheduleStore({ patients: [makePatient('p1', '2026-09-20', 1)], config });
    expect(() => store.setOverride('p1', 2, 'send', '2026-09-25')).toThrow('不存在');
    expect(() => store.setOverride('nope', 1, 'send', '2026-09-25')).toThrow('找不到');
  });

  it('localStorage 持久化：第二个仓库实例读到之前的改动', () => {
    localStorage.clear();
    const store = new ScheduleStore(
      { patients: [makePatient('p1', '2026-09-20', 1)], config },
      true,
    );
    store.setOverride('p1', 1, 'send', '2026-09-25');

    const restored = new ScheduleStore(
      { patients: [], config },
      true,
    );
    expect(restored.getResult().doses[0].sendDate).toBe('2026-09-25');
    localStorage.clear();
  });
});
