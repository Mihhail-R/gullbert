import type { ActionName } from "../actions/catalog.js";
import type {
  Memory,
  MoodName,
  Point,
  PointerSample,
  Settings,
  WorkSample,
} from "../simulation/model.js";

export interface ActionMessage {
  action: string;
  point?: Point;
  cursor_id?: number;
}
export type TargetNotice =
  | { outcome: "started"; id: number; purpose: string; preparation: string }
  | { outcome: "selected"; id: number; point: Point }
  | { outcome: "abandoned" | "finished_tidying" | "replaced"; id: number };
export interface RoommateStatus {
  memory?: Memory;
  mood?: MoodName | null;
  error?: string;
}
interface Snapshot {
  settings: Settings;
  visible: boolean;
  shortcut_errors: string[];
}
interface Commands {
  app_version: [undefined, string];
  check_update: [{ beta: boolean }, { version: string; notes: string } | null];
  install_update: [undefined, void];
  shutdown_ready: [{ id: number; error: string | null }, void];
  act: [{ action: ActionName }, void];
  update_settings: [{ settings: Settings }, void];
  snapshot: [undefined, Snapshot];
  pet_ready: [undefined, Snapshot];
  load_roommate: [undefined, unknown];
  save_roommate: [{ memory: Memory }, void];
  publish_roommate: [{ status: RoommateStatus }, void];
  request_roommate: [undefined, void];
  sync_interaction: [
    {
      rects: (Point & { width: number; height: number })[];
      pickupId?: number | null;
    },
    PointerSample | null,
  ];
  begin_pickup: [
    { rect: Point & { width: number; height: number } },
    number | null,
  ];
  end_pickup: [{ id: number; retaliate: boolean; tug: boolean }, number | null];
  cursor_position: [undefined, PointerSample | null];
  work_activity: [undefined, WorkSample | null];
  stop_work_activity: [undefined, void];
  tug_cursor: [{ id: number; x: number; y: number }, boolean];
  release_cursor: [{ id: number }, void];
  cancel_targeting: [{ id?: number }, void];
  target_picked: [Point & { id: number }, void];
}
interface Events {
  "gullbert-shutdown-prepare": number;
  "gullbert-shutdown-cancel": number;
  "gullbert-shutdown-error": string;
  "gullbert-update-progress": {
    downloaded: number;
    total: number | null;
    installing: boolean;
  };
  "gullbert-open-updates": unknown;
  "gullbert-action": ActionMessage;
  "gullbert-target": TargetNotice;
  "gullbert-settings": Settings;
  "gullbert-visible": boolean;
  "gullbert-roommate": RoommateStatus;
  "gullbert-roommate-request": unknown;
}
export type Invoke = <K extends keyof Commands>(
  command: K,
  ...args: Commands[K][0] extends undefined ? [] : [Commands[K][0]]
) => Promise<Commands[K][1]>;
export interface NativeBridge {
  core: { invoke: Invoke };
  event: {
    listen<K extends keyof Events>(
      name: K,
      callback: (event: { payload: Events[K] }) => void,
    ): Promise<() => void>;
  };
}
declare global {
  interface Window {
    __TAURI__?: NativeBridge;
  }
}
export const native = window.__TAURI__;
export const invoke: Invoke =
  native?.core.invoke ??
  (() => {
    return Promise.reject(new Error("Native bridge unavailable"));
  });
export type PreviewMessage =
  | { type: "action"; action: string }
  | { type: "escape" }
  | { type: "preview-quit" }
  | { type: "settings"; settings: Settings }
  | { type: "visible"; visible: boolean }
  | ({ type: "roommate" } & RoommateStatus)
  | { type: "ready" };
