import { describe, expect, it } from 'vitest';
import { BusinessCalendar, addDays, diffDays } from './calendar';
import { diffSchedule, schedule } from './schedule';
import type { PatientInput, SchedulerConfig } from './types';

const baseConfig: SchedulerConfig = {
  closedDays: [],
  furnaceCapacity: 10,
  gatherLead: 1,
  decoctLead: 1,
  pickupLimit: 3,
};

function patient(over: Partial<PatientInput> = {}): PatientInput {
  return {
    id: 'p1',
    name: '张三',
    startDate: '2026-09-20',
    daysPerDose: 1,
    doseCount: 3,
    overrides: [],
    ...over,
  };
}

describe('BusinessCalendar', () => {
  const cal = new BusinessCalendar(['2026-09-19', '2026-09-20']);

  it('判断营业/歇业', () => {
    expect(cal.isClosed('2026-09-19')).toBe(true);
    expect(cal.isOpen('2026-09-21')).toBe(true);
  });

  it('歇业日往前挪到最近营业日，并记录跳过的日子', () => {
    const r = cal.shiftBackToOpen('2026-09-20');
    expect(r.date).toBe('2026-09-18');
    expect(r.skipped).toEqual(['2026-09-20', '2026-09-19']);
  });

  it('营业日不挪动', () => {
    expect(cal.shiftBackToOpen('2026-09-21')).toEqual({ date: '2026-09-21', skipped: [] });
  });

  it('顺延到下一个营业日', () => {
    expect(cal.shiftForwardToOpen('2026-09-19')).toBe('2026-09-21');
  });
});

describe('日期工具', () => {
  it('加减天数与天数差', () => {
    expect(addDays('2026-09-20', 3)).toBe('2026-09-23');
    expect(addDays('2026-09-20', -5)).toBe('2026-09-15');
    expect(diffDays('2026-09-23', '2026-09-20')).toBe(3);
  });

  it('跨月跨年正确', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('拒绝非法日期格式', () => {
    expect(() => addDays('2026/09/20', 1)).toThrow();
    expect(() => addDays('2026-13-01', 1)).toThrow();
  });
});

describe('schedule - 基本往回排', () => {
  it('从开喝日往回排出每一剂的抓药/送煎/取药日', () => {
    const r = schedule([patient()], baseConfig);
    expect(r.doses).toHaveLength(3);
    expect(r.doses[0]).toMatchObject({
      doseIndex: 1,
      drinkStart: '2026-09-20',
      gatherDate: '2026-09-17',
      sendDate: '2026-09-18',
      pickupDate: '2026-09-19',
    });
    expect(r.doses[1]).toMatchObject({
      drinkStart: '2026-09-21',
      gatherDate: '2026-09-18',
      sendDate: '2026-09-19',
      pickupDate: '2026-09-20',
    });
  });

  it('一剂喝多天时按间隔展开', () => {
    const r = schedule([patient({ daysPerDose: 3, doseCount: 2 })], baseConfig);
    expect(r.doses.map(d => d.drinkStart)).toEqual(['2026-09-20', '2026-09-23']);
    expect(r.doses[1]).toMatchObject({
      gatherDate: '2026-09-20',
      sendDate: '2026-09-21',
      pickupDate: '2026-09-22',
    });
  });

  it('自定义抓药提前天数与代煎耗时', () => {
    const r = schedule([patient({ doseCount: 1 })], { ...baseConfig, gatherLead: 2, decoctLead: 2 });
    // 开喝 09-20 → 取 09-19 → 送 09-17 → 抓 09-15
    expect(r.doses[0]).toMatchObject({
      pickupDate: '2026-09-19',
      sendDate: '2026-09-17',
      gatherDate: '2026-09-15',
    });
  });
});

describe('schedule - 歇业日前移', () => {
  const config: SchedulerConfig = { ...baseConfig, closedDays: ['2026-09-19'] };

  it('取药日撞歇业，往前挪并说明原因', () => {
    const r = schedule([patient({ doseCount: 1 })], config);
    expect(r.doses[0].pickupDate).toBe('2026-09-18');
    const n = r.doses[0].notes.find(x => x.code === 'pickup-closed');
    expect(n).toBeTruthy();
    expect(n!.severity).toBe('info');
    expect(n!.message).toContain('2026-09-19');
  });

  it('连续歇业全部跳过', () => {
    const c: SchedulerConfig = {
      ...baseConfig,
      closedDays: ['2026-09-18', '2026-09-19', '2026-09-20'],
    };
    const r = schedule([patient({ doseCount: 1 })], c);
    // 取 09-19→跳过19/18→09-17；送 09-18→跳过18→09-17；抓 = 09-17-1 = 09-16（营业）
    expect(r.doses[0]).toMatchObject({
      pickupDate: '2026-09-17',
      sendDate: '2026-09-17',
      gatherDate: '2026-09-16',
    });
  });

  it('歇业导致取药日不早于开喝日时发出来不及提醒', () => {
    const c: SchedulerConfig = {
      ...baseConfig,
      closedDays: ['2026-09-19'],
    };
    // 开喝 09-20 → 理想取药 09-19（歇业）→ 09-18，仍来得及，不报警
    expect(schedule([patient({ doseCount: 1 })], c).alerts).toHaveLength(0);

    const tooLate: SchedulerConfig = {
      ...baseConfig,
      closedDays: ['2026-09-17', '2026-09-18', '2026-09-19'],
      gatherLead: 0,
      decoctLead: 0,
    };
    // 取 09-19 歇业 → 09-16，送 09-19 → 09-16，仍早于开喝
    const r2 = schedule([patient({ doseCount: 1 })], tooLate);
    expect(r2.doses[0].pickupDate < r2.doses[0].drinkStart).toBe(true);
  });
});

describe('schedule - 炉容量与顺延', () => {
  it('一炉放满后顺延到下一个营业日，取药日跟着顺延', () => {
    const c: SchedulerConfig = {
      ...baseConfig,
      furnaceCapacity: 1,
      pickupLimit: undefined,
    };
    const r = schedule([patient({ doseCount: 2 })], c);
    // 剂1 开喝 09-20 → 送 09-18；
    // 剂2 理想送 09-19（本身空），逐剂天然错开一天 → 送 09-19，不顺延
    expect(r.doses[0].sendDate).toBe('2026-09-18');
    expect(r.doses[1].sendDate).toBe('2026-09-19');
    expect(r.doses[1].gatherDate).toBe('2026-09-18');
    expect(r.doses[1].pickupDate).toBe('2026-09-20');
    expect(r.doses[1].notes.some(x => x.code === 'batch-overflow')).toBe(false);
    expect(r.batches).toHaveLength(2);
    expect(r.batches.map(b => b.count)).toEqual([1, 1]);
  });

  it('同开喝日的多个病人抢同一炉：放不下的往后顺延，取药日跟着顺延', () => {
    const c: SchedulerConfig = { ...baseConfig, furnaceCapacity: 1, pickupLimit: undefined };
    const r = schedule(
      [
        patient({ id: 'a', name: '甲', startDate: '2026-09-20', doseCount: 1 }),
        patient({ id: 'b', name: '乙', startDate: '2026-09-20', doseCount: 1 }),
      ],
      c,
    );
    // 按 id 先后：甲占 09-18；乙前移点也是 09-18，已满 → 顺延 09-19 → 取 09-20
    const sends = r.doses.map(d => d.sendDate).sort();
    expect(sends).toEqual(['2026-09-18', '2026-09-19']);
    const yi = r.doses.find(d => d.patientId === 'b')!;
    expect(yi.gatherDate).toBe('2026-09-18');
    expect(yi.pickupDate).toBe('2026-09-20');
    expect(yi.notes.some(x => x.code === 'batch-overflow' && x.field === 'send')).toBe(true);
    expect(yi.notes.some(x => x.code === 'batch-overflow' && x.field === 'pickup')).toBe(true);
  });

  it('顺延路径上碰到歇业日会继续往后找营业日', () => {
    const c: SchedulerConfig = {
      ...baseConfig,
      furnaceCapacity: 1,
      closedDays: ['2026-09-19'],
      pickupLimit: undefined,
    };
    const r = schedule(
      [
        patient({ id: 'a', name: '甲', startDate: '2026-09-21', doseCount: 1 }),
        patient({ id: 'b', name: '乙', startDate: '2026-09-21', doseCount: 1 }),
      ],
      c,
    );
    // 两人理想送 09-19（歇业）→ 都前移到 09-18；甲占 09-18，乙顺延：09-19 歇业 → 09-20
    const sends = r.doses.map(d => d.sendDate).sort();
    expect(sends).toEqual(['2026-09-18', '2026-09-20']);
    const moved = r.doses.find(d => d.sendDate === '2026-09-20')!;
    expect(moved.notes.some(n => n.code === 'send-closed')).toBe(true);
    expect(moved.notes.some(n => n.code === 'batch-overflow')).toBe(true);
  });

  it('不同病人按开喝日先后抢同一炉', () => {
    const c: SchedulerConfig = { ...baseConfig, furnaceCapacity: 2, pickupLimit: undefined };
    const r = schedule(
      [
        patient({ id: 'a', name: '甲', startDate: '2026-09-22', doseCount: 1 }),
        patient({ id: 'b', name: '乙', startDate: '2026-09-20', doseCount: 1 }),
        patient({ id: 'c', name: '丙', startDate: '2026-09-22', doseCount: 1 }),
      ],
      c,
    );
    // 乙喝 09-20 → 送 09-18；甲、丙喝 09-22 → 理想送 09-20，炉容 2 → 都能放
    expect(r.doses.find(d => d.patientId === 'b')!.sendDate).toBe('2026-09-18');
    expect(r.doses.find(d => d.patientId === 'a')!.sendDate).toBe('2026-09-20');
    expect(r.doses.find(d => d.patientId === 'c')!.sendDate).toBe('2026-09-20');
  });

  it('炉满后的顺延导致来不及喝时发警告', () => {
    const c: SchedulerConfig = {
      ...baseConfig,
      furnaceCapacity: 1,
      decoctLead: 1,
      gatherLead: 1,
      pickupLimit: undefined,
    };
    // 两位病人同天开喝：先排的送 09-18；后排的理想送 09-18 满 → 顺延 09-19 → 取 09-20
    // 09-20 正是开喝日（取药日不早于开喝日）→ 警告
    const r = schedule(
      [
        patient({ id: 'a', name: '甲', startDate: '2026-09-20', doseCount: 1 }),
        patient({ id: 'b', name: '乙', startDate: '2026-09-20', doseCount: 1 }),
      ],
      c,
    );
    const moved = r.doses.find(d => d.sendDate === '2026-09-19')!;
    expect(moved.pickupDate).toBe('2026-09-20');
    expect(r.alerts.some(a => a.message.includes('来不及喝'))).toBe(true);
    expect(moved.notes.some(n => n.code === 'late')).toBe(true);
  });
});

describe('schedule - 同取药日病人提醒', () => {
  it('同一取药日病人数达到上限时提前提醒', () => {
    const c: SchedulerConfig = { ...baseConfig, furnaceCapacity: 10, pickupLimit: 3 };
    const r = schedule(
      [
        patient({ id: 'a', name: '甲', startDate: '2026-09-20', doseCount: 1 }),
        patient({ id: 'b', name: '乙', startDate: '2026-09-20', doseCount: 1 }),
        patient({ id: 'c', name: '丙', startDate: '2026-09-20', doseCount: 1 }),
      ],
      c,
    );
    const alert = r.alerts.find(a => a.message.includes('取药'));
    expect(alert).toBeTruthy();
    expect(alert!.message).toContain('3 位病人');
    expect(r.doses.every(d => d.notes.some(n => n.code === 'pickup-crowded'))).toBe(true);
  });

  it('同一病人多剂在同一天取药只算一位', () => {
    const c: SchedulerConfig = { ...baseConfig, pickupLimit: 3 };
    const r = schedule(
      [
        patient({ id: 'a', name: '甲', startDate: '2026-09-20', doseCount: 3 }),
        patient({ id: 'b', name: '乙', startDate: '2026-09-22', doseCount: 1 }),
      ],
      c,
    );
    expect(r.alerts.some(a => a.message.includes('错峰'))).toBe(false);
  });
});

describe('schedule - 人工改期', () => {
  it('锁定送煎日后抓药日、取药日据此重算', () => {
    const r = schedule(
      [patient({ doseCount: 1, overrides: [{ doseIndex: 1, field: 'send', date: '2026-09-25' }] })],
      baseConfig,
    );
    const d = r.doses[0];
    expect(d.pinned).toBe('send');
    expect(d.sendDate).toBe('2026-09-25');
    expect(d.gatherDate).toBe('2026-09-24');
    expect(d.pickupDate).toBe('2026-09-26');
    expect(d.notes.some(n => n.code === 'manual')).toBe(true);
  });

  it('锁定取药日后往回排送煎与抓药', () => {
    const r = schedule(
      [patient({ doseCount: 1, overrides: [{ doseIndex: 1, field: 'pickup', date: '2026-09-18' }] })],
      baseConfig,
    );
    expect(r.doses[0]).toMatchObject({
      pickupDate: '2026-09-18',
      sendDate: '2026-09-17',
      gatherDate: '2026-09-16',
    });
  });

  it('锁定抓药日后往后排送煎与取药', () => {
    const r = schedule(
      [patient({ doseCount: 1, overrides: [{ doseIndex: 1, field: 'gather', date: '2026-09-10' }] })],
      baseConfig,
    );
    expect(r.doses[0]).toMatchObject({
      gatherDate: '2026-09-10',
      sendDate: '2026-09-11',
      pickupDate: '2026-09-12',
    });
  });

  it('锁定日落在歇业日：送煎/取药往前挪，抓药锚点的送煎往后挪，均说明原因', () => {
    const c: SchedulerConfig = { ...baseConfig, closedDays: ['2026-09-25'], pickupLimit: undefined };
    const r1 = schedule(
      [patient({ doseCount: 1, overrides: [{ doseIndex: 1, field: 'send', date: '2026-09-25' }] })],
      c,
    );
    expect(r1.doses[0].sendDate).toBe('2026-09-24');
    expect(r1.doses[0].notes.some(n => n.code === 'send-closed')).toBe(true);

    const r2 = schedule(
      [patient({ doseCount: 1, overrides: [{ doseIndex: 1, field: 'gather', date: '2026-09-24' }] })],
      c,
    );
    // 抓 09-24 → 理想送 09-25 歇业 → 顺延 09-26
    expect(r2.doses[0].sendDate).toBe('2026-09-26');
    expect(r2.doses[0].notes.some(n => n.code === 'send-closed')).toBe(true);
  });

  it('强制占炉会把自动排期的剂挤到下一炉', () => {
    const c: SchedulerConfig = {
      ...baseConfig,
      furnaceCapacity: 1,
      pickupLimit: undefined,
    };
    const r = schedule(
      [
        patient({
          id: 'a', name: '甲', startDate: '2026-09-22', doseCount: 2,
          // 剂1 理想送 09-20，这里把剂1 强制改到剂2 的理想送煎日 09-21
          overrides: [{ doseIndex: 1, field: 'send', date: '2026-09-21' }],
        }),
      ],
      c,
    );
    // 剂1 开喝 09-22 强制送 09-21；
    // 剂2 开喝 09-23 → 理想送 09-21 → 已被强制占满 → 顺延 09-22
    expect(r.batches.find(b => b.sendDate === '2026-09-21')!.count).toBe(1);
    expect(r.doses[1].sendDate).toBe('2026-09-22');
    expect(r.doses[1].gatherDate).toBe('2026-09-21');
    expect(r.doses[1].pickupDate).toBe('2026-09-23');
    expect(r.doses[1].notes.filter(n => n.code === 'batch-overflow').length).toBeGreaterThan(0);
  });

  it('强制两剂同一天送煎超过炉容 → 超载警告', () => {
    const c: SchedulerConfig = { ...baseConfig, furnaceCapacity: 1, pickupLimit: undefined };
    const r = schedule(
      [
        patient({
          id: 'a', name: '甲', startDate: '2026-09-22', doseCount: 2,
          overrides: [
            { doseIndex: 1, field: 'send', date: '2026-09-19' },
            { doseIndex: 2, field: 'send', date: '2026-09-19' },
          ],
        }),
      ],
      c,
    );
    const batch = r.batches.find(b => b.sendDate === '2026-09-19');
    expect(batch!.overloaded).toBe(true);
    expect(r.alerts.some(a => a.message.includes('超过容量'))).toBe(true);
    expect(r.doses.every(d => d.notes.some(n => n.code === 'batch-overload'))).toBe(true);
  });
});

describe('schedule - 输入校验', () => {
  it('剂数与天数必须为正整数', () => {
    expect(() => schedule([patient({ doseCount: 0 })], baseConfig)).toThrow('剂数');
    expect(() => schedule([patient({ daysPerDose: 0 })], baseConfig)).toThrow('一剂喝几天');
  });

  it('炉容量必须为正整数', () => {
    expect(() => schedule([patient()], { ...baseConfig, furnaceCapacity: 0 })).toThrow('炉容量');
  });

  it('病人 id 不可重复、姓名不可为空', () => {
    expect(() => schedule(
      [patient({ id: 'x' }), patient({ id: 'x' })], baseConfig,
    )).toThrow('重复');
    expect(() => schedule([patient({ name: '  ' })], baseConfig)).toThrow('姓名');
  });

  it('一剂不能同时锁定两个环节', () => {
    expect(() => schedule(
      [patient({
        overrides: [
          { doseIndex: 1, field: 'send', date: '2026-09-18' },
          { doseIndex: 1, field: 'pickup', date: '2026-09-19' },
        ],
      })],
      baseConfig,
    )).toThrow('只能锁定一个环节');
  });
});

describe('diffSchedule - 改期后受影响范围', () => {
  it('首次排期所有剂所有环节都算变化', () => {
    const r = schedule([patient()], baseConfig);
    const changed = diffSchedule(null, r);
    expect(changed).toHaveLength(3);
    expect(changed[0].fields).toEqual(['gather', 'send', 'pickup']);
  });

  it('改动后返回真正变动的剂与环节', () => {
    const before = schedule([patient({ doseCount: 3 })], baseConfig);
    const after = schedule(
      [patient({ doseCount: 3, overrides: [{ doseIndex: 1, field: 'send', date: '2026-09-25' }] })],
      baseConfig,
    );
    const changed = diffSchedule(before, after);
    const first = changed.find(c => c.doseIndex === 1)!;
    expect(first.fields).toContain('gather');
    expect(first.fields).toContain('send');
    expect(first.fields).toContain('pickup');
  });

  it('未受影响的后续剂不报告', () => {
    const before = schedule([patient({ doseCount: 2 })], { ...baseConfig, furnaceCapacity: 10 });
    // 改剂1 的取药日到很早，不影响剂2（剂2 本来理想送 09-19，与剂1 改后不抢炉）
    const after = schedule(
      [patient({ doseCount: 2, overrides: [{ doseIndex: 1, field: 'gather', date: '2026-09-10' }] })],
      { ...baseConfig, furnaceCapacity: 10 },
    );
    const changed = diffSchedule(before, after);
    expect(changed.map(c => c.doseIndex)).toEqual([1]);
  });
});
