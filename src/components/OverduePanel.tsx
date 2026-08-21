import { useEffect } from "react";
import TaskCard from "./TaskCard";
import { deadlineOf, formatDue, formatRelative } from "../date";
import type { Status, Task } from "../types";

/**
 * 우측 상단 아이콘으로 여는 "지난 항목" 패널.
 *
 * 기준은 종료 시각이며, 종료가 없으면 시작 시각을 쓴다.
 * 가장 오래 지난 것이 위로 오도록 정렬한다.
 */
export default function OverduePanel({
  tasks,
  onOpen,
  onStatusChange,
  onClose,
}: {
  /** 이미 지남으로 걸러진 목록 */
  tasks: Task[];
  onOpen: (task: Task) => void;
  onStatusChange: (id: string, status: Status) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sorted = [...tasks].sort((a, b) => (deadlineOf(a) ?? 0) - (deadlineOf(b) ?? 0));

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="지난 항목">
        <header className="drawer-head">
          <h2>
            지난 항목 <span className="count danger-count">{sorted.length}</span>
          </h2>
          <button type="button" className="icon" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>

        {sorted.length === 0 ? (
          <p className="drawer-empty">지난 항목이 없습니다.</p>
        ) : (
          <div className="drawer-body">
            {sorted.map((t) => {
              const d = deadlineOf(t);
              return (
                <div key={t.id} className="overdue-row">
                  <div className="overdue-when">
                    {d !== null && (
                      <>
                        <strong>{formatRelative(d)}</strong>
                        <span>{formatDue(d)}</span>
                      </>
                    )}
                  </div>

                  <TaskCard task={t} showDate onOpen={onOpen} />

                  <div className="overdue-actions">
                    <button type="button" onClick={() => onStatusChange(t.id, "in_progress")}>
                      진행 중
                    </button>
                    <button type="button" onClick={() => onStatusChange(t.id, "done")}>
                      완료
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </aside>
    </div>
  );
}
