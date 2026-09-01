import { invoke } from "@tauri-apps/api/core";
import type { NewTask, NotificationPayload, Status, Task, TaskUpdate } from "./types";

export const listTasks = () => invoke<Task[]>("list_tasks");

export const createTask = (input: NewTask) => invoke<Task>("create_task", { input });

export const updateTask = (input: TaskUpdate) => invoke<Task>("update_task", { input });

export const deleteTask = (id: string) => invoke<void>("delete_task", { id });

export const restoreTask = (id: string) => invoke<Task>("restore_task", { id });

export const setTaskStatus = (id: string, status: Status) =>
  invoke<Task>("set_task_status", { id, status });

/** 캘린더에서 카드를 다른 날짜·시간으로 옮길 때 */
export const rescheduleTask = (id: string, startsAt: number | null) =>
  invoke<Task>("reschedule_task", { id, startsAt });

export const snoozeTask = (id: string, minutes: number) =>
  invoke<Task>("snooze_task", { id, minutes });

export const sendTestNotification = () => invoke<void>("send_test_notification");

export const getAppVersion = () => invoke<string>("app_version");

/** 기간(from~to)을 xlsx 로 저장. from 이 null 이면 전체. 반환값은 기록한 건수 */
export const exportXlsx = (
  path: string,
  from: number | null,
  to: number | null,
  label: string,
) => invoke<number>("export_xlsx", { path, from, to, label });

// --- 설정 ---

export const getSetting = (key: string) => invoke<string | null>("get_setting", { key });

export const setSetting = (key: string, value: string) =>
  invoke<void>("set_setting", { key, value });

// --- 백업 ---

export interface BackupInfo {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: number;
}

export const listBackups = () => invoke<BackupInfo[]>("list_backups");

export const createBackup = (keep?: number) =>
  invoke<BackupInfo>("create_backup", { keep });

/** 다음 시작 때 적용되도록 예약만 한다. 이어서 restartApp 을 불러야 반영된다. */
export const restoreBackup = (path: string) => invoke<void>("restore_backup", { path });

export const deleteBackup = (path: string) => invoke<void>("delete_backup", { path });

export const backupsPath = () => invoke<string>("backups_path");

export const restartApp = () => invoke<void>("restart_app");

// --- 요약 위젯 / 빠른 입력 ---

export const resizeWidget = (height: number) => invoke<void>("resize_widget", { height });

export const setWidgetVisible = (visible: boolean) =>
  invoke<void>("set_widget_visible", { visible });

export const widgetVisible = () => invoke<boolean>("widget_visible");

export const openMain = () => invoke<void>("open_main");

export const hideQuickadd = () => invoke<void>("hide_quickadd");

export const resizeQuickadd = (height: number) => invoke<void>("resize_quickadd", { height });

/** 전역 단축키 재등록. 빈 문자열이면 해제한다. 실제로 걸린 조합을 돌려준다. */
export const setShortcut = (accelerator: string) =>
  invoke<string>("set_shortcut", { accelerator });

/** 지금 실제로 동작 중인 단축키 (충돌 시 대체된 값일 수 있다) */
export const activeShortcut = () => invoke<string>("active_shortcut");

// --- 로컬 HTTP API (모바일/터널 접근) ---

export interface ApiInfo {
  enabled: boolean;
  running: boolean;
  port: number;
  lan: boolean;
  token: string;
}

export const apiInfo = () => invoke<ApiInfo>("api_info");

export const setApiEnabled = (enabled: boolean) =>
  invoke<ApiInfo>("set_api_enabled", { enabled });

export const setApiLan = (lan: boolean) => invoke<ApiInfo>("set_api_lan", { lan });

/** 토큰을 새로 발급한다. 기존 클라이언트는 전부 재인증해야 한다. */
export const regenerateApiToken = () => invoke<ApiInfo>("regenerate_api_token");

// --- 알림 창 전용 ---

export const notificationReady = () => invoke<void>("notification_ready");

export const drainNotifications = () =>
  invoke<NotificationPayload[]>("drain_notifications");

export const resizeNotificationWindow = (height: number) =>
  invoke<void>("resize_notification_window", { height });

export const hideNotificationWindow = () => invoke<void>("hide_notification_window");
