import { useEffect, useRef, useState } from "react";
import TaskCard from "./TaskCard";
import { atMinutes, durationMin, isSameDay, isToday, minutesOfDay, WEEKDAY_LABELS } from "../date";
import type { Task } from "../types";

/** 1시간 높이(px). 카드 배치와 클릭 위치 환산이 모두 이 값을 기준으로 한다. */
const HOUR_H = 48;
/** 카드 하나의 높이 — 겹침 판정에 쓴다 */
const CARD_H = 26;
/** 클릭/드롭 시각을 몇 분 단위로 맞출지 */
const SNAP = 30;

interface Placed {
  task: Task;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/**
 * 같은 시간대에 겹치는 카드를 좌우로 나눠 배치한다.
 *
 * 종료 시각이 있으면 그 길이만큼 블록을 늘리고, 없으면 최소 높이만 차지한다.
 * 열(lane)은 앞선 카드의 아래쪽 끝을 넘어선 첫 자리에 채워 넣는 방식이다.
 */
function layout(tasks: Task[]): Placed[] {
  const sorted = [...tasks].sort((a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0));
  const laneEnds: number[] = [];
  const placed: Omit<Placed, "lanes">[] = [];

  for (const task of sorted) {
    const startMin = minutesOfDay(task.startsAt!);
    const top = (startMin / 60) * HOUR_H;
    const mins = durationMin(task.startsAt, task.endsAt);
    // 종료가 없는 항목도 클릭할 수 있어야 하므로 최소 높이를 보장한다.
    const height = Math.max(CARD_H, mins === null ? CARD_H : (mins / 60) * HOUR_H);

    let lane = laneEnds.findIndex((end) => end <= top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = top + height;
    placed.push({ task, top, height, lane });
  }

  const lanes = Math.max(1, laneEnds.length);
  return placed.map((p) => ({ ...p, lanes }));
}

export default function TimeGridView({
  days,
  tasks,
  onOpen,
  onSlotPick,
  onReschedule,
}: {
  /** 1일이면 일별 타임라인, 7일이면 주별 뷰 */
  days: Date[];
  tasks: Task[];
  onOpen: (task: Task) => void;
  /** 빈 슬롯을 눌렀을 때 — 등록 폼에 시각을 채워준다 */
  onSlotPick: (epochSec: number) => void;
  /** 카드를 다른 시간대로 끌어다 놓았을 때 */
  onReschedule: (id: string, epochSec: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  // 현재 시각 표시선을 1분마다 갱신한다.
  useEffect(() => {
    const id = window.setInterval(() => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // 처음 열었을 때 새벽이 아니라 업무 시간대가 보이도록 스크롤을 내려둔다.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 8 * HOUR_H;
  }, []);

  /** 세로 위치(px) → 그날의 epoch 초 (SNAP 분 단위로 반올림) */
  const epochFromOffset = (day: Date, offsetY: number): number => {
    const minutes = Math.max(0, Math.min(24 * 60 - SNAP, (offsetY / HOUR_H) * 60));
    return atMinutes(day, Math.round(minutes / SNAP) * SNAP);
  };

  const timed = tasks.filter((t) => t.startsAt !== null);

  return (
    <div className="timegrid">
      <div className="tg-head">
        <div className="tg-gutter" />
        {days.map((d) => (
          <div key={d.toDateString()} className={`tg-day ${isToday(d) ? "today" : ""}`}>
            <span className="tg-dow">{WEEKDAY_LABELS[d.getDay()]}</span>
            <span className="tg-date">{d.getDate()}</span>
          </div>
        ))}
      </div>

      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-body" style={{ height: 24 * HOUR_H }}>
          <div className="tg-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="tg-hour-label" style={{ top: h * HOUR_H }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const dayTasks = timed.filter((t) => isSameDay(new Date(t.startsAt! * 1000), day));
            const placed = layout(dayTasks);

            return (
              <div
                key={day.toDateString()}
                className={`tg-col ${isToday(day) ? "today" : ""}`}
                onClick={(e) => {
                  // 카드가 아닌 빈 곳을 눌렀을 때만 반응한다.
                  if ((e.target as HTMLElement).closest(".tcard")) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  onSlotPick(epochFromOffset(day, e.clientY - rect.top));
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  if (!id) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  onReschedule(id, epochFromOffset(day, e.clientY - rect.top));
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="tg-hour-line" style={{ top: h * HOUR_H }} />
                ))}

                {isToday(day) && (
                  <div className="tg-now" style={{ top: (nowMin / 60) * HOUR_H }} />
                )}

                {placed.map(({ task, top, height, lane, lanes }) => (
                  <div
                    key={task.id}
                    className="tg-item"
                    style={{
                      top,
                      height,
                      left: `${(lane / lanes) * 100}%`,
                      width: `${100 / lanes}%`,
                    }}
                  >
                    <TaskCard task={task} compact fill draggable onOpen={onOpen} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
