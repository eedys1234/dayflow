/**
 * 날짜 계산 헬퍼.
 *
 * 앱 내부의 시각은 모두 Unix epoch 초(UTC)다. 여기 있는 함수들은 그것을
 * 사용자의 로컬 달력 위에 올려놓는 일만 한다.
 */

export const SEC = 1;
export const MIN = 60;
export const HOUR = 3600;
export const DAY = 86400;

export const toDate = (epochSec: number): Date => new Date(epochSec * 1000);
export const toEpoch = (d: Date): number => Math.floor(d.getTime() / 1000);

export const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const endOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const addMonths = (d: Date, n: number): Date => {
  const x = new Date(d);
  // 말일 보정: 1월 31일에서 +1개월이 3월로 튀지 않도록 1일로 맞춘 뒤 이동한다.
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  return x;
};

/** 주 시작 요일 — 0 = 일요일, 1 = 월요일 */
export type WeekStart = 0 | 1;

export const startOfWeek = (d: Date, weekStart: WeekStart = 0): Date =>
  addDays(startOfDay(d), -((d.getDay() - weekStart + 7) % 7));

export const startOfMonth = (d: Date): Date => {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
};

export const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const isToday = (d: Date): boolean => isSameDay(d, new Date());

/** 월 뷰 그리드에 필요한 42칸(6주). 앞뒤 달의 날짜로 채운다. */
export const monthGrid = (anchor: Date, weekStart: WeekStart = 0): Date[] => {
  const first = startOfWeek(startOfMonth(anchor), weekStart);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
};

export const weekDays = (anchor: Date, weekStart: WeekStart = 0): Date[] => {
  const first = startOfWeek(anchor, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
};

/** 요일 이름 — 항상 일요일 기준 인덱스(`Date.getDay()`)로 접근한다 */
export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/** 헤더에 그릴 순서대로 정렬된 요일 목록 */
export const orderedWeekdays = (weekStart: WeekStart = 0): { label: string; dow: number }[] =>
  Array.from({ length: 7 }, (_, i) => {
    const dow = (i + weekStart) % 7;
    return { label: WEEKDAY_LABELS[dow]!, dow };
  });

// --- 표시용 포맷 ---

const timeFmt = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  weekday: "short",
});

export const formatTime = (epochSec: number): string => timeFmt.format(toDate(epochSec));

export function formatDue(epochSec: number | null): string {
  if (epochSec === null) return "";
  const d = toDate(epochSec);
  return isToday(d) ? `오늘 ${timeFmt.format(d)}` : `${dateFmt.format(d)} ${timeFmt.format(d)}`;
}

/** "10분 전", "2시간 뒤" 같은 상대 표현 */
export function formatRelative(epochSec: number): string {
  const diff = epochSec - Math.floor(Date.now() / 1000);
  const abs = Math.abs(diff);
  const suffix = diff < 0 ? "지남" : "뒤";

  if (abs < 60) return diff < 0 ? "방금 지남" : "곧";
  if (abs < HOUR) return `${Math.round(abs / MIN)}분 ${suffix}`;
  if (abs < DAY) return `${Math.round(abs / HOUR)}시간 ${suffix}`;
  return `${Math.round(abs / DAY)}일 ${suffix}`;
}

/** 툴바에 표시할 현재 기간 제목 */
export function rangeTitle(
  anchor: Date,
  view: "day" | "week" | "month",
  weekStart: WeekStart = 0,
): string {
  if (view === "month") return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;

  if (view === "week") {
    const days = weekDays(anchor, weekStart);
    const a = days[0]!;
    const b = days[6]!;
    const sameMonth = a.getMonth() === b.getMonth();
    return sameMonth
      ? `${a.getFullYear()}년 ${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getDate()}일`
      : `${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getMonth() + 1}월 ${b.getDate()}일`;
  }

  return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월 ${anchor.getDate()}일 (${
    WEEKDAY_LABELS[anchor.getDay()]
  })`;
}

/** `<input type="datetime-local">` 값 → epoch 초 */
export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** epoch 초 → `<input type="datetime-local">` 값 */
export function toLocalInput(epochSec: number | null): string {
  if (epochSec === null) return "";
  const d = toDate(epochSec);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** 특정 날짜의 특정 시각(분 단위)을 epoch 로 */
export function atMinutes(day: Date, minutes: number): number {
  const d = startOfDay(day);
  d.setMinutes(minutes);
  return toEpoch(d);
}

/** 자정으로부터 몇 분 지났는지 — 시간축 배치에 쓴다 */
export function minutesOfDay(epochSec: number): number {
  const d = toDate(epochSec);
  return d.getHours() * 60 + d.getMinutes();
}

// --- 시작/종료 시각 helpers ---

interface Ranged {
  startsAt: number | null;
  endsAt: number | null;
  status?: string;
}

/** 지남 판정의 기준 시각 — 종료가 있으면 종료, 없으면 시작 */
export const deadlineOf = (t: Ranged): number | null => t.endsAt ?? t.startsAt;

/** 완료되지 않았고 기준 시각이 이미 지났는가 */
export function isOverdue(t: Ranged): boolean {
  if (t.status === "done") return false;
  const d = deadlineOf(t);
  return d !== null && d < Math.floor(Date.now() / 1000);
}

/** "14:00 – 15:30" 또는 "14:00" */
export function formatRange(startsAt: number | null, endsAt: number | null): string {
  if (startsAt === null) return "";
  return endsAt === null ? formatTime(startsAt) : `${formatTime(startsAt)}–${formatTime(endsAt)}`;
}

/** 분 단위 소요 시간. 종료가 없으면 null */
export function durationMin(startsAt: number | null, endsAt: number | null): number | null {
  if (startsAt === null || endsAt === null) return null;
  return Math.max(1, Math.round((endsAt - startsAt) / 60));
}
