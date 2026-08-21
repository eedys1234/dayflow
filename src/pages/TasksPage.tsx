import { useMemo, useState } from "react";
import StatusBoard from "../components/StatusBoard";
import TaskCard from "../components/TaskCard";
import { endOfDay, isOverdue, startOfDay, toEpoch, weekDays } from "../date";
import { useSettings } from "../settings";
import type { Status, Task } from "../types";

type Filter = "all" | "today" | "week" | "overdue" | "undated";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "today", label: "오늘" },
  { value: "week", label: "이번 주" },
  { value: "overdue", label: "지남" },
  { value: "undated", label: "기한 없음" },
];

export default function TasksPage({
  tasks,
  onOpen,
  onNew,
  onStatusChange,
}: {
  tasks: Task[];
  onOpen: (task: Task) => void;
  onNew: () => void;
  onStatusChange: (id: string, status: Status) => void;
}) {
  const { settings } = useSettings();
  const [filter, setFilter] = useState<Filter>("all");
  const [mode, setMode] = useState<"board" | "list">("board");

  const counts = useMemo(() => {
    const todayFrom = toEpoch(startOfDay(new Date()));
    const todayTo = toEpoch(endOfDay(new Date()));
    const wd = weekDays(new Date(), settings.weekStart);
    const weekFrom = toEpoch(startOfDay(wd[0]!));
    const weekTo = toEpoch(endOfDay(wd[6]!));

    const inRange = (t: Task, from: number, to: number) =>
      t.startsAt !== null && t.startsAt >= from && t.startsAt <= to;

    return {
      all: tasks.length,
      today: tasks.filter((t) => inRange(t, todayFrom, todayTo)).length,
      week: tasks.filter((t) => inRange(t, weekFrom, weekTo)).length,
      overdue: tasks.filter(isOverdue).length,
      undated: tasks.filter((t) => t.startsAt === null).length,
    } satisfies Record<Filter, number>;
  }, [tasks, settings.weekStart]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "today": {
        const from = toEpoch(startOfDay(new Date()));
        const to = toEpoch(endOfDay(new Date()));
        return tasks.filter((t) => t.startsAt !== null && t.startsAt >= from && t.startsAt <= to);
      }
      case "week": {
        const wd = weekDays(new Date(), settings.weekStart);
        const from = toEpoch(startOfDay(wd[0]!));
        const to = toEpoch(endOfDay(wd[6]!));
        return tasks.filter((t) => t.startsAt !== null && t.startsAt >= from && t.startsAt <= to);
      }
      case "overdue":
        return tasks.filter(isOverdue);
      case "undated":
        return tasks.filter((t) => t.startsAt === null);
      default:
        return tasks;
    }
  }, [tasks, filter, settings.weekStart]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>할 일 관리</h1>

        <div className="seg">
          <button
            type="button"
            className={mode === "board" ? "on" : ""}
            onClick={() => setMode("board")}
          >
            보드
          </button>
          <button
            type="button"
            className={mode === "list" ? "on" : ""}
            onClick={() => setMode("list")}
          >
            목록
          </button>
        </div>

        <button type="button" className="primary" onClick={onNew}>
          + 새 할 일
        </button>
      </header>

      <div className="chips">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={`chip ${filter === f.value ? "on" : ""}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
            <span className="chip-count">{counts[f.value]}</span>
          </button>
        ))}
      </div>

      <div className="page-body">
        {filtered.length === 0 ? (
          <div className="blank">
            <p>해당하는 할 일이 없습니다.</p>
            <button type="button" className="primary" onClick={onNew}>
              + 새 할 일
            </button>
          </div>
        ) : mode === "board" ? (
          <StatusBoard
            tasks={filtered}
            onOpen={onOpen}
            onStatusChange={onStatusChange}
            emptyHint="카드를 여기로 끌어다 놓으세요"
          />
        ) : (
          <div className="flat-list">
            {filtered.map((t) => (
              <TaskCard key={t.id} task={t} showDate draggable onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
