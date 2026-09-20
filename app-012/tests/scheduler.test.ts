import { describe, it, expect } from 'vitest';
import {
  computePlan,
  withDateOverride,
  withoutDoseOverrides,
  pickupCongestion,
  validatePlanInput,
  closedReason,
  nextOpenDay,
  prevOpenDay,
  addDays,
  DEFAULT_SCHEDULE_CONFIG,
  EMPTY_CLOSED_RULE,
  type ClosedDayRule,
  type PlanInput,
  type ScheduleConfig,
} from '../src/scheduler';

// 已知：2026-09-20 是周日，2026-09-21 是周一
const SUNDAY_CLOSED: ClosedDayRule = { weekdays: [0], dates: [] };

function makeInput(partial: Partial<PlanInput> = {}): PlanInput {
  return {
    patientName: '张三',
    startDate: '2026-09-21',
    daysPerDose: 2,
    totalDoses: 2,
    ...partial,
  };
}

describe('倒排基本链路', () => {
  it('按开始喝药日往回倒排每一剂的取药/送煎/抓药日', () => {
    const plan = computePlan(makeInput());
    // 第 1 剂：9-21 开始喝 → 当天一早取 → 前一天送煎 → 再前一天抓药
    expect(plan.doses[0].drinkStartDate).toBe('2026-09-21');
    expect(plan.doses[0].pickupDate).toBe('2026-09-21');
    expect(plan.doses[0].decoctDate).toBe('2026-09-20');
    expect(plan.doses[0].pickDate).toBe('2026-09-19');
    // 第 2 剂：一剂喝 2 天，9-23 开始
    expect(plan.doses[1].drinkStartDate).toBe('2026-09-23');
    expect(plan.doses[1].pickupDate).toBe('2026-09-23');
    expect(plan.doses[1].decoctDate).toBe('2026-09-22');
    expect(plan.doses[1].pickDate).toBe('2026-09-21');
  });

  it('剂次链：一剂喝几天决定下一剂的开始日', () => {
    const plan = computePlan(makeInput({ daysPerDose: 3, totalDoses: 3 }));
    expect(plan.doses.map(d => d.drinkStartDate)).toEqual(['2026-09-21', '2026-09-24', '2026-09-27']);
  });

  it('提前量可配置', () => {
    const config: ScheduleConfig = { ...DEFAULT_SCHEDULE_CONFIG, pickupLeadDays: 1, decoctLeadDays: 2, pickLeadDays: 2 };
    const plan = computePlan(makeInput({ totalDoses: 1 }), config);
    expect(plan.doses[0].pickupDate).toBe('2026-09-20');
    expect(plan.doses[0].decoctDate).toBe('2026-09-18');
    expect(plan.doses[0].pickDate).toBe('2026-09-16');
  });
});

describe('歇业日前挪', () => {
  it('送煎日碰上周日歇业，往前挪并说明原因', () => {
    const plan = computePlan(makeInput({ totalDoses: 1 }), DEFAULT_SCHEDULE_CONFIG, SUNDAY_CLOSED);
    const dose = plan.doses[0];
    // 送煎理想日 9-20 是周日 → 提前到 9-19；抓药跟着提前到 9-18
    expect(dose.decoctDate).toBe('2026-09-19');
    expect(dose.pickDate).toBe('2026-09-18');
    expect(dose.pickupDate).toBe('2026-09-21');
    const text = dose.adjustments.join('；');
    expect(text).toContain('周日');
    expect(text).toContain('歇业');
    expect(text).toContain('提前');
  });

  it('指定节假日歇业也要往前挪', () => {
    const closed: ClosedDayRule = { weekdays: [], dates: ['2026-10-01'] };
    const plan = computePlan(makeInput({ startDate: '2026-10-02', daysPerDose: 1, totalDoses: 1 }), DEFAULT_SCHEDULE_CONFIG, closed);
    const dose = plan.doses[0];
    expect(dose.decoctDate).toBe('2026-09-30');
    expect(dose.adjustments.join('；')).toContain('歇业');
  });

  it('连续歇业要一连往前挪好几天', () => {
    const weekendClosed: ClosedDayRule = { weekdays: [0, 6], dates: [] };
    const plan = computePlan(makeInput({ totalDoses: 1 }), DEFAULT_SCHEDULE_CONFIG, weekendClosed);
    // 送煎理想日 9-20 周日歇、9-19 周六也歇 → 提前到 9-18 周五
    expect(plan.doses[0].decoctDate).toBe('2026-09-18');
    expect(plan.doses[0].pickDate).toBe('2026-09-17');
  });

  it('取药日本身歇业时往前挪，病人提前一天取', () => {
    const closed: ClosedDayRule = { weekdays: [], dates: ['2026-09-21'] };
    const plan = computePlan(makeInput({ totalDoses: 1 }), DEFAULT_SCHEDULE_CONFIG, closed);
    const dose = plan.doses[0];
    expect(dose.pickupDate).toBe('2026-09-20');
    expect(dose.adjustments.join('；')).toContain('取药日');
  });
});

describe('煎炉容量顺延', () => {
  const cap1: ScheduleConfig = { ...DEFAULT_SCHEDULE_CONFIG, furnaceCapacityPerDay: 1 };

  it('一炉放不下时往后顺延，取药日跟着变', () => {
    const planA = computePlan(makeInput({ patientName: '甲', totalDoses: 1 }), cap1);
    expect(planA.doses[0].decoctDate).toBe('2026-09-20');

    const planB = computePlan(makeInput({ patientName: '乙', totalDoses: 1 }), cap1, EMPTY_CLOSED_RULE, [planA]);
    const dose = planB.doses[0];
    // 9-20 的炉子被甲占了 → 顺延到 9-21 送煎，取药跟着到 9-22
    expect(dose.decoctDate).toBe('2026-09-21');
    expect(dose.pickupDate).toBe('2026-09-22');
    const text = dose.adjustments.join('；');
    expect(text).toContain('煎炉');
    expect(text).toContain('顺延');
  });

  it('顺延导致取药晚于开始喝药时要预警断药', () => {
    const planA = computePlan(makeInput({ patientName: '甲', totalDoses: 1 }), cap1);
    const planB = computePlan(makeInput({ patientName: '乙', totalDoses: 1 }), cap1, EMPTY_CLOSED_RULE, [planA]);
    expect(planB.doses[0].pickupDate > planB.doses[0].drinkStartDate).toBe(true);
    expect(planB.warnings.join('；')).toContain('断药');
  });

  it('顺延会跳过歇业日', () => {
    const planA = computePlan(makeInput({ patientName: '甲', totalDoses: 1 }), cap1, SUNDAY_CLOSED);
    // 甲的送煎日被周日顶到 9-19
    expect(planA.doses[0].decoctDate).toBe('2026-09-19');
    const planB = computePlan(makeInput({ patientName: '乙', totalDoses: 1 }), cap1, SUNDAY_CLOSED, [planA]);
    // 乙理想送煎 9-20 是周日先挪到 9-19，炉子被占 → 顺延，9-20 周日跳过 → 9-21
    expect(planB.doses[0].decoctDate).toBe('2026-09-21');
    expect(planB.doses[0].pickupDate).toBe('2026-09-22');
  });

  it('同一病人多剂也占炉子，逐剂占满后顺延', () => {
    const cap2: ScheduleConfig = { ...DEFAULT_SCHEDULE_CONFIG, furnaceCapacityPerDay: 2 };
    // 一剂喝 1 天、共 3 剂：理想送煎日分别是 9-20/9-21/9-22，各占 1，容量 2 不冲突
    const plan = computePlan(makeInput({ daysPerDose: 1, totalDoses: 3 }), cap2);
    expect(plan.doses.map(d => d.decoctDate)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22']);
    // 再来一个病人 3 剂：每天先占第 2 个位置，也不冲突
    const planB = computePlan(makeInput({ patientName: '乙', daysPerDose: 1, totalDoses: 3 }), cap2, EMPTY_CLOSED_RULE, [plan]);
    expect(planB.doses.map(d => d.decoctDate)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22']);
    // 第三个病人：9-20/9-21/9-22 三天都已排满 2 剂，逐日顺延到 9-23
    const planC = computePlan(makeInput({ patientName: '丙', daysPerDose: 1, totalDoses: 2 }), cap2, EMPTY_CLOSED_RULE, [plan, planB]);
    expect(planC.doses[0].decoctDate).toBe('2026-09-23');
    expect(planC.doses[0].pickupDate).toBe('2026-09-24');
    // 第 2 剂受第 1 剂取药延后影响：9-25 才开始喝，送煎理想日 9-24 正好有空位
    expect(planC.doses[1].drinkStartDate).toBe('2026-09-25');
    expect(planC.doses[1].decoctDate).toBe('2026-09-24');
    expect(planC.doses[1].pickupDate).toBe('2026-09-25');
  });
});

describe('手动改日子后重算', () => {
  it('改第 1 剂取药日，后续剂次的开始喝药日跟着顺延重算', () => {
    const plan = computePlan(makeInput({ totalDoses: 3 }));
    const edited = withDateOverride(plan, 1, 'pickupDate', '2026-09-23');
    // 手动指定的日子保持不变并标记
    expect(edited.doses[0].pickupDate).toBe('2026-09-23');
    expect(edited.doses[0].overridden.pickupDate).toBe(true);
    // 第 1 剂 9-23 才取到药 → 第 2 剂最早 9-25 开始，第 3 剂 9-27
    expect(edited.doses[1].drinkStartDate).toBe('2026-09-25');
    expect(edited.doses[2].drinkStartDate).toBe('2026-09-27');
    expect(edited.doses[1].adjustments.join('；')).toContain('顺延');
    // 后续剂次的三个日子也跟着重算
    expect(edited.doses[1].pickupDate).toBe('2026-09-25');
    expect(edited.doses[1].decoctDate).toBe('2026-09-24');
  });

  it('手动固定取药日且煎炉排满时，送煎往前提以保住取药日', () => {
    const cap1: ScheduleConfig = { ...DEFAULT_SCHEDULE_CONFIG, furnaceCapacityPerDay: 1 };
    const planA = computePlan(makeInput({ patientName: '甲', totalDoses: 1 }), cap1);
    expect(planA.doses[0].decoctDate).toBe('2026-09-20');

    let planB = computePlan(makeInput({ patientName: '乙', totalDoses: 1 }), cap1, EMPTY_CLOSED_RULE, [planA]);
    planB = withDateOverride(planB, 1, 'pickupDate', '2026-09-21', cap1, EMPTY_CLOSED_RULE, [planA]);
    const dose = planB.doses[0];
    // 取药日固定 9-21，送煎理想 9-20 炉子被占 → 提前到 9-19
    expect(dose.pickupDate).toBe('2026-09-21');
    expect(dose.decoctDate).toBe('2026-09-19');
    expect(dose.adjustments.join('；')).toContain('提前');
  });

  it('手动指定的送煎日撞上歇业/炉满要给提醒', () => {
    const cap1: ScheduleConfig = { ...DEFAULT_SCHEDULE_CONFIG, furnaceCapacityPerDay: 1 };
    const planA = computePlan(makeInput({ patientName: '甲', totalDoses: 1 }), cap1);
    let planB = computePlan(makeInput({ patientName: '乙', totalDoses: 1 }), cap1, EMPTY_CLOSED_RULE, [planA]);
    planB = withDateOverride(planB, 1, 'decoctDate', '2026-09-20', cap1, EMPTY_CLOSED_RULE, [planA]);
    expect(planB.doses[0].decoctDate).toBe('2026-09-20');
    expect(planB.doses[0].warnings.join('；')).toContain('煎炉已排满');

    const planC = withDateOverride(
      computePlan(makeInput({ patientName: '丙', totalDoses: 1 }), DEFAULT_SCHEDULE_CONFIG, SUNDAY_CLOSED),
      1,
      'decoctDate',
      '2026-09-20',
      DEFAULT_SCHEDULE_CONFIG,
      SUNDAY_CLOSED,
    );
    expect(planC.doses[0].warnings.join('；')).toContain('歇业');
  });

  it('撤销手动改动后恢复自动排期', () => {
    const plan = computePlan(makeInput({ totalDoses: 2 }));
    const edited = withDateOverride(plan, 1, 'pickupDate', '2026-09-23');
    const restored = withoutDoseOverrides(edited, 1);
    expect(restored.doses[0].pickupDate).toBe('2026-09-21');
    expect(restored.doses[1].drinkStartDate).toBe('2026-09-23');
    expect(restored.doses[0].overridden.pickupDate).toBeUndefined();
  });
});

describe('同一取药日病人太多要提醒', () => {
  it('达到提醒线就给出预警，列出病人姓名', () => {
    const plans = ['甲', '乙', '丙', '丁'].map(name =>
      computePlan(makeInput({ patientName: name, daysPerDose: 1, totalDoses: 1 })),
    );
    const warnings = pickupCongestion(plans, 4);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('4 位病人');
    expect(warnings[0]).toContain('甲');
    expect(warnings[0]).toContain('2026-09-21');
  });

  it('没到提醒线不报警', () => {
    const plans = ['甲', '乙'].map(name => computePlan(makeInput({ patientName: name, daysPerDose: 1, totalDoses: 1 })));
    expect(pickupCongestion(plans, 4)).toEqual([]);
  });
});

describe('工具函数', () => {
  it('closedReason 识别固定星期和指定日期', () => {
    const rule: ClosedDayRule = { weekdays: [0], dates: ['2026-10-01'] };
    expect(closedReason('2026-09-20', rule)).toContain('周日');
    expect(closedReason('2026-10-01', rule)).toContain('歇业');
    expect(closedReason('2026-09-21', rule)).toBeNull();
  });

  it('nextOpenDay / prevOpenDay 跳过歇业日', () => {
    expect(nextOpenDay('2026-09-20', SUNDAY_CLOSED)).toBe('2026-09-21');
    expect(prevOpenDay('2026-09-20', SUNDAY_CLOSED)).toBe('2026-09-19');
  });

  it('addDays 跨月正确', () => {
    expect(addDays('2026-09-30', 2)).toBe('2026-10-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('validatePlanInput 校验必填与范围', () => {
    expect(validatePlanInput(makeInput())).toEqual([]);
    expect(validatePlanInput(makeInput({ patientName: ' ' })).join()).toContain('姓名');
    expect(validatePlanInput(makeInput({ startDate: '2026-13-01' })).join()).toContain('格式');
    expect(validatePlanInput(makeInput({ daysPerDose: 0 })).join()).toContain('至少');
    expect(validatePlanInput(makeInput({ totalDoses: 0 })).join()).toContain('至少');
  });
});
