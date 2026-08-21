import { useState } from "react";
import TaskCard from "./TaskCard";
import { STATUSES, type Status, type Task } from "../types";

/**
 * 대기 / 진행 중 / 완료 세 열 보드.
 *
 * 카드를 다른 열로 끌어다 놓으면 상태가 바뀐다. 할 일 화면(전체 기간)과
 * 캘린더 일별 뷰(그날 것만)가 같은 컴포넌트를 쓴다.
 */
export default function StatusBoard({
  tasks,
  onOpen,
  onStatusChange,
  showDate = false,
  emptyHint = "비어 있음",
}: {
  tasks: Task[];
  onOpen: (task: Task) => void;
  onStatusChange: (id: string, status: Status) => void;
  /** 여러 날짜가 섞이는 주/월 보드에서 카드에 날짜를 함께 보여준다 */
  showDate?: boolean;
  emptyHint?: string;
}) {
  const [dragOver, setDragOver] = useState<Status | null>(null);

  const columns = STATUSES.map((s) => ({
    ...s,
    items: tasks.filter((t) => t.status === s.value),
  }));

  return (
    <div className="board">
      {columns.map((col) => (
        <section
          key={col.value}
          className={`board-col ${dragOver === col.value ? "drag-over" : ""}`}
          onDragOver={(e) => {
            // preventDefault 를 해야 이 영역이 드롭을 받는다.
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragOver !== col.value) setDragOver(col.value);
          }}
          onDragLeave={(e) => {
            // 자식 요소 사이를 지날 때도 leave 가 뜨므로, 열 밖으로 나간 경우만 처리한다.
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(null);
            const id = e.dataTransfer.getData("text/plain");
            if (!id) return;
            // 같은 열에 다시 놓은 경우는 무시해 불필요한 쓰기를 막는다.
            const task = tasks.find((t) => t.id === id);
            if (task?.status === col.value) return;
            onStatusChange(id, col.value);
          }}
        >
          <header className={`board-head ${col.value}`}>
            <span className="dot" />
            {col.label}
            <span className="count">{col.items.length}</span>
          </header>

          <div className="board-items">
            {col.items.map((t) => (
              <TaskCard key={t.id} task={t} draggable showDate={showDate} onOpen={onOpen} />
            ))}
            {col.items.length === 0 && <p className="board-empty">{emptyHint}</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
