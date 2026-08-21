import TaskCard from "./TaskCard";
import { atMinutes, isSameDay, isToday, monthGrid, orderedWeekdays, type WeekStart } from "../date";
import type { Task } from "../types";

/** 한 칸에 최대 몇 장까지 보여줄지. 넘치면 "+N" 으로 접는다. */
const MAX_PER_CELL = 3;

export default function MonthView({
  anchor,
  tasks,
  weekStart = 0,
  onOpen,
  onPickDay,
  onReschedule,
}: {
  anchor: Date;
  tasks: Task[];
  weekStart?: WeekStart;
  onOpen: (task: Task) => void;
  /** 날짜 칸을 눌렀을 때 — 그 날의 일별 뷰로 이동 */
  onPickDay: (day: Date) => void;
  onReschedule: (id: string, epochSec: number) => void;
}) {
  const cells = monthGrid(anchor, weekStart);
  const month = anchor.getMonth();
  const timed = tasks.filter((t) => t.startsAt !== null);

  return (
    <div className="month">
      <div className="month-head">
        {orderedWeekdays(weekStart).map((w) => (
          <div
            key={w.dow}
            className={`month-dow ${w.dow === 0 ? "sun" : ""} ${w.dow === 6 ? "sat" : ""}`}
          >
            {w.label}
          </div>
        ))}
      </div>

      <div className="month-grid">
        {cells.map((day) => {
          const dayTasks = timed.filter((t) => isSameDay(new Date(t.startsAt! * 1000), day));
          const shown = dayTasks.slice(0, MAX_PER_CELL);
          const rest = dayTasks.length - shown.length;
          const outside = day.getMonth() !== month;

          return (
            <div
              key={day.toDateString()}
              className={`month-cell ${outside ? "outside" : ""} ${isToday(day) ? "today" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                // 월 뷰에는 시각 정보가 없으므로 원래 시각을 유지한 채 날짜만 옮긴다.
                // 시각을 알 수 없는 경우를 대비해 오전 9시를 기본으로 둔다.
                const task = tasks.find((t) => t.id === id);
                const src = task?.startsAt ? new Date(task.startsAt * 1000) : null;
                const minutes = src ? src.getHours() * 60 + src.getMinutes() : 9 * 60;
                if (id) onReschedule(id, atMinutes(day, minutes));
              }}
            >
              <button
                type="button"
                className={`month-daynum ${day.getDay() === 0 ? "sun" : ""} ${
                  day.getDay() === 6 ? "sat" : ""
                }`}
                onClick={() => onPickDay(day)}
                title="이 날짜의 일별 뷰로 이동"
              >
                {day.getDate()}
              </button>

              <div className="month-items">
                {shown.map((t) => (
                  <TaskCard key={t.id} task={t} compact draggable onOpen={onOpen} />
                ))}
                {rest > 0 && (
                  <button type="button" className="month-more" onClick={() => onPickDay(day)}>
                    +{rest}개 더
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
