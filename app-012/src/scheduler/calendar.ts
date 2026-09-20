/**
 * 日历工具：只处理「日历日」，不引入时刻与时区。
 * 内部统一走 UTC Date 计算，再格式化回 YYYY-MM-DD，避免 toISOString 的时区偏移。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`日期格式应为 YYYY-MM-DD，收到：${iso}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (mo < 1 || mo > 12) throw new Error(`非法月份：${iso}`);
  const d = new Date(Date.UTC(y, mo - 1, da));
  // 拒绝 2026-02-31 这类 JS Date 会自动进位的日期
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) {
    throw new Error(`非法日期：${iso}`);
  }
  return d;
}

export function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 加（减）若干天 */
export function addDays(iso: string, delta: number): string {
  return formatDate(new Date(parseDate(iso).getTime() + delta * DAY_MS));
}

/** a 相对 b 的天数差：a - b（同为日历日） */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / DAY_MS);
}

/** 把任意日子格式化为 ISO（<input type="date"> 的值与 new Date() 的桥梁） */
export function isoFromLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class BusinessCalendar {
  private closed: Set<string>;

  constructor(closedDays: readonly string[] = []) {
    this.closed = new Set(closedDays);
  }

  isOpen(iso: string): boolean {
    return !this.closed.has(iso);
  }

  isClosed(iso: string): boolean {
    return this.closed.has(iso);
  }

  /**
   * 往前挪到最近的营业日：
   * - 输入日本身营业 → 原样返回，skipped 为空
   * - 输入日歇业 → 逐日回退，跳过的歇业日按序放入 skipped
   */
  shiftBackToOpen(iso: string): { date: string; skipped: string[] } {
    let cur = iso;
    const skipped: string[] = [];
    while (!this.isOpen(cur)) {
      skipped.push(cur);
      cur = addDays(cur, -1);
    }
    return { date: cur, skipped };
  }

  /** 往后挪到最近的营业日（顺延用） */
  shiftForwardToOpen(iso: string): string {
    let cur = iso;
    while (!this.isOpen(cur)) cur = addDays(cur, 1);
    return cur;
  }
}

/** 中文星期，用于说明文案 */
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function weekdayLabel(iso: string): string {
  return `周${WEEKDAYS[parseDate(iso).getUTCDay()]}`;
}

/** 给说明文案用：YYYY-MM-DD（周X） */
export function describeDate(iso: string): string {
  return `${iso}（${weekdayLabel(iso)}）`;
}
