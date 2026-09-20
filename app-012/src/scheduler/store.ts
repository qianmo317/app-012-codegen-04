/**
 * 排期仓库：管理病人、配置与人工改动，并在每次改动后重算。
 *
 * 改期语义：
 * - 一剂只能锁定一个环节（抓药/送煎/取药）；再次保存该剂视为替换；
 * - 改动后所有相关的后续日子整体重算，受影响的剂通过 recompute() 返回；
 * - 删除改动后，该剂恢复自动排期。
 */

import { diffSchedule, schedule } from './schedule';
import type {
  ChangedDose,
  DoseOverride,
  PatientInput,
  ScheduleField,
  ScheduleResult,
  SchedulerConfig,
} from './types';

export interface SchedulerState {
  patients: PatientInput[];
  config: SchedulerConfig;
}

interface StorePersist {
  patients: PatientInput[];
  config: SchedulerConfig;
}

const STORAGE_KEY = 'apothecary-decoct-schedule-v1';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class ScheduleStore {
  private state: SchedulerState;
  private result: ScheduleResult;

  constructor(initial: SchedulerState, private persist = false) {
    const restored = persist ? ScheduleStore.load() : null;
    this.state = restored ?? clone(initial);
    this.result = schedule(this.state.patients, this.state.config);
  }

  private static load(): SchedulerState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as StorePersist;
      if (!Array.isArray(data.patients) || !data.config) return null;
      return { patients: data.patients, config: data.config };
    } catch {
      return null;
    }
  }

  private save(): void {
    if (!this.persist) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state satisfies StorePersist));
    } catch {
      // ignore storage error
    }
  }

  getResult(): ScheduleResult {
    return this.result;
  }

  getState(): SchedulerState {
    return clone(this.state);
  }

  /** 新增或整体替换一位病人后重算，返回受影响的剂 */
  upsertPatient(patient: PatientInput): ChangedDose[] {
    const prev = this.result;
    const idx = this.state.patients.findIndex(p => p.id === patient.id);
    if (idx >= 0) this.state.patients[idx] = clone(patient);
    else this.state.patients.push(clone(patient));
    this.result = schedule(this.state.patients, this.state.config);
    this.save();
    return diffSchedule(prev, this.result);
  }

  removePatient(patientId: string): ChangedDose[] {
    const prev = this.result;
    this.state.patients = this.state.patients.filter(p => p.id !== patientId);
    this.result = schedule(this.state.patients, this.state.config);
    this.save();
    return diffSchedule(prev, this.result);
  }

  /**
   * 修改某剂某环节的日子，受影响的后续日子全部重算。
   * 同一剂再次指定（含换成别的环节）按替换处理；日期传 null 表示取消人工锁定。
   */
  setOverride(
    patientId: string,
    doseIndex: number,
    field: ScheduleField,
    date: string | null,
  ): ChangedDose[] {
    const prev = this.result;
    const p = this.state.patients.find(x => x.id === patientId);
    if (!p) throw new Error(`找不到病人：${patientId}`);
    if (doseIndex < 1 || doseIndex > p.doseCount) {
      throw new Error(`第 ${doseIndex} 剂不存在（共 ${p.doseCount} 剂）`);
    }
    const overrides = p.overrides ? [...p.overrides] : [];
    const withoutSameDose = overrides.filter(o => o.doseIndex !== doseIndex);
    if (date !== null) {
      const next: DoseOverride = { doseIndex, field, date };
      withoutSameDose.push(next);
    }
    withoutSameDose.sort((a, b) => a.doseIndex - b.doseIndex);
    p.overrides = withoutSameDose;
    this.result = schedule(this.state.patients, this.state.config);
    this.save();
    return diffSchedule(prev, this.result);
  }

  /** 更新药房配置（歇业日、炉容量等）后全部重算 */
  updateConfig(patch: Partial<SchedulerConfig>): ChangedDose[] {
    const prev = this.result;
    this.state.config = { ...this.state.config, ...patch };
    this.result = schedule(this.state.patients, this.state.config);
    this.save();
    return diffSchedule(prev, this.result);
  }

  /** 强制重算（一般不需要，改动接口会自动重算），返回受影响的剂 */
  recompute(): ChangedDose[] {
    const prev = this.result;
    this.result = schedule(this.state.patients, this.state.config);
    return diffSchedule(prev, this.result);
  }
}
