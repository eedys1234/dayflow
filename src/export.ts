import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import * as api from "./api";

const pad = (n: number) => String(n).padStart(2, "0");

/** 저장 대화상자의 기본 파일명 — `Dayflow_2026-08-20_주간.xlsx` */
function defaultName(label: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // 파일명에 쓸 수 없는 문자를 정리한다.
  const safe = label.replace(/[\\/:*?"<>|]/g, " ").trim().replace(/\s+/g, "_");
  return `Dayflow_${stamp}_${safe}.xlsx`;
}

export interface ExportResult {
  /** 사용자가 대화상자를 취소하면 null */
  path: string | null;
  count: number;
}

/**
 * 기간을 xlsx 로 내보낸다.
 *
 * `from`/`to` 를 비우면 기한 없는 항목까지 포함해 전체를 담는다.
 */
export async function exportToExcel(
  label: string,
  from: number | null,
  to: number | null,
): Promise<ExportResult> {
  const path = await save({
    defaultPath: defaultName(label),
    filters: [{ name: "Excel 통합 문서", extensions: ["xlsx"] }],
  });

  if (!path) return { path: null, count: 0 };

  const count = await api.exportXlsx(path, from, to, label);

  // 저장하고 나면 "그래서 어디에 있지?"가 바로 따라온다. 탐색기에서 열어준다.
  try {
    await revealItemInDir(path);
  } catch {
    /* 파일 관리자를 못 열어도 내보내기 자체는 성공한 것이다 */
  }

  return { path, count };
}
