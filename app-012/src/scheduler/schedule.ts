/**
 * 代煎排期核心算法（纯函数）。
 *
 * 思路：
 * 1. 每位病人按「一剂喝几天」展开成一剂剂的行，每行有确定的开喝日；
 * 2. 所有行按开喝日排序，从开喝日往回排出理想的 抓药/送煎/取药 日；
 * 3. 歇业日一律往前挪到最近营业日，并记录跳过了哪些歇业日；
 * 4. 送煎日决定入哪一炉：当天炉满就顺延到下一个营业日，取药日跟着顺延；
 * 5. 人工锁定某一环节后，其余两个环节由该锚点重新推算；
 * 6. 跨病人统计同一取药日的病人数，超限提前提醒。
 */

import {
  BusinessCalendar,
  addDays,
  describeDate,
} from './calendar';
import type {
  BatchDoseRef,
  BatchInfo,
  ChangedDose,
  DoseOverride,
  DosePlan,
  PatientInput,
  ScheduleAlert,
  ScheduleField,
  ScheduleNote,
  ScheduleResult,
  SchedulerConfig,
} from './types';

const FIELD_LABEL: Record<ScheduleField, string> = {
  gather: '抓药',
  send: '送煎',
  pickup: '取药',
};

interface Row {
  patientId: string;
  patientName: string;
  doseIndex: number;
  drinkStart: string;
  pin: { field: ScheduleField; date: string } | null;
}

interface ResolvedConfig {
  gatherLead: number;
  decoctLead: number;
  furnaceCapacity: number;
  pickupLimit: number | null;
}

function resolveConfig(config: SchedulerConfig): ResolvedConfig {
  if (!Number.isInteger(config.furnaceCapacity) || config.furnaceCapacity < 1) {
    throw new Error('一炉容量必须是不小于 1 的整数');
  }
  const gatherLead = config.gatherLead ?? 1;
  const decoctLead = config.decoctLead ?? 1;
  if (gatherLead < 0 || decoctLead < 0) {
    throw new Error('提前天数不能为负');
  }
  return {
    gatherLead,
    decoctLead,
    furnaceCapacity: config.furnaceCapacity,
    pickupLimit: config.pickupLimit ?? null,
  };
}

function validatePatients(patients: readonly PatientInput[]): void {
  const seen = new Set<string>();
  for (const p of patients) {
    if (!p.id) throw new Error('病人缺少 id');
    if (seen.has(p.id)) throw new Error(`病人 id 重复：${p.id}`);
    seen.add(p.id);
    if (!p.name?.trim()) throw new Error(`病人 ${p.id} 缺少姓名`);
    if (!Number.isInteger(p.doseCount) || p.doseCount < 1) {
      throw new Error(`病人 ${p.name} 的剂数必须是不小于 1 的整数`);
    }
    if (!Number.isInteger(p.daysPerDose) || p.daysPerDose < 1) {
      throw new Error(`病人 ${p.name} 的「一剂喝几天」必须是不小于 1 的整数`);
    }
    const pinnedDoses = new Set<number>();
    for (const ov of p.overrides ?? []) {
      if (!Number.isInteger(ov.doseIndex) || ov.doseIndex < 1 || ov.doseIndex > p.doseCount) {
        throw new Error(`病人 ${p.name} 的改动指向不存在的第 ${ov.doseIndex} 剂`);
      }
      if (pinnedDoses.has(ov.doseIndex)) {
        throw new Error(`病人 ${p.name} 的第 ${ov.doseIndex} 剂只能锁定一个环节（${ov.field}）`);
      }
      pinnedDoses.add(ov.doseIndex);
    }
  }
}

function note(
  code: ScheduleNote['code'],
  field: ScheduleField | null,
  severity: ScheduleNote['severity'],
  message: string,
): ScheduleNote {
  return { code, field, severity, message };
}

/** 列出跳过的歇业日，如：9-15（周日）、9-16（周一） */
function listSkipped(dates: string[]): string {
  return dates.map(d => describeDate(d)).join('、');
}

/**
 * 计算全部病人的排期。
 */
export function schedule(
  patients: readonly PatientInput[],
  config: SchedulerConfig,
): ScheduleResult {
  validatePatients(patients);
  const cfg = resolveConfig(config);
  const cal = new BusinessCalendar(config.closedDays);

  // 1. 展开每一剂
  const rows: Row[] = [];
  for (const p of patients) {
    const pinMap = new Map<number, DoseOverride>();
    for (const ov of p.overrides ?? []) pinMap.set(ov.doseIndex, ov);
    for (let i = 1; i <= p.doseCount; i++) {
      const drinkStart = addDays(p.startDate, (i - 1) * p.daysPerDose);
      const ov = pinMap.get(i);
      rows.push({
        patientId: p.id,
        patientName: p.name,
        doseIndex: i,
        drinkStart,
        pin: ov ? { field: ov.field, date: ov.date } : null,
      });
    }
  }

  const plans = new Map<string, DosePlan>();
  const keyOf = (r: Row) => `${r.patientId}:${r.doseIndex}`;
  const idealDates = (drinkStart: string) => {
    const idealPickup = addDays(drinkStart, -1);
    const idealSend = addDays(idealPickup, -cfg.decoctLead);
    const idealGather = addDays(idealSend, -cfg.gatherLead);
    return { idealGather, idealSend, idealPickup };
  };

  // 送煎日 -> 入炉剂数（人工锁定的先占位，自动排期再按开喝日顺序抢位）
  const batchDoses = new Map<string, BatchDoseRef[]>();
  const register = (sendDate: string, ref: BatchDoseRef) => {
    const list = batchDoses.get(sendDate) ?? [];
    list.push(ref);
    batchDoses.set(sendDate, list);
  };

  const forced = rows.filter(r => r.pin !== null);
  const auto = rows
    .filter(r => r.pin === null)
    .sort((a, b) =>
      a.drinkStart < b.drinkStart ? -1
        : a.drinkStart > b.drinkStart ? 1
          : a.patientId < b.patientId ? -1
            : a.patientId > b.patientId ? 1
              : a.doseIndex - b.doseIndex);

  // 2. 先处理人工锁定的剂：把锚点日子落到营业日，再推算其余环节
  for (const r of forced) {
    const pin = r.pin!;
    const { idealGather, idealSend, idealPickup } = idealDates(r.drinkStart);
    const notes: ScheduleNote[] = [
      note('manual', pin.field, 'info', `人工指定${FIELD_LABEL[pin.field]}日为 ${describeDate(pin.date)}，其余环节据此重算`),
    ];
    let gather = idealGather;
    let send = idealSend;
    let pickup = idealPickup;

    if (pin.field === 'gather') {
      const g = cal.shiftBackToOpen(pin.date);
      gather = g.date;
      if (g.skipped.length) {
        notes.push(note('gather-closed', 'gather', 'info',
          `指定的抓药日 ${listSkipped(g.skipped)} 药房歇业，提前至 ${describeDate(gather)}`));
      }
      send = cal.shiftForwardToOpen(addDays(gather, cfg.gatherLead));
      if (send !== addDays(gather, cfg.gatherLead)) {
        notes.push(note('send-closed', 'send', 'info',
          `推算出的送煎日 ${describeDate(addDays(gather, cfg.gatherLead))} 歇业，顺延至 ${describeDate(send)}`));
      }
      const pk = cal.shiftBackToOpen(addDays(send, cfg.decoctLead));
      pickup = pk.date;
      if (pk.skipped.length) {
        notes.push(note('pickup-closed', 'pickup', 'info',
          `取药日 ${listSkipped(pk.skipped)} 药房歇业，提前至 ${describeDate(pickup)}`));
      }
    } else if (pin.field === 'send') {
      const s = cal.shiftBackToOpen(pin.date);
      send = s.date;
      if (s.skipped.length) {
        notes.push(note('send-closed', 'send', 'info',
          `指定的送煎日 ${listSkipped(s.skipped)} 药房歇业，提前至 ${describeDate(send)}`));
      }
      const g = cal.shiftBackToOpen(addDays(send, -cfg.gatherLead));
      gather = g.date;
      if (g.skipped.length) {
        notes.push(note('gather-closed', 'gather', 'info',
          `抓药日 ${listSkipped(g.skipped)} 药房歇业，提前至 ${describeDate(gather)}`));
      }
      const pk = cal.shiftBackToOpen(addDays(send, cfg.decoctLead));
      pickup = pk.date;
      if (pk.skipped.length) {
        notes.push(note('pickup-closed', 'pickup', 'info',
          `取药日 ${listSkipped(pk.skipped)} 药房歇业，提前至 ${describeDate(pickup)}`));
      }
    } else {
      const pk0 = cal.shiftBackToOpen(pin.date);
      pickup = pk0.date;
      if (pk0.skipped.length) {
        notes.push(note('pickup-closed', 'pickup', 'info',
          `指定的取药日 ${listSkipped(pk0.skipped)} 药房歇业，提前至 ${describeDate(pickup)}`));
      }
      const s = cal.shiftBackToOpen(addDays(pickup, -cfg.decoctLead));
      send = s.date;
      if (s.skipped.length) {
        notes.push(note('send-closed', 'send', 'info',
          `送煎日 ${listSkipped(s.skipped)} 药房歇业，提前至 ${describeDate(send)}`));
      }
      const g = cal.shiftBackToOpen(addDays(send, -cfg.gatherLead));
      gather = g.date;
      if (g.skipped.length) {
        notes.push(note('gather-closed', 'gather', 'info',
          `抓药日 ${listSkipped(g.skipped)} 药房歇业，提前至 ${describeDate(gather)}`));
      }
    }

    plans.set(keyOf(r), {
      patientId: r.patientId,
      patientName: r.patientName,
      doseIndex: r.doseIndex,
      drinkStart: r.drinkStart,
      idealGather, idealSend, idealPickup,
      gatherDate: gather,
      sendDate: send,
      pickupDate: pickup,
      pinned: pin.field,
      notes,
    });
    register(send, { patientId: r.patientId, patientName: r.patientName, doseIndex: r.doseIndex });
  }

  // 3. 自动排期：往回排 + 歇业前移 + 炉满顺延
  // 规则方向不能混：歇业一律「往前挪」（提前办），只有炉子放不下才「往后顺延」。
  for (const r of auto) {
    const { idealGather, idealSend, idealPickup } = idealDates(r.drinkStart);
    const notes: ScheduleNote[] = [];

    const sendBack = cal.shiftBackToOpen(idealSend);
    if (sendBack.skipped.length) {
      notes.push(note('send-closed', 'send', 'info',
        `送煎日原定 ${describeDate(idealSend)}，当天药房歇业（${listSkipped(sendBack.skipped)}），提前至 ${describeDate(sendBack.date)} 下锅`));
    }

    // 前移后的那炉若已满，则从该日起逐日顺延，直到找到有容量的营业日。
    const fullDates: string[] = [];
    let send = sendBack.date;
    while ((batchDoses.get(send)?.length ?? 0) >= cfg.furnaceCapacity) {
      fullDates.push(send);
      send = cal.shiftForwardToOpen(addDays(send, 1));
    }
    if (fullDates.length) {
      notes.push(note('batch-overflow', 'send', 'warning',
        `${listSkipped(fullDates)} 的一炉均已放满 ${cfg.furnaceCapacity} 剂，本剂顺延至 ${describeDate(send)} 下锅`));
    }

    const g = cal.shiftBackToOpen(addDays(send, -cfg.gatherLead));
    if (g.skipped.length) {
      notes.push(note('gather-closed', 'gather', 'info',
        `抓药日 ${listSkipped(g.skipped)} 药房歇业，提前至 ${describeDate(g.date)} 抓完`));
    }
    const pk = cal.shiftBackToOpen(addDays(send, cfg.decoctLead));
    if (pk.skipped.length) {
      notes.push(note('pickup-closed', 'pickup', 'info',
        `取药日 ${listSkipped(pk.skipped)} 药房歇业，提前至 ${describeDate(pk.date)} 一早就可取走`));
    }
    if (fullDates.length && pk.date !== idealPickup) {
      notes.push(note('batch-overflow', 'pickup', 'warning',
        `因下锅顺延，取药日相应顺延至 ${describeDate(pk.date)}（理想为 ${describeDate(idealPickup)}）`));
    }

    plans.set(keyOf(r), {
      patientId: r.patientId,
      patientName: r.patientName,
      doseIndex: r.doseIndex,
      drinkStart: r.drinkStart,
      idealGather, idealSend, idealPickup,
      gatherDate: g.date,
      sendDate: send,
      pickupDate: pk.date,
      pinned: null,
      notes,
    });
    register(send, { patientId: r.patientId, patientName: r.patientName, doseIndex: r.doseIndex });
  }

  // 4. 组装批次（按送煎日排序）
  const batches: BatchInfo[] = [...batchDoses.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([sendDate, refs]) => {
      const pickupDate = cal.shiftBackToOpen(addDays(sendDate, cfg.decoctLead)).date;
      return {
        sendDate,
        pickupDate,
        capacity: cfg.furnaceCapacity,
        doses: refs,
        count: refs.length,
        overloaded: refs.length > cfg.furnaceCapacity,
      };
    });

  // 5. 来不及喝的提醒：取药日不早于开喝日
  const alerts: ScheduleAlert[] = [];
  for (const plan of plans.values()) {
    if (plan.pickupDate >= plan.drinkStart) {
      const msg = `${plan.patientName} 第 ${plan.doseIndex} 剂取药日为 ${describeDate(plan.pickupDate)}，不早于开喝日 ${describeDate(plan.drinkStart)}，可能来不及喝`;
      plan.notes.push(note('late', 'pickup', 'warning', msg));
      alerts.push({ level: 'warning', message: msg });
    }
  }

  // 6. 炉子超载（人工锁定塞进来的）提醒
  for (const b of batches.filter(x => x.overloaded)) {
    const msg = `${describeDate(b.sendDate)} 的一炉排了 ${b.count} 剂，超过容量 ${b.capacity} 剂，需要加开一炉或调整`;
    alerts.push({ level: 'warning', message: msg });
    for (const ref of b.doses) {
      plans.get(`${ref.patientId}:${ref.doseIndex}`)?.notes.push(
        note('batch-overload', 'send', 'warning', msg),
      );
    }
  }

  // 7. 同一取药日病人太多，提前提醒
  if (cfg.pickupLimit !== null) {
    const byPickup = new Map<string, Set<string>>();
    for (const plan of plans.values()) {
      const set = byPickup.get(plan.pickupDate) ?? new Set<string>();
      set.add(plan.patientId);
      byPickup.set(plan.pickupDate, set);
    }
    for (const [pickupDate, patientSet] of byPickup) {
      if (patientSet.size >= cfg.pickupLimit) {
        const msg = `${describeDate(pickupDate)} 一早日有 ${patientSet.size} 位病人取药（上限 ${cfg.pickupLimit} 位），请提前备药、错峰取药`;
        alerts.push({ level: 'warning', message: msg });
        for (const plan of plans.values()) {
          if (plan.pickupDate === pickupDate) {
            plan.notes.push(note('pickup-crowded', 'pickup', 'warning', msg));
          }
        }
      }
    }
  }

  // 输出按病人、剂次排列，便于展示
  const doses = [...plans.values()].sort((a, b) =>
    a.patientId < b.patientId ? -1
      : a.patientId > b.patientId ? 1
        : a.doseIndex - b.doseIndex);

  return { doses, batches, alerts };
}

/**
 * 对比新旧两版排期，找出日期发生变化的剂（用于改期后高亮「受影响的后续日子」）。
 */
export function diffSchedule(prev: ScheduleResult | null, next: ScheduleResult): ChangedDose[] {
  if (!prev) {
    return next.doses.map(d => ({
      patientId: d.patientId,
      doseIndex: d.doseIndex,
      fields: ['gather', 'send', 'pickup'] as ScheduleField[],
    }));
  }
  const old = new Map(prev.doses.map(d => [`${d.patientId}:${d.doseIndex}`, d]));
  const changed: ChangedDose[] = [];
  for (const d of next.doses) {
    const o = old.get(`${d.patientId}:${d.doseIndex}`);
    if (!o) {
      changed.push({ patientId: d.patientId, doseIndex: d.doseIndex, fields: ['gather', 'send', 'pickup'] });
      continue;
    }
    const fields: ScheduleField[] = [];
    if (o.gatherDate !== d.gatherDate) fields.push('gather');
    if (o.sendDate !== d.sendDate) fields.push('send');
    if (o.pickupDate !== d.pickupDate) fields.push('pickup');
    if (fields.length) changed.push({ patientId: d.patientId, doseIndex: d.doseIndex, fields });
  }
  return changed;
}
