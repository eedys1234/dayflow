/** 할 일의 진행 상태. 일별 보드 뷰의 세 열에 그대로 대응한다. */
export type Status = "pending" | "in_progress" | "done";

export const STATUSES: { value: Status; label: string }[] = [
  { value: "pending", label: "대기" },
  { value: "in_progress", label: "진행 중" },
  { value: "done", label: "완료" },
];

export const STATUS_LABEL: Record<Status, string> = {
  pending: "대기",
  in_progress: "진행 중",
  done: "완료",
};

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  /** 시작(예정) 시각 — Unix epoch 초 (UTC) */
  startsAt: number | null;
  /** 종료 시각 (선택). 지나면 "지남"으로 표시된다 */
  endsAt: number | null;
  remind: boolean;
  remindOffsetMin: number;
  remindAt: number | null;
  notifiedAt: number | null;
  priority: number;
  /** 반복 알림 주기(분). 0 = 반복 없음 */
  repeatIntervalMin: number;
  /** 총 알림 횟수. 1 = 한 번만, 0 = 완료할 때까지 무제한 */
  repeatCount: number;
  /** 지금까지 보낸 횟수 */
  notifiedCount: number;
  status: Status;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewTask {
  title: string;
  notes?: string | null;
  startsAt?: number | null;
  endsAt?: number | null;
  remind: boolean;
  remindOffsetMin?: number;
  repeatIntervalMin?: number;
  repeatCount?: number;
  priority?: number;
}

export interface TaskUpdate extends NewTask {
  id: string;
}

export interface NotificationPayload {
  /** 알림 인스턴스 고유 id (중복 제거용) */
  nid: string;
  taskId: string | null;
  title: string;
  body: string | null;
  startsAt: number | null;
  endsAt: number | null;
  kind: "reminder" | "overdue" | "test";
  /** 반복 알림의 몇 번째인지 */
  repeatSeq: number | null;
  /** 총 반복 횟수. 무제한이면 null */
  repeatTotal: number | null;
}

/**
 * 알림 시점 — 시작 시각 기준 몇 분 전.
 *
 * 1시간까지는 5분 단위로 촘촘하게, 그 이상은 실제로 쓰이는 간격만 남긴다.
 */
export const REMIND_OFFSETS: { value: number; label: string }[] = [
  { value: 0, label: "정시에" },
  ...Array.from({ length: 12 }, (_, i) => {
    const m = (i + 1) * 5;
    return { value: m, label: m === 60 ? "1시간 전" : `${m}분 전` };
  }),
  { value: 90, label: "1시간 30분 전" },
  { value: 120, label: "2시간 전" },
  { value: 180, label: "3시간 전" },
  { value: 360, label: "6시간 전" },
  { value: 720, label: "12시간 전" },
  { value: 1440, label: "1일 전" },
];

/** 반복 알림 주기 */
export const REPEAT_INTERVALS: { value: number; label: string }[] = [
  { value: 0, label: "반복 없음" },
  { value: 5, label: "5분마다" },
  { value: 10, label: "10분마다" },
  { value: 15, label: "15분마다" },
  { value: 30, label: "30분마다" },
  { value: 60, label: "1시간마다" },
  { value: 120, label: "2시간마다" },
];

/** 총 알림 횟수 */
export const REPEAT_COUNTS: { value: number; label: string }[] = [
  { value: 1, label: "1번만" },
  { value: 2, label: "2번" },
  { value: 3, label: "3번" },
  { value: 5, label: "5번" },
  { value: 10, label: "10번" },
  { value: 0, label: "완료할 때까지" },
];

export const PRIORITIES: { value: number; label: string }[] = [
  { value: 0, label: "없음" },
  { value: 1, label: "낮음" },
  { value: 2, label: "보통" },
  { value: 3, label: "높음" },
];

/** 캘린더 뷰 종류 */
export type ViewKind = "day" | "week" | "month";

export type ThemeMode = "light" | "dark" | "system";
