import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "./api";
import type { ThemeMode } from "./types";

export interface Settings {
  theme: ThemeMode;
  /** 주 시작 요일 — 0 = 일요일, 1 = 월요일 */
  weekStart: 0 | 1;
  /** 할 일 등록 폼의 기본 알림 시점(분) */
  defaultRemindOffset: number;
  /** 알림 카드가 저절로 사라지기까지의 초 */
  notifyTtlSec: number;
  /** 새 할 일의 기본 반복 주기(분). 0 = 반복 없음 */
  defaultRepeatInterval: number;
  /** 새 할 일의 기본 반복 횟수 */
  defaultRepeatCount: number;
  /** 창 닫기(X)를 트레이 숨김으로 볼지 */
  closeToTray: boolean;
  /** 우측 상단 요약 위젯 표시 여부 */
  widgetVisible: boolean;
  /** 전역 단축키 (빈 문자열이면 사용 안 함) */
  quickAddShortcut: string;
  /** 아침 브리핑 사용 여부 */
  briefingEnabled: boolean;
  /** 브리핑 시각 — 자정 이후 분 */
  briefingAtMin: number;
  /** 자동 백업 사용 여부 */
  autoBackup: boolean;
  /** 백업 보관 개수 */
  backupKeep: number;
}

export const DEFAULTS: Settings = {
  theme: "system",
  weekStart: 0,
  defaultRemindOffset: 10,
  notifyTtlSec: 20,
  defaultRepeatInterval: 0,
  defaultRepeatCount: 1,
  closeToTray: true,
  widgetVisible: false,
  quickAddShortcut: "CommandOrControl+Shift+Space",
  briefingEnabled: false,
  briefingAtMin: 9 * 60,
  autoBackup: true,
  backupKeep: 10,
};

/**
 * `data-theme` 특성만 세팅한다. 실제 색은 CSS 변수가 결정한다.
 *
 * - `system` 이면 특성을 지워 `prefers-color-scheme` 에 맡긴다.
 * - `light` / `dark` 는 OS 설정을 무시하고 강제한다.
 */
export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

const isTheme = (v: unknown): v is ThemeMode =>
  v === "light" || v === "dark" || v === "system";

function parse(key: keyof Settings, raw: string | null): unknown {
  if (raw === null) return undefined;
  switch (key) {
    case "theme":
      return isTheme(raw) ? raw : undefined;
    case "weekStart":
      return raw === "1" ? 1 : 0;
    case "defaultRemindOffset":
    case "notifyTtlSec":
    case "defaultRepeatInterval":
    case "defaultRepeatCount":
    case "briefingAtMin":
    case "backupKeep": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "closeToTray":
    case "widgetVisible":
    case "briefingEnabled":
    case "autoBackup":
      return raw === "true" || raw === "1";
    case "quickAddShortcut":
      return raw;
  }
}

interface Ctx {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  loaded: boolean;
}

const SettingsCtx = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const entries = await Promise.all(
        (Object.keys(DEFAULTS) as (keyof Settings)[]).map(async (k) => {
          try {
            return [k, parse(k, await api.getSetting(k))] as const;
          } catch {
            return [k, undefined] as const;
          }
        }),
      );

      const next = { ...DEFAULTS };
      for (const [k, v] of entries) {
        if (v !== undefined) (next as Record<string, unknown>)[k] = v;
      }

      setSettings(next);
      applyTheme(next.theme);
      setLoaded(true);
    })();
  }, []);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    if (key === "theme") applyTheme(value as ThemeMode);
    void api.setSetting(key, String(value));
  }, []);

  const value = useMemo(() => ({ settings, set, loaded }), [settings, set, loaded]);

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error("useSettings 는 SettingsProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}

/**
 * 설정을 따라가기만 하는 쪽(알림 창)에서 쓴다.
 *
 * 메인 창이 `set_setting` 을 호출하면 Rust가 모든 창에 이벤트를 던지므로,
 * 알림 창은 그것만 듣고 있으면 된다. localStorage 를 쓰지 않는 이유가 이것으로,
 * 메인 창과 알림 창은 서로 다른 WebviewWindow 라 공통 전파 채널이 필요하다.
 */
export function followSettings(onTtl?: (sec: number) => void): () => void {
  void (async () => {
    try {
      const t = await api.getSetting("theme");
      if (isTheme(t)) applyTheme(t);
      const ttl = Number(await api.getSetting("notifyTtlSec"));
      if (Number.isFinite(ttl) && ttl > 0) onTtl?.(ttl);
    } catch {
      /* 기본값 유지 */
    }
  })();

  const unlisten = listen<[string, string]>("settings://changed", (e) => {
    const [key, value] = e.payload;
    if (key === "theme" && isTheme(value)) applyTheme(value);
    if (key === "notifyTtlSec") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) onTtl?.(n);
    }
  });

  return () => void unlisten.then((f) => f());
}
