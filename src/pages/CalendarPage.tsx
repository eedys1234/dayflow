import { useMemo, useState } from "react";
import StatusBoard from "../components/StatusBoard";
import TimeGridView from "../components/TimeGridView";
import MonthView from "../components/MonthView";
import {
  addDays,
  addMonths,
  endOfDay,
  rangeTitle,
  startOfDay,
  toEpoch,
  weekDays,
} from "../date";
import { useSettings } from "../settings";
import type { Status, Task, ViewKind } from "../types";

const VIEWS: { value: ViewKind; label: string }[] = [
  { value: "day", label: "일" },
  { value: "week", label: "주" },
  { value: "month", label: "월" },
];

/** 보드 = 상태별 3열, 캘린더 = 시간축/월 그리드 */
type Mode = "board" | "calendar";

export default function CalendarPage({
  tasks,
  onOpen,
  onNewAt,
  onStatusChange,
  onReschedule,
}: {
  tasks: Task[];
  onOpen: (task: Task) => void;
  /** 빈 슬롯을 눌렀을 때 그 시각으로 새 할 일 모달을 연다 */
  onNewAt: (epochSec: number) => void;
  onStatusChange: (id: string, status: Status) => void;
  onReschedule: (id: string, epochSec: number) => void;
}) {
  const { settings } = useSettings();
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [view, setView] = useState<ViewKind>("day");
  const [mode, setMode] = useState<Mode>("board");

  const shift = (dir: number) =>
    setAnchor((a) =>
      view === "month" ? addMonths(a, dir) : addDays(a, view === "week" ? 7 * dir : dir),
    );

  /** 현재 뷰가 담는 기간 [from, to] */
  const range = useMemo(() => {
    if (view === "month") {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      return { from: toEpoch(startOfDay(first)), to: toEpoch(endOfDay(last)) };
    }
    const days = view === "day" ? [anchor] : weekDays(anchor, settings.weekStart);
    return {
      from: toEpoch(startOfDay(days[0]!)),
      to: toEpoch(endOfDay(days[days.length - 1]!)),
    };
  }, [view, anchor, settings.weekStart]);

  const inRange = useMemo(
    () =>
      tasks.filter((t) => t.startsAt !== null && t.startsAt >= range.from && t.startsAt <= range.to),
    [tasks, range],
  );

  const emptyHint =
    view === "day" ? "이 날짜에는 없습니다" : view === "week" ? "이 주에는 없습니다" : "이 달에는 없습니다";

  return (
    <div className="page">
      <header className="page-head toolbar">
        <div className="nav">
          <button type="button" onClick={() => shift(-1)} aria-label="이전">
            ‹
          </button>
          <button type="button" onClick={() => setAnchor(new Date())}>
            오늘
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="다음">
            ›
          </button>
        </div>

        <h1 className="range-title">
          {rangeTitle(anchor, view, settings.weekStart)}
          <span className="range-count">{inRange.length}건</span>
        </h1>

        <div className="view-switch">
          <div className="seg sub">
            <button
              type="button"
              className={mode === "board" ? "on" : ""}
              onClick={() => setMode("board")}
            >
              보드
            </button>
            <button
              type="button"
              className={mode === "calendar" ? "on" : ""}
              onClick={() => setMode("calendar")}
            >
              캘린더
            </button>
          </div>

          <div className="seg">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                className={view === v.value ? "on" : ""}
                onClick={() => setView(v.value)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="page-body">
        {mode === "board" ? (
          // 주/월 보드는 여러 날짜가 섞이므로 카드에 날짜를 함께 표시한다.
          <StatusBoard
            tasks={inRange}
            onOpen={onOpen}
            onStatusChange={onStatusChange}
            showDate={view !== "day"}
            emptyHint={emptyHint}
          />
        ) : view === "month" ? (
          <MonthView
            anchor={anchor}
            tasks={tasks}
            weekStart={settings.weekStart}
            onOpen={onOpen}
            onPickDay={(d) => {
              setAnchor(d);
              setView("day");
            }}
            onReschedule={onReschedule}
          />
        ) : (
          <TimeGridView
            days={view === "day" ? [anchor] : weekDays(anchor, settings.weekStart)}
            tasks={tasks}
            onOpen={onOpen}
            onSlotPick={onNewAt}
            onReschedule={onReschedule}
          />
        )}
      </div>
    </div>
  );
}
