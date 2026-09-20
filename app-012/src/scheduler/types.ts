/**
 * 代煎排期：类型定义
 *
 * 时间模型（所有日期均为本地日历日，ISO 字符串 YYYY-MM-DD）：
 *
 *   开喝日 drinkStart
 *     ↑ 病人一早取走（取药日必须早于开喝日）
 *   取药日 pickup  = 送煎日 + decoctLead（代煎耗时）
 *   送煎日 send    = 抓药日 + gatherLead（抓药备药耗时）
 *   抓药日 gather
 *
 * 一切排期都从「开喝日」往回推；药房歇业日只能往前挪到最近的营业日。
 */

/** 排期环节：抓药 / 送煎 / 取药 */
export type ScheduleField = 'gather' | 'send' | 'pickup';

export type NoteSeverity = 'info' | 'warning';

/**
 * 一条排期说明。凡是日子和理想排法不一致，都要留下人能看懂的原因：
 * - *-closed：撞上药房歇业，往前挪了
 * - batch-overflow：那一炉放满了，顺延到下一炉，取药日跟着顺延
 * - batch-overload：手动改期硬塞进已满的炉子
 * - pickup-crowded：同一天取药的病人太多
 * - late：取药日晚于开喝日，来不及
 * - manual：人工改动过
 */
export interface ScheduleNote {
  code:
    | 'gather-closed'
    | 'send-closed'
    | 'pickup-closed'
    | 'batch-overflow'
    | 'batch-overload'
    | 'pickup-crowded'
    | 'late'
    | 'manual';
  field: ScheduleField | null;
  severity: NoteSeverity;
  message: string;
}

/** 一剂药的完整排期 */
export interface DosePlan {
  patientId: string;
  patientName: string;
  /** 第几剂，从 1 开始 */
  doseIndex: number;
  /** 这一剂开始喝的日子 */
  drinkStart: string;
  /** 不考虑歇业与炉容量时，往回排出的理想日子 */
  idealGather: string;
  idealSend: string;
  idealPickup: string;
  /** 最终排定的日子 */
  gatherDate: string;
  sendDate: string;
  pickupDate: string;
  /** 被人工锁定的环节（锁定点之前/之后的日子自动重算） */
  pinned: ScheduleField | null;
  notes: ScheduleNote[];
}

export interface BatchDoseRef {
  patientId: string;
  patientName: string;
  doseIndex: number;
}

/** 一炉代煎：同一个送煎日下锅的一剂打包成一批 */
export interface BatchInfo {
  sendDate: string;
  pickupDate: string;
  capacity: number;
  doses: BatchDoseRef[];
  /** 实际入炉剂数 */
  count: number;
  /** 是否超过一炉容量（手动塞进来的会超） */
  overloaded: boolean;
}

export interface ScheduleAlert {
  level: 'info' | 'warning';
  message: string;
}

export interface ScheduleResult {
  doses: DosePlan[];
  batches: BatchInfo[];
  alerts: ScheduleAlert[];
}

export interface DoseOverride {
  doseIndex: number;
  field: ScheduleField;
  /** 人工指定的日子；允许落在歇业日，系统会自动往前挪并说明 */
  date: string;
}

export interface PatientInput {
  id: string;
  name: string;
  /** 第一剂开始喝的日子 */
  startDate: string;
  /** 一剂喝几天 */
  daysPerDose: number;
  /** 一共几剂 */
  doseCount: number;
  /** 人工改动：每剂每个环节至多一条 */
  overrides?: DoseOverride[];
}

export interface SchedulerConfig {
  /** 药房歇业日（ISO 日期列表） */
  closedDays: string[];
  /** 一炉代煎能放多少剂，按送煎日计 */
  furnaceCapacity: number;
  /** 同一取药日最多接待多少位病人，超出提前提醒；不填则不检查 */
  pickupLimit?: number;
  /** 抓药需提前送煎几天，默认 1（今天抓、明天送） */
  gatherLead?: number;
  /** 代煎耗时（送煎到可取走）天数，默认 1（今天送、明天取） */
  decoctLead?: number;
}

/** 重算后发生变化的一剂 */
export interface ChangedDose {
  patientId: string;
  doseIndex: number;
  /** 具体变动的环节 */
  fields: ScheduleField[];
}
