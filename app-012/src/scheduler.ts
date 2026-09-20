// 代煎排期：病人说了几号开始喝药，往回倒排每一剂的抓药日、送煎日、取药日。
// 规则：
//  - 倒排链：开始喝药日 →(取药提前)→ 取药日 →(送煎提前)→ 送煎日 →(抓药提前)→ 抓药日
//  - 碰上药房歇业日，对应日子往前挪，并记录挪动原因
//  - 一炉代煎容量有限，当天放不下的剂次往后顺延，取药日跟着顺延
//  - 排好的日子可以手动改，改完受影响的后续日子全部重算
//  - 同一个取药日排了太多病人时提前提醒

export type ScheduleField = 'pickDate' | 'decoctDate' | 'pickupDate';

export const FIELD_LABELS: Record<ScheduleField, string> = {
  pickDate: '抓药日',
  decoctDate: '送煎日',
  pickupDate: '取药日',
};

export interface ScheduleConfig {
  pickLeadDays: number; // 抓药比送煎提前几天
  decoctLeadDays: number; // 送煎比取药提前几天
  pickupLeadDays: number; // 取药比开始喝药提前几天（0 = 当天一早取）
  furnaceCapacityPerDay: number; // 一炉/一天代煎能放几剂
  pickupWarnThreshold: number; // 同一取药日达到多少病人要提醒
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  pickLeadDays: 1,
  decoctLeadDays: 1,
  pickupLeadDays: 0,
  furnaceCapacityPerDay: 6,
  pickupWarnThreshold: 4,
};

export interface ClosedDayRule {
  weekdays: number[]; // 每周固定歇业：0=周日 … 6=周六
  dates: string[]; // 指定歇业日（节假日/盘点），YYYY-MM-DD
}

export const EMPTY_CLOSED_RULE: ClosedDayRule = { weekdays: [], dates: [] };

export interface PlanInput {
  id?: string;
  patientName: string;
  startDate: string; // 开始喝药日 YYYY-MM-DD
  daysPerDose: number; // 一剂喝几天
  totalDoses: number; // 一共几剂
}

export type PlanOverrides = Record<number, Partial<Record<ScheduleField, string>>>;

export interface DoseSchedule {
  doseIndex: number; // 第几剂（1 起）
  drinkStartDate: string; // 这一剂开始喝的日子
  pickDate: string; // 抓药日
  decoctDate: string; // 送煎日
  pickupDate: string; // 取药日
  adjustments: string[]; // 每一次挪动的原因说明
  warnings: string[]; // 这一剂需要人工确认的问题
  overridden: Partial<Record<ScheduleField, boolean>>; // 哪些日子是手动指定的
}

export interface PatientPlan {
  id: string;
  input: PlanInput;
  overrides: PlanOverrides;
  doses: DoseSchedule[];
  warnings: string[];
}

// ---------- 日期工具（全部按本地日期处理，避免时区偏差） ----------

export const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return formatDate(new Date());
}

export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return formatDate(parseDate(s)) === s;
}

export function addDays(date: string, n: number): string {
  const d = parseDate(date);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

export function weekdayOf(date: string): number {
  return parseDate(date).getDay();
}

export function formatCN(date: string): string {
  const d = parseDate(date);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAY_NAMES[d.getDay()]}）`;
}

// ---------- 歇业日 ----------

/** 若当天歇业，返回原因短语；否则返回 null */
export function closedReason(date: string, rule: ClosedDayRule): string | null {
  const wd = weekdayOf(date);
  if (rule.weekdays.includes(wd)) return `是${WEEKDAY_NAMES[wd]}，药房歇业`;
  if (rule.dates.includes(date)) return '是歇业日（节假日/盘点）';
  return null;
}

export function nextOpenDay(date: string, rule: ClosedDayRule): string {
  let d = date;
  while (closedReason(d, rule)) d = addDays(d, 1);
  return d;
}

export function prevOpenDay(date: string, rule: ClosedDayRule): string {
  let d = date;
  while (closedReason(d, rule)) d = addDays(d, -1);
  return d;
}

interface ShiftResult {
  date: string;
  notes: string[];
  blocked: boolean; // 被 floor 挡住、仍落在歇业日上
}

/** 歇业就一天一天往前挪，直到落在营业日；floor 不允许再早（如不能早于送煎日） */
function shiftEarlier(date: string, rule: ClosedDayRule, floor?: string): ShiftResult {
  const notes: string[] = [];
  let d = date;
  let blocked = false;
  for (;;) {
    const reason = closedReason(d, rule);
    if (!reason) break;
    const prev = addDays(d, -1);
    if (floor !== undefined && prev < floor) {
      blocked = true;
      notes.push(`${d} ${reason}，但不能早于 ${floor}，无法再提前`);
      break;
    }
    notes.push(`${d} ${reason}，提前到 ${prev}`);
    d = prev;
  }
  return { date: d, notes, blocked };
}

// ---------- 输入校验 ----------

export function validatePlanInput(input: PlanInput): string[] {
  const errors: string[] = [];
  if (!input.patientName.trim()) errors.push('请填写病人姓名');
  if (!isValidDateStr(input.startDate)) errors.push('开始喝药日格式不正确（YYYY-MM-DD）');
  if (!Number.isInteger(input.daysPerDose) || input.daysPerDose < 1) errors.push('一剂喝几天至少为 1 天');
  if (!Number.isInteger(input.totalDoses) || input.totalDoses < 1) errors.push('一共几剂至少为 1 剂');
  if (Number.isInteger(input.totalDoses) && input.totalDoses > 60) errors.push('单次排期不能超过 60 剂');
  return errors;
}

// ---------- 排期主逻辑 ----------

let planSeq = 0;

/**
 * 计算一个病人的完整排期。
 * otherPlans：先排的病人，他们的送煎日已经占了煎炉容量。
 * overrides：手动改过的日子（剂次 → 字段 → 日期），作为固定锚点重算其余日子。
 */
export function computePlan(
  input: PlanInput,
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG,
  closed: ClosedDayRule = EMPTY_CLOSED_RULE,
  otherPlans: PatientPlan[] = [],
  overrides: PlanOverrides = {},
  id?: string,
): PatientPlan {
  const cap = Math.max(1, Math.floor(config.furnaceCapacityPerDay));
  const furnace = new Map<string, number>();
  for (const p of otherPlans) {
    for (const d of p.doses) {
      furnace.set(d.decoctDate, (furnace.get(d.decoctDate) ?? 0) + 1);
    }
  }
  const furnaceLeft = (day: string): number => cap - (furnace.get(day) ?? 0);

  const doses: DoseSchedule[] = [];
  const planWarnings: string[] = [];
  let prevEffectiveStart: string | null = null;

  for (let i = 1; i <= input.totalDoses; i++) {
    const adjustments: string[] = [];
    const warnings: string[] = [];
    const ov = overrides[i] ?? {};
    const overridden: Partial<Record<ScheduleField, boolean>> = {};

    // —— 开始喝药日：上一剂没喝完（或没取到），下一剂不能开始 ——
    const plannedStart = addDays(input.startDate, (i - 1) * input.daysPerDose);
    let drinkStart = plannedStart;
    if (prevEffectiveStart !== null) {
      const earliest = addDays(prevEffectiveStart, input.daysPerDose);
      if (earliest > drinkStart) {
        drinkStart = earliest;
        adjustments.push(`上一剂取药延后，本剂开始喝药顺延到 ${drinkStart}`);
      }
    }

    // 取药理想日：默认开始喝药当天一早就得取走
    const pickupIdeal = ov.pickupDate ?? addDays(drinkStart, -config.pickupLeadDays);

    // —— 送煎日 ——
    let decoct: string;
    if (ov.decoctDate) {
      decoct = ov.decoctDate;
      overridden.decoctDate = true;
      adjustments.push(`送煎日手动指定为 ${decoct}`);
      const r = closedReason(decoct, closed);
      if (r) warnings.push(`手动指定的送煎日 ${decoct} ${r}，请确认`);
      if (furnaceLeft(decoct) <= 0) {
        warnings.push(`手动指定的送煎日 ${decoct} 当天煎炉已排满（${cap} 剂），请改期或确认加炉`);
      }
    } else {
      const decoctIdeal = addDays(pickupIdeal, -config.decoctLeadDays);
      const shifted = shiftEarlier(decoctIdeal, closed);
      adjustments.push(...shifted.notes.map(n => `送煎日：${n}`));
      decoct = shifted.date;
      if (ov.pickupDate) {
        // 取药日被手动固定：煎炉排不下就往前提，保住答应病人的取药日
        let d = decoct;
        while (furnaceLeft(d) <= 0) d = prevOpenDay(addDays(d, -1), closed);
        if (d !== decoct) {
          adjustments.push(`送煎日原定 ${decoct}，当天煎炉已排满（${cap} 剂），为保住手动指定的取药日，提前到 ${d}`);
          decoct = d;
        }
      } else {
        // 正常情况：煎炉当天放不下就往后顺延，取药日跟着变
        let d = decoct;
        while (furnaceLeft(d) <= 0) d = nextOpenDay(addDays(d, 1), closed);
        if (d !== decoct) {
          adjustments.push(`送煎日原定 ${decoct}，当天煎炉已排满（${cap} 剂），顺延到 ${d}，取药日跟着顺延`);
          decoct = d;
        }
      }
    }
    furnace.set(decoct, (furnace.get(decoct) ?? 0) + 1);

    // —— 取药日 ——
    let pickup: string;
    if (ov.pickupDate) {
      pickup = ov.pickupDate;
      overridden.pickupDate = true;
      adjustments.push(`取药日手动指定为 ${pickup}`);
      const r = closedReason(pickup, closed);
      if (r) warnings.push(`手动指定的取药日 ${pickup} ${r}，请确认`);
    } else {
      // 送煎若被顺延，取药日跟着往后；再按歇业日往前挪，但不能早于送煎日
      const afterDecoct = addDays(decoct, config.decoctLeadDays);
      const base = afterDecoct > pickupIdeal ? afterDecoct : pickupIdeal;
      const shifted = shiftEarlier(base, closed, decoct);
      adjustments.push(...shifted.notes.map(n => `取药日：${n}`));
      if (shifted.blocked) {
        warnings.push(`取药日 ${base} 前后都是歇业日，只能定在 ${shifted.date}，请确认`);
      }
      pickup = shifted.date;
    }

    // —— 抓药日 ——
    let pick: string;
    if (ov.pickDate) {
      pick = ov.pickDate;
      overridden.pickDate = true;
      adjustments.push(`抓药日手动指定为 ${pick}`);
      const r = closedReason(pick, closed);
      if (r) warnings.push(`手动指定的抓药日 ${pick} ${r}，请确认`);
      if (pick > decoct) warnings.push(`抓药日 ${pick} 晚于送煎日 ${decoct}，顺序不合理，请确认`);
    } else {
      const pickIdeal = addDays(decoct, -config.pickLeadDays);
      const shifted = shiftEarlier(pickIdeal, closed);
      adjustments.push(...shifted.notes.map(n => `抓药日：${n}`));
      pick = shifted.date;
    }

    // —— 断药预警：取药比开始喝药还晚 ——
    if (pickup > drinkStart) {
      warnings.push(`取药日 ${pickup} 晚于开始喝药日 ${drinkStart}，会断药，请提前协调`);
    }

    doses.push({
      doseIndex: i,
      drinkStartDate: drinkStart,
      pickDate: pick,
      decoctDate: decoct,
      pickupDate: pickup,
      adjustments,
      warnings,
      overridden,
    });

    planWarnings.push(...warnings.map(w => `第${i}剂：${w}`));
    prevEffectiveStart = pickup > drinkStart ? pickup : drinkStart;
  }

  return {
    id: id ?? input.id ?? `plan-${++planSeq}`,
    input,
    overrides: cloneOverrides(overrides),
    doses,
    warnings: planWarnings,
  };
}

function cloneOverrides(overrides: PlanOverrides): PlanOverrides {
  return JSON.parse(JSON.stringify(overrides)) as PlanOverrides;
}

/** 手动改某剂的某个日子，返回重算后的新计划（受影响的后续日子一并重算） */
export function withDateOverride(
  plan: PatientPlan,
  doseIndex: number,
  field: ScheduleField,
  date: string,
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG,
  closed: ClosedDayRule = EMPTY_CLOSED_RULE,
  otherPlans: PatientPlan[] = [],
): PatientPlan {
  const overrides = cloneOverrides(plan.overrides);
  overrides[doseIndex] = { ...(overrides[doseIndex] ?? {}), [field]: date };
  return computePlan(plan.input, config, closed, otherPlans, overrides, plan.id);
}

/** 撤销某剂的全部手动改动，恢复自动排期 */
export function withoutDoseOverrides(
  plan: PatientPlan,
  doseIndex: number,
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG,
  closed: ClosedDayRule = EMPTY_CLOSED_RULE,
  otherPlans: PatientPlan[] = [],
): PatientPlan {
  const overrides = cloneOverrides(plan.overrides);
  delete overrides[doseIndex];
  return computePlan(plan.input, config, closed, otherPlans, overrides, plan.id);
}

// ---------- 取药日拥挤提醒 ----------

/** 同一个取药日排了太多病人时提前提醒（按不同病人计数） */
export function pickupCongestion(plans: PatientPlan[], threshold: number): string[] {
  const byDate = new Map<string, Map<string, number>>();
  for (const p of plans) {
    for (const d of p.doses) {
      let m = byDate.get(d.pickupDate);
      if (!m) {
        m = new Map<string, number>();
        byDate.set(d.pickupDate, m);
      }
      m.set(p.input.patientName, (m.get(p.input.patientName) ?? 0) + 1);
    }
  }
  const warnings: string[] = [];
  for (const [date, patients] of [...byDate.entries()].sort()) {
    if (patients.size >= threshold) {
      const names = [...patients.keys()].join('、');
      warnings.push(
        `${formatCN(date)}（${date}）共有 ${patients.size} 位病人同一天取药：${names}，达到提醒线 ${threshold} 人，请提前备药并安排人手`,
      );
    }
  }
  return warnings;
}
