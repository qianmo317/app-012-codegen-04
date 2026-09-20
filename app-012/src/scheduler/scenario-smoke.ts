/**
 * 端到端场景冒烟：模拟页面「初始数据 → 改期 → 重算」的完整调用链。
 * 用 vite-node 运行，纯逻辑（不依赖 DOM）。
 */
import { schedule } from './schedule';
import { ScheduleStore } from './store';
import { addDays } from './calendar';
import type { PatientInput } from './types';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
}

const today = '2026-09-20';
const patients: PatientInput[] = [
  { id: 'p-wang', name: '王秀兰', startDate: today, daysPerDose: 1, doseCount: 5, overrides: [] },
  { id: 'p-li', name: '李建国', startDate: today, daysPerDose: 2, doseCount: 4, overrides: [] },
];
const config = {
  closedDays: [addDays(today, 2)], // 09-22 歇业
  furnaceCapacity: 3,
  pickupLimit: 2,
  gatherLead: 1,
  decoctLead: 1,
};

// 1. 初始排期
const r0 = schedule(patients, config);
console.log('\n— 初始排期 —');
for (const d of r0.doses) {
  console.log(`${d.patientName} 第${d.doseIndex}剂 喝${d.drinkStart}：抓${d.gatherDate} 送${d.sendDate} 取${d.pickupDate}${d.notes.length ? ' | ' + d.notes.map(n => n.message).join(' / ') : ''}`);
}
assert(r0.doses.length === 9, '共 5 + 4 = 9 剂');
assert(r0.doses.every(d => d.pickupDate < d.drinkStart), '初始排期都来得及（取药早于开喝）');

// 2. 歇业日前移验证：李第1剂理想取药 09-19、送 09-18 不受影响；
//    检查 09-22 歇业是否被正确避开（送煎日不应落在 09-22）
assert(r0.doses.every(d => d.sendDate !== '2026-09-22'), '没有剂在歇业日 09-22 送煎');

// 3. 炉容量验证：每批不超 3 剂
assert(r0.batches.every(b => b.count <= 3), '自动排期没有超载批次');

// 4. 同取药日提醒
const crowded = r0.alerts.filter(a => a.message.includes('错峰'));
console.log(`\n取药拥挤提醒：${crowded.length} 条`);
for (const a of crowded) console.log(`  ⚠ ${a.message}`);

// 5. Store 改期：把王第1剂的送煎日改到 09-25，受影响后续重算
const store = new ScheduleStore({ patients, config });
const changed = store.setOverride('p-wang', 1, 'send', '2026-09-25');
const r1 = store.getResult();
const w1 = r1.doses.find(d => d.patientId === 'p-wang' && d.doseIndex === 1)!;
assert(w1.sendDate === '2026-09-25', '王第1剂送煎日改为 09-25');
assert(w1.gatherDate === '2026-09-24' && w1.pickupDate === '2026-09-26', '抓药/取药据此重算');
assert(changed.some(c => c.patientId === 'p-wang' && c.doseIndex === 1), '改动清单包含被改的剂');
console.log(`\n改期后受影响 ${changed.length} 剂：${changed.map(c => `${c.patientId}#${c.doseIndex}[${c.fields.join(',')}]`).join(' ')}`);

// 6. 取消锁定恢复
store.setOverride('p-wang', 1, 'send', null);
const w1b = store.getResult().doses.find(d => d.patientId === 'p-wang' && d.doseIndex === 1)!;
assert(w1b.pinned === null && w1b.sendDate === '2026-09-18', '取消锁定后恢复自动排期（送 09-18）');

// 7. 极端：炉容 1 + 多病人同天开喝 → 必然顺延；取药阈值 1 时每天都拥挤
const tight = schedule(
  [1, 2, 3, 4].map(i => ({ id: `x${i}`, name: `病人${i}`, startDate: today, daysPerDose: 1, doseCount: 1, overrides: [] })),
  { closedDays: [], furnaceCapacity: 1, pickupLimit: 1, gatherLead: 1, decoctLead: 1 },
);
const overflowNotes = tight.doses.flatMap(d => d.notes).filter(n => n.code === 'batch-overflow');
assert(overflowNotes.length > 0, '炉容 1、四人同天开喝 → 出现顺延说明');
assert(tight.alerts.some(a => a.message.includes('来不及喝')), '顺延到开喝当天 → 来不及时警告');
assert(tight.alerts.some(a => a.message.includes('错峰')), '同取药日病人超阈值 → 错峰提醒');

console.log('\n全部场景断言通过。');
