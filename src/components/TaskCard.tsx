import { useRef, useState } from "react";
import { formatRange, formatRelative, deadlineOf, isOverdue, isToday, toDate } from "../date";
import type { Task } from "../types";

const md = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" });

/**
 * 캘린더와 보드에 공통으로 쓰는 할 일 카드.
 *
 * - `compact` — 월 뷰처럼 칸이 좁은 곳에서 한 줄로만 그린다
 * - `fill`    — 시간축에서 블록 높이를 부모에 맞춘다
 * - `showDate` — 여러 날짜가 섞이는 목록에서 날짜까지 보여준다
 */
export default function TaskCard({
  task,
  compact = false,
  fill = false,
  draggable = false,
  showDate = false,
  onOpen,
}: {
  task: Task;
  compact?: boolean;
  fill?: boolean;
  draggable?: boolean;
  showDate?: boolean;
  onOpen: (task: Task) => void;
}) {
  const [dragging, setDragging] = useState(false);
  // 드래그가 끝난 직후 click 이 이어서 발생해 모달이 열리는 것을 막는다.
  const draggedRef = useRef(false);

  const overdue = isOverdue(task);

  const className = [
    "tcard",
    `st-${task.status}`,
    compact ? "compact" : "",
    fill ? "fill" : "",
    dragging ? "dragging" : "",
    overdue ? "overdue" : "",
    task.priority > 0 ? `pri-${task.priority}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const when = (() => {
    if (task.startsAt === null) return null;
    const range = formatRange(task.startsAt, task.endsAt);
    const d = toDate(task.startsAt);
    return showDate && !isToday(d) ? `${md.format(d)} ${range}` : range;
  })();

  const deadline = deadlineOf(task);

  return (
    <div
      className={className}
      draggable={draggable}
      onDragStart={(e) => {
        // 텍스트 형태도 함께 실어두면 다른 앱으로 끌어다 놓았을 때 제목이 남는다.
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        draggedRef.current = true;
        setDragging(true);
      }}
      onDragEnd={() => {
        setDragging(false);
        // click 은 dragend 직후에 오므로 한 틱 뒤에 풀어준다.
        window.setTimeout(() => (draggedRef.current = false), 0);
      }}
      onClick={() => {
        if (draggedRef.current) return;
        onOpen(task);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task);
        }
      }}
      title={task.notes ?? task.title}
    >
      <div className="tcard-line">
        {when && <span className="tcard-time">{when}</span>}
        <span className="tcard-title">{task.title}</span>
        {overdue && <span className="tcard-flag">지남</span>}
        {task.remind && (
          <span className={`tcard-bell ${task.notifiedAt ? "sent" : ""}`} aria-label="알림 설정됨">
            🔔
          </span>
        )}
      </div>

      {!compact && (task.notes || (deadline !== null && task.status !== "done")) && (
        <div className="tcard-meta">
          {deadline !== null && task.status !== "done" && <span>{formatRelative(deadline)}</span>}
          {task.notes && <span className="tcard-note">{task.notes}</span>}
        </div>
      )}
    </div>
  );
}
