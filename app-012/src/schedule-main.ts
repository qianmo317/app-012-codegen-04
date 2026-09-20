import { ScheduleStore } from './scheduler/store';
import { describeDate, isoFromLocalDate, weekdayLabel } from './scheduler/calendar';
import type { ChangedDose, DosePlan, PatientInput, ScheduleField } from './scheduler/types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素：#${id}`);
  return el as T;
};

function todayIso(): string {
  return isoFromLocalDate(new Date());
}

/** 初始演示数据：两剂同开喝日的病人 + 一组歇业日，方便直接看到顺延与提醒 */
const store = new ScheduleStore(
  {
    patients: [
      { id: 'p-wang', name: '王秀兰', startDate: todayIso(), daysPerDose: 1, doseCount: 5, overrides: [] },
      { id: 'p-li', name: '李建国', startDate: todayIso(), daysPerDose: 2, doseCount: 4, overrides: [] },
    ],
    config: {
      closedDays: [addIsoDays(todayIso(), 2)],
      furnaceCapacity: 3,
      pickupLimit: 2,
      gatherLead: 1,
      decoctLead: 1,
    },
  },
  true,
);

function addIsoDays(iso: string, delta: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + delta);
  return isoFromLocalDate(d);
}

let changedKeys = new Set<string>();
let editing: { patientId: string; doseIndex: number; field: ScheduleField } | null = null;
let patientSeq = 1;

/* ---------------- 配置区 ---------------- */

function syncConfigInputs(): void {
  const { config } = store.getState();
  $<HTMLInputElement>('cfg-capacity').value = String(config.furnaceCapacity);
  $<HTMLInputElement>('cfg-gather').value = String(config.gatherLead ?? 1);
  $<HTMLInputElement>('cfg-decoct').value = String(config.decoctLead ?? 1);
  $<HTMLInputElement>('cfg-pickup').value = String(config.pickupLimit ?? 0);
  renderClosedChips();
}

function renderClosedChips(): void {
  const { closedDays } = store.getState().config;
  const box = $('cfg-closed-list');
  box.innerHTML = '';
  const sorted = [...closedDays].sort();
  for (const d of sorted) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `${d} ${weekdayLabel(d)} `;
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = '删除歇业日';
    del.onclick = () => {
      const cur = store.getState().config.closedDays;
      applyChanges(store.updateConfig({ closedDays: cur.filter(x => x !== d) }));
      renderClosedChips();
    };
    chip.appendChild(del);
    box.appendChild(chip);
  }
}

$('cfg-closed-add').onclick = () => {
  const v = $<HTMLInputElement>('cfg-closed-date').value;
  if (!v) return;
  const cur = store.getState().config.closedDays;
  if (cur.includes(v)) return;
  applyChanges(store.updateConfig({ closedDays: [...cur, v] }));
  renderClosedChips();
};

function readConfigPatch() {
  return {
    furnaceCapacity: Number($<HTMLInputElement>('cfg-capacity').value),
    gatherLead: Number($<HTMLInputElement>('cfg-gather').value),
    decoctLead: Number($<HTMLInputElement>('cfg-decoct').value),
    pickupLimit: Number($<HTMLInputElement>('cfg-pickup').value) || undefined,
  };
}

['cfg-capacity', 'cfg-gather', 'cfg-decoct', 'cfg-pickup'].forEach(id => {
  $(id).addEventListener('change', () => applyChanges(store.updateConfig(readConfigPatch())));
});

/* ---------------- 病人区 ---------------- */

$<HTMLInputElement>('p-start').value = todayIso();

$('p-add').onclick = () => {
  const name = $<HTMLInputElement>('p-name').value.trim();
  const startDate = $<HTMLInputElement>('p-start').value;
  const daysPerDose = Number($<HTMLInputElement>('p-days').value);
  const doseCount = Number($<HTMLInputElement>('p-count').value);
  if (!name || !startDate || !daysPerDose || !doseCount) {
    alert('请填齐姓名、开喝日、一剂喝几天、一共几剂');
    return;
  }
  const p: PatientInput = {
    id: `p-${Date.now()}-${patientSeq++}`,
    name,
    startDate,
    daysPerDose,
    doseCount,
    overrides: [],
  };
  applyChanges(store.upsertPatient(p));
  $<HTMLInputElement>('p-name').value = '';
};

/* ---------------- 结果渲染 ---------------- */

function applyChanges(changed: ChangedDose[]): void {
  changedKeys = new Set(changed.map(c => `${c.patientId}:${c.doseIndex}`));
  render();
}

function render(): void {
  const result = store.getResult();
  renderAlerts(result.alerts.map(a => ({ level: a.level, message: a.message })));
  renderDoses(result.doses);
  renderBatches();
}

function renderAlerts(alerts: { level: 'info' | 'warning'; message: string }[]): void {
  const box = $('alerts');
  box.innerHTML = '';
  if (alerts.length === 0) {
    const ok = document.createElement('div');
    ok.className = 'alert info';
    ok.textContent = '当前排期无冲突：所有取药日都早于开喝日，炉次未满、取药日不挤。';
    box.appendChild(ok);
    return;
  }
  for (const a of alerts) {
    const div = document.createElement('div');
    div.className = `alert ${a.level === 'warning' ? '' : 'info'}`;
    div.textContent = `⚠ ${a.message}`;
    box.appendChild(div);
  }
}

function dateCell(plan: DosePlan, field: ScheduleField): HTMLTableCellElement {
  const td = document.createElement('td');
  const date = field === 'gather' ? plan.gatherDate : field === 'send' ? plan.sendDate : plan.pickupDate;
  td.className = 'datecell';
  if (plan.pinned === field) td.classList.add('pinned');
  const hitClosed = plan.notes.some(
    n => n.field === field && (n.code === 'gather-closed' || n.code === 'send-closed' || n.code === 'pickup-closed'),
  );
  if (hitClosed) td.classList.add('closed-hit');
  td.innerHTML = `${describeDate(date)}${plan.pinned === field ? ' 🔒' : ''}`;
  td.title = hitClosed ? '因药房歇业提前，点击可改期' : '点击人工改期';
  td.onclick = () => openEdit(plan, field);
  return td;
}

function renderDoses(doses: DosePlan[]): void {
  const tbody = $('doses-body');
  tbody.innerHTML = '';
  for (const plan of doses) {
    const tr = document.createElement('tr');
    if (changedKeys.has(`${plan.patientId}:${plan.doseIndex}`)) tr.classList.add('changed');

    const nameTd = document.createElement('td');
    nameTd.className = 'name';
    nameTd.innerHTML = `${plan.patientName}`;
    if (plan.doseIndex === 1) {
      const del = document.createElement('button');
      del.textContent = '删';
      del.style.cssText = 'width:auto;display:inline-block;margin:0 0 0 8px;padding:0 6px;font-size:11px';
      del.title = '删除该病人';
      del.onclick = () => applyChanges(store.removePatient(plan.patientId));
      nameTd.appendChild(del);
    }
    tr.appendChild(nameTd);

    const idx = document.createElement('td');
    idx.textContent = `第 ${plan.doseIndex} 剂`;
    tr.appendChild(idx);

    const drink = document.createElement('td');
    drink.textContent = describeDate(plan.drinkStart);
    tr.appendChild(drink);

    tr.appendChild(dateCell(plan, 'gather'));
    tr.appendChild(dateCell(plan, 'send'));
    tr.appendChild(dateCell(plan, 'pickup'));

    const notesTd = document.createElement('td');
    const notes = document.createElement('div');
    notes.className = 'notes';
    for (const n of plan.notes) {
      const line = document.createElement('div');
      if (n.severity === 'warning') line.className = 'w';
      line.textContent = `${n.severity === 'warning' ? '⚠' : '·'} ${n.message}`;
      notes.appendChild(line);
    }
    notesTd.appendChild(notes);
    tr.appendChild(notesTd);
    tbody.appendChild(tr);
  }
}

function renderBatches(): void {
  const tbody = $('batches-body');
  tbody.innerHTML = '';
  for (const b of store.getResult().batches) {
    const tr = document.createElement('tr');
    if (b.overloaded) tr.style.background = '#4a2415';
    const td = (txt: string): HTMLTableCellElement => {
      const c = document.createElement('td');
      c.textContent = txt;
      return c;
    };
    tr.appendChild(td(`${describeDate(b.sendDate)}`));
    tr.appendChild(td(describeDate(b.pickupDate)));
    tr.appendChild(td(`${b.count} / ${b.capacity}${b.overloaded ? ' 超载!' : ''}`));
    const detail = document.createElement('td');
    detail.className = 'batch-tag';
    detail.textContent = b.doses.map(x => `${x.patientName}第${x.doseIndex}剂`).join('、');
    tr.appendChild(detail);
    tbody.appendChild(tr);
  }
}

/* ---------------- 改期弹窗 ---------------- */

const dialog = $<HTMLDialogElement>('edit-dialog');

function openEdit(plan: DosePlan, field: ScheduleField): void {
  editing = { patientId: plan.patientId, doseIndex: plan.doseIndex, field };
  $('edit-context').textContent =
    `${plan.patientName} · 第 ${plan.doseIndex} 剂 · ${describeDate(plan.drinkStart)} 开喝`;
  $<HTMLSelectElement>('edit-field').value = field;
  const cur = field === 'gather' ? plan.gatherDate : field === 'send' ? plan.sendDate : plan.pickupDate;
  $<HTMLInputElement>('edit-date').value = cur;
  dialog.showModal();
}

$('edit-cancel').onclick = () => dialog.close();

$<HTMLSelectElement>('edit-field').addEventListener('change', e => {
  if (!editing) return;
  const field = (e.target as HTMLSelectElement).value as ScheduleField;
  editing.field = field;
  const plan = store.getResult().doses.find(
    d => d.patientId === editing!.patientId && d.doseIndex === editing!.doseIndex,
  );
  if (plan) {
    $<HTMLInputElement>('edit-date').value =
      field === 'gather' ? plan.gatherDate : field === 'send' ? plan.sendDate : plan.pickupDate;
  }
});

$('edit-save').onclick = () => {
  if (!editing) return;
  const date = $<HTMLInputElement>('edit-date').value;
  if (!date) { alert('请选择日期'); return; }
  try {
    applyChanges(store.setOverride(editing.patientId, editing.doseIndex, editing.field, date));
    dialog.close();
  } catch (err) {
    alert((err as Error).message);
  }
};

$('edit-clear').onclick = () => {
  if (!editing) return;
  applyChanges(store.setOverride(editing.patientId, editing.doseIndex, editing.field, null));
  dialog.close();
};

/* ---------------- 启动 ---------------- */

syncConfigInputs();
changedKeys = new Set(store.getResult().doses.map(d => `${d.patientId}:${d.doseIndex}`));
render();
