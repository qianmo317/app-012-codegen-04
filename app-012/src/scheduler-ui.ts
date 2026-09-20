// 代煎排期面板：DOM 实现的排期工具，覆盖在游戏画布之上。
// 功能：录入病人（开始喝药日/一剂喝几天/共几剂）→ 自动倒排每剂抓药、送煎、取药日；
// 歇业日前挪并说明原因；煎炉容量顺延；表格里直接改日子，后续自动重算；取药日拥挤预警。

import {
  computePlan,
  pickupCongestion,
  validatePlanInput,
  formatCN,
  todayStr,
  WEEKDAY_NAMES,
  DEFAULT_SCHEDULE_CONFIG,
  FIELD_LABELS,
  type ClosedDayRule,
  type PatientPlan,
  type PlanInput,
  type PlanOverrides,
  type ScheduleConfig,
  type ScheduleField,
} from './scheduler';

const STORAGE_KEY = 'decoct-scheduler-v1';

interface StoredPlan {
  id: string;
  input: PlanInput;
  overrides: PlanOverrides;
}

interface StoredState {
  config: ScheduleConfig;
  closed: ClosedDayRule;
  plans: StoredPlan[];
  selectedId: string | null;
}

function loadState(): StoredState {
  const fallback: StoredState = {
    config: { ...DEFAULT_SCHEDULE_CONFIG },
    closed: { weekdays: [0], dates: [] },
    plans: [],
    selectedId: null,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const data = JSON.parse(raw) as Partial<StoredState>;
    return {
      config: { ...DEFAULT_SCHEDULE_CONFIG, ...(data.config ?? {}) },
      closed: {
        weekdays: Array.isArray(data.closed?.weekdays) ? data.closed.weekdays : [],
        dates: Array.isArray(data.closed?.dates) ? data.closed.dates : [],
      },
      plans: Array.isArray(data.plans) ? data.plans : [],
      selectedId: typeof data.selectedId === 'string' ? data.selectedId : null,
    };
  } catch {
    return fallback;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c];
  });
}

const PANEL_CSS = `
#scheduler-toggle {
  position: fixed; top: 8px; right: 8px; z-index: 1001;
  padding: 8px 14px; border: 2px solid #8b6914; border-radius: 8px;
  background: #fdf6e9; color: #8b4513; font-size: 14px; font-weight: bold;
  cursor: pointer; font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
}
#scheduler-toggle:hover { background: #f3e5c8; }
#scheduler-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
}
#scheduler-backdrop.sp-hidden { display: none; }
#scheduler-panel {
  width: min(980px, 94vw); max-height: 90vh; overflow-y: auto;
  background: #fdf6e9; color: #3a2a14; border-radius: 10px;
  border: 3px solid #8b6914; padding: 14px 18px;
}
.sp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.sp-header h2 { font-size: 20px; color: #8b4513; margin: 0; }
.sp-btn {
  padding: 6px 12px; border: 1px solid #8b6914; border-radius: 6px;
  background: #fff; color: #8b4513; cursor: pointer; font-size: 13px;
}
.sp-btn:hover { background: #f3e5c8; }
.sp-btn-primary { background: #8b4513; color: #fdf6e9; font-weight: bold; }
.sp-btn-primary:hover { background: #6d3510; }
.sp-btn-danger { color: #b03030; border-color: #b03030; }
.sp-section { border: 1px solid #d4a574; border-radius: 8px; padding: 10px 12px; margin: 10px 0; background: #fffaf0; }
.sp-section-title { font-weight: bold; color: #8b4513; margin-bottom: 8px; }
.sp-form { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.sp-form label { display: flex; flex-direction: column; font-size: 13px; gap: 3px; }
.sp-form input, .sp-form select {
  padding: 5px 8px; border: 1px solid #c8a878; border-radius: 5px; font-size: 14px; background: #fff;
}
.sp-form input[type=number] { width: 70px; }
.sp-errors { color: #b03030; font-size: 13px; margin-top: 6px; }
.sp-warnings { margin: 8px 0; }
.sp-warn-item {
  background: #fff3cd; border: 1px solid #e0a800; border-radius: 6px;
  padding: 6px 10px; margin: 4px 0; font-size: 13px; color: #6b4e00;
}
.sp-warn-item.sp-danger { background: #f8d7da; border-color: #c0392b; color: #8b2020; }
.sp-body { display: flex; gap: 14px; align-items: flex-start; }
.sp-patients { width: 220px; flex-shrink: 0; }
.sp-patient-item {
  border: 1px solid #d4a574; border-radius: 6px; padding: 8px; margin-bottom: 6px;
  cursor: pointer; background: #fff; font-size: 13px;
}
.sp-patient-item.sp-selected { border-color: #8b4513; background: #f3e5c8; }
.sp-patient-item .sp-name { font-weight: bold; }
.sp-patient-item .sp-meta { color: #777; font-size: 12px; margin-top: 2px; }
.sp-patient-item .sp-del { float: right; color: #b03030; cursor: pointer; border: none; background: none; font-size: 13px; }
.sp-table-wrap { flex: 1; overflow-x: auto; }
.sp-table { border-collapse: collapse; width: 100%; font-size: 13px; background: #fff; }
.sp-table th, .sp-table td { border: 1px solid #d4a574; padding: 5px 6px; text-align: left; vertical-align: top; }
.sp-table th { background: #f3e5c8; color: #8b4513; white-space: nowrap; }
.sp-table input[type=date] { border: 1px solid #c8a878; border-radius: 4px; padding: 2px 4px; font-size: 12px; width: 128px; }
.sp-table input.sp-overridden { border-color: #e07b00; background: #fff3e0; }
.sp-date-cn { font-size: 11px; color: #777; margin-top: 2px; }
.sp-manual-tag { font-size: 11px; color: #e07b00; }
.sp-adj { font-size: 12px; color: #555; }
.sp-adj li { margin: 2px 0; }
.sp-dose-warn { font-size: 12px; color: #b03030; }
.sp-clear-row { font-size: 11px; padding: 2px 6px; }
.sp-empty { color: #888; font-size: 13px; padding: 12px; text-align: center; }
.sp-weekdays { display: flex; gap: 8px; flex-wrap: wrap; }
.sp-weekdays label { flex-direction: row !important; align-items: center; gap: 3px; }
summary { cursor: pointer; font-weight: bold; color: #8b4513; }
`;

export class SchedulerPanel {
  private backdrop: HTMLDivElement;
  private plans: PatientPlan[] = [];
  private stored: StoredState;
  private visible = false;

  constructor() {
    this.stored = loadState();
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    this.backdrop = document.createElement('div');
    this.backdrop.id = 'scheduler-backdrop';
    this.backdrop.className = 'sp-hidden';
    this.backdrop.innerHTML = `
      <div id="scheduler-panel">
        <div class="sp-header">
          <h2>📅 代煎排期</h2>
          <button class="sp-btn" data-action="close">✕ 关闭</button>
        </div>
        <div id="sp-warnings" class="sp-warnings"></div>
        <div class="sp-section">
          <div class="sp-section-title">新增病人</div>
          <div class="sp-form">
            <label>病人姓名<input id="sp-name" type="text" placeholder="张三" maxlength="20"></label>
            <label>开始喝药日<input id="sp-start" type="date" value="${todayStr()}"></label>
            <label>一剂喝几天<input id="sp-days" type="number" min="1" max="30" value="2"></label>
            <label>一共几剂<input id="sp-doses" type="number" min="1" max="60" value="7"></label>
            <button class="sp-btn sp-btn-primary" data-action="add">生成排期</button>
          </div>
          <div id="sp-form-errors" class="sp-errors"></div>
        </div>
        <details class="sp-section">
          <summary>药房参数与歇业设置</summary>
          <div class="sp-form" id="sp-settings"></div>
        </details>
        <div class="sp-body">
          <div class="sp-patients" id="sp-patients"></div>
          <div class="sp-table-wrap" id="sp-table"></div>
        </div>
      </div>`;
    document.body.appendChild(this.backdrop);

    this.recomputeAll();
    this.bindEvents();
    this.render();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.backdrop.classList.toggle('sp-hidden', !this.visible);
    if (this.visible) this.render();
  }

  // ---------- 数据 ----------

  private get config(): ScheduleConfig {
    return this.stored.config;
  }

  private get closed(): ClosedDayRule {
    return this.stored.closed;
  }

  /** 按录入顺序重算全部排期：先排的病人先占煎炉 */
  private recomputeAll(): void {
    const done: PatientPlan[] = [];
    for (const p of this.stored.plans) {
      done.push(computePlan(p.input, this.config, this.closed, done, p.overrides, p.id));
    }
    this.plans = done;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stored));
    } catch {
      // 存储失败不影响使用
    }
  }

  private addPlan(): void {
    const name = (document.getElementById('sp-name') as HTMLInputElement).value.trim();
    const startDate = (document.getElementById('sp-start') as HTMLInputElement).value;
    const daysPerDose = Number((document.getElementById('sp-days') as HTMLInputElement).value);
    const totalDoses = Number((document.getElementById('sp-doses') as HTMLInputElement).value);

    const input: PlanInput = { patientName: name, startDate, daysPerDose, totalDoses };
    const errors = validatePlanInput(input);
    const errBox = document.getElementById('sp-form-errors')!;
    if (errors.length > 0) {
      errBox.textContent = errors.join('；');
      return;
    }
    errBox.textContent = '';

    const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    input.id = id;
    this.stored.plans.push({ id, input, overrides: {} });
    this.stored.selectedId = id;
    (document.getElementById('sp-name') as HTMLInputElement).value = '';
    this.recomputeAll();
    this.save();
    this.render();
  }

  private deletePlan(id: string): void {
    this.stored.plans = this.stored.plans.filter(p => p.id !== id);
    if (this.stored.selectedId === id) {
      this.stored.selectedId = this.stored.plans.length > 0 ? this.stored.plans[0].id : null;
    }
    this.recomputeAll();
    this.save();
    this.render();
  }

  private applyOverride(planId: string, doseIndex: number, field: ScheduleField, date: string): void {
    const stored = this.stored.plans.find(p => p.id === planId);
    if (!stored || !date) return;
    const cur: Partial<Record<ScheduleField, string>> = { ...(stored.overrides[doseIndex] ?? {}) };
    cur[field] = date;
    stored.overrides = { ...stored.overrides, [doseIndex]: cur };
    this.recomputeAll();
    this.save();
    this.render();
  }

  private clearDoseOverrides(planId: string, doseIndex: number): void {
    const stored = this.stored.plans.find(p => p.id === planId);
    if (!stored) return;
    delete stored.overrides[doseIndex];
    this.recomputeAll();
    this.save();
    this.render();
  }

  // ---------- 事件 ----------

  private bindEvents(): void {
    this.backdrop.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      if (target === this.backdrop) {
        this.toggle();
        return;
      }
      const actionEl = target.closest('[data-action]') as HTMLElement | null;
      if (!actionEl) return;
      const action = actionEl.dataset.action!;
      if (action === 'close') this.toggle();
      else if (action === 'add') this.addPlan();
      else if (action === 'select') this.selectPlan(actionEl.dataset.id!);
      else if (action === 'delete') this.deletePlan(actionEl.dataset.id!);
      else if (action === 'clear-dose') this.clearDoseOverrides(actionEl.dataset.plan!, Number(actionEl.dataset.dose));
    });

    this.backdrop.addEventListener('change', e => {
      const el = e.target as HTMLInputElement;
      if (el.matches('input[data-field]')) {
        this.applyOverride(el.dataset.plan!, Number(el.dataset.dose), el.dataset.field as ScheduleField, el.value);
      } else if (el.dataset.cfg) {
        this.readSettings();
      }
    });
  }

  private selectPlan(id: string): void {
    this.stored.selectedId = id;
    this.save();
    this.render();
  }

  private readSettings(): void {
    const num = (id: string, min: number, max: number, fallback: number): number => {
      const el = document.getElementById(id) as HTMLInputElement;
      const v = Math.floor(Number(el.value));
      return Number.isInteger(v) && v >= min && v <= max ? v : fallback;
    };
    this.stored.config = {
      pickLeadDays: num('sp-cfg-pick', 0, 14, DEFAULT_SCHEDULE_CONFIG.pickLeadDays),
      decoctLeadDays: num('sp-cfg-decoct', 0, 14, DEFAULT_SCHEDULE_CONFIG.decoctLeadDays),
      pickupLeadDays: num('sp-cfg-pickup', 0, 14, DEFAULT_SCHEDULE_CONFIG.pickupLeadDays),
      furnaceCapacityPerDay: num('sp-cfg-cap', 1, 100, DEFAULT_SCHEDULE_CONFIG.furnaceCapacityPerDay),
      pickupWarnThreshold: num('sp-cfg-warn', 2, 50, DEFAULT_SCHEDULE_CONFIG.pickupWarnThreshold),
    };
    const weekdays: number[] = [];
    for (let d = 0; d < 7; d++) {
      const el = document.getElementById(`sp-closed-wd-${d}`) as HTMLInputElement;
      if (el.checked) weekdays.push(d);
    }
    const datesRaw = (document.getElementById('sp-closed-dates') as HTMLInputElement).value;
    const dates = datesRaw
      .split(/[,，\s]+/)
      .map(s => s.trim())
      .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));
    this.stored.closed = { weekdays, dates };
    this.recomputeAll();
    this.save();
    this.render();
  }

  // ---------- 渲染 ----------

  private render(): void {
    this.renderSettings();
    this.renderWarnings();
    this.renderPatients();
    this.renderTable();
  }

  private renderSettings(): void {
    const box = document.getElementById('sp-settings')!;
    const c = this.config;
    const wdBoxes = WEEKDAY_NAMES.map((name, d) => {
      const checked = this.closed.weekdays.includes(d) ? 'checked' : '';
      return `<label><input type="checkbox" id="sp-closed-wd-${d}" data-cfg="1" ${checked}>${name}</label>`;
    }).join('');
    box.innerHTML = `
      <label>抓药提前（天）<input id="sp-cfg-pick" data-cfg="1" type="number" min="0" max="14" value="${c.pickLeadDays}"></label>
      <label>送煎提前（天）<input id="sp-cfg-decoct" data-cfg="1" type="number" min="0" max="14" value="${c.decoctLeadDays}"></label>
      <label>取药提前（天）<input id="sp-cfg-pickup" data-cfg="1" type="number" min="0" max="14" value="${c.pickupLeadDays}"></label>
      <label>每日煎炉容量（剂）<input id="sp-cfg-cap" data-cfg="1" type="number" min="1" max="100" value="${c.furnaceCapacityPerDay}"></label>
      <label>取药提醒线（人）<input id="sp-cfg-warn" data-cfg="1" type="number" min="2" max="50" value="${c.pickupWarnThreshold}"></label>
      <label>每周歇业<span class="sp-weekdays">${wdBoxes}</span></label>
      <label>节假日歇业<input id="sp-closed-dates" data-cfg="1" type="text" style="width:240px" placeholder="如 2026-10-01, 2026-10-02" value="${esc(this.closed.dates.join(', '))}"></label>`;
  }

  private renderWarnings(): void {
    const box = document.getElementById('sp-warnings')!;
    const items: string[] = [];
    for (const w of pickupCongestion(this.plans, this.config.pickupWarnThreshold)) {
      items.push(`<div class="sp-warn-item sp-danger">🚨 ${esc(w)}</div>`);
    }
    for (const p of this.plans) {
      for (const w of p.warnings) {
        items.push(`<div class="sp-warn-item">⚠️ 【${esc(p.input.patientName)}】${esc(w)}</div>`);
      }
    }
    box.innerHTML = items.join('');
  }

  private renderPatients(): void {
    const box = document.getElementById('sp-patients')!;
    if (this.plans.length === 0) {
      box.innerHTML = '<div class="sp-empty">还没有排期<br>先在上方录入病人</div>';
      return;
    }
    box.innerHTML = this.plans.map(p => {
      const sel = p.id === this.stored.selectedId ? ' sp-selected' : '';
      const adjCount = p.doses.reduce((n, d) => n + d.adjustments.length, 0);
      return `<div class="sp-patient-item${sel}" data-action="select" data-id="${p.id}">
        <button class="sp-del" data-action="delete" data-id="${p.id}" title="删除">✕</button>
        <div class="sp-name">${esc(p.input.patientName)}</div>
        <div class="sp-meta">${formatCN(p.input.startDate)} 起喝 · ${p.input.totalDoses} 剂 · 每剂 ${p.input.daysPerDose} 天</div>
        <div class="sp-meta">${adjCount > 0 ? `${adjCount} 条日期调整` : '无调整'}</div>
      </div>`;
    }).join('');
  }

  private renderTable(): void {
    const box = document.getElementById('sp-table')!;
    const plan = this.plans.find(p => p.id === this.stored.selectedId);
    if (!plan) {
      box.innerHTML = this.plans.length > 0 ? '<div class="sp-empty">点击左侧病人查看排期</div>' : '';
      return;
    }
    const rows = plan.doses.map(d => {
      const dateCell = (field: ScheduleField, value: string): string => {
        const ov = d.overridden[field] ? ' sp-overridden' : '';
        const tag = d.overridden[field] ? '<div class="sp-manual-tag">手动</div>' : '';
        return `<td>
          <input type="date" class="${ov.trim()}" value="${value}" data-plan="${plan.id}" data-dose="${d.doseIndex}" data-field="${field}">
          <div class="sp-date-cn">${formatCN(value)}</div>${tag}
        </td>`;
      };
      const adj = d.adjustments.length > 0
        ? `<ul class="sp-adj">${d.adjustments.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`
        : '<span class="sp-adj">按常规倒排，无挪动</span>';
      const warns = d.warnings.map(w => `<div class="sp-dose-warn">⚠️ ${esc(w)}</div>`).join('');
      const hasOv = Object.keys(d.overridden).length > 0;
      const clearBtn = hasOv
        ? `<button class="sp-btn sp-clear-row" data-action="clear-dose" data-plan="${plan.id}" data-dose="${d.doseIndex}">撤销手动改动</button>`
        : '';
      return `<tr>
        <td>第 ${d.doseIndex} 剂</td>
        <td>${formatCN(d.drinkStartDate)}</td>
        ${dateCell('pickDate', d.pickDate)}
        ${dateCell('decoctDate', d.decoctDate)}
        ${dateCell('pickupDate', d.pickupDate)}
        <td>${adj}${warns}${clearBtn}</td>
      </tr>`;
    }).join('');
    box.innerHTML = `
      <table class="sp-table">
        <thead><tr>
          <th>剂次</th><th>开始喝</th>
          <th>${FIELD_LABELS.pickDate}</th><th>${FIELD_LABELS.decoctDate}</th><th>${FIELD_LABELS.pickupDate}</th>
          <th>调整说明 / 提醒</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
}
