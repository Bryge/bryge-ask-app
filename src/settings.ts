/**
 * The app's own settings: where Bryge is, and what has been installed where.
 *
 * The URL and key live on the Bryge API data source, not here; this only records which
 * data source that is, plus what has been set up on which dashboard.
 *
 * Read straight off Grafana's plugin settings API rather than passed down through React
 * context, because both the panel-menu modal and the chat panel live outside the app's
 * own component tree; there is no provider above them to read from.
 */
import { getBackendSrv } from '@grafana/runtime';

export const PLUGIN_ID = 'bryge-ask-app';

/** What a dashboard was wired up to, recorded when it was set up. */
export interface DashboardBinding {
  brygeDatasourceId: string;
  brygeDatasourceName?: string;
  dashboardTitle?: string;
  installedAt?: string;
}

export interface AskAppSettings {
  /** UID of the Bryge API data source that carries the URL and the encrypted key. */
  datasourceUid?: string;
  /** Fallback database, used on dashboards that were never explicitly set up. */
  brygeDatasourceId?: string;
  /**
   * This Grafana's id, generated once and kept forever.
   *
   * It is what makes the trial one-per-install: Bryge keys the trial tenant on this,
   * so re-running setup re-issues a key against the SAME 24-hour deadline instead of
   * starting a fresh trial. Nothing about the machine is derived or fingerprinted —
   * it is a random value this plugin made up about itself.
   */
  installId?: string;
  /** dashboard UID -> what it was connected to. */
  dashboards?: Record<string, DashboardBinding>;
}

export interface PluginState {
  enabled: boolean;
  jsonData: AskAppSettings;
  /** Whether an API key is stored. The value itself is never returned. */
  apiKeySet: boolean;
}

let cached: PluginState | undefined;

export async function loadState(force = false): Promise<PluginState> {
  if (cached && !force) {
    return cached;
  }
  const res = await getBackendSrv().get<{
    enabled?: boolean;
    jsonData?: AskAppSettings;
    secureJsonFields?: Record<string, boolean>;
  }>(`/api/plugins/${PLUGIN_ID}/settings`);
  cached = {
    enabled: Boolean(res?.enabled),
    jsonData: res?.jsonData ?? {},
    apiKeySet: Boolean(res?.secureJsonFields?.apiKey),
  };
  return cached;
}

export async function loadSettings(force = false): Promise<AskAppSettings> {
  return (await loadState(force)).jsonData;
}

/**
 * The cached settings, without waiting.
 *
 * Grafana decides whether to show a panel-menu link by calling `configure` synchronously
 * while it builds the menu, so there is nowhere to await a fetch. `prime()` runs once at
 * plugin load and fills this in; until it resolves, callers see `undefined` and should
 * treat that as "don't show anything", which fails closed rather than flashing a menu
 * item that then errors.
 */
export function peekSettings(): AskAppSettings | undefined {
  return cached?.jsonData;
}

export function prime(): void {
  loadState(true).catch(() => undefined);
}

/**
 * Save settings. Pass `apiKey` only when the user typed a new one.
 *
 * NOTE: Grafana MERGES jsonData on this endpoint rather than replacing it, so a key
 * cannot be removed by omitting it — set it to undefined explicitly if you need it gone.
 */
export async function saveSettings(jsonData: AskAppSettings): Promise<void> {
  await getBackendSrv().post(`/api/plugins/${PLUGIN_ID}/settings`, { enabled: true, pinned: true, jsonData });
  cached = undefined;
}

/**
 * This Grafana's install id, creating it the first time it is asked for.
 *
 * Stored in the app's own settings rather than localStorage: the id has to be the same
 * for every admin who opens the setup page, and a browser-local value would hand each
 * of them their own trial.
 */
export async function ensureInstallId(): Promise<string> {
  const s = await loadSettings(true);
  if (s.installId) {
    return s.installId;
  }
  const id =
    globalThis.crypto?.randomUUID?.() ??
    // Grafana runs over http on plenty of internal networks, where randomUUID is not
    // exposed. Any unique string does the job; it is an id, not a secret.
    `gf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  await saveSettings({ ...s, installId: id });
  return id;
}

/**
 * Which database answers questions asked from a given dashboard.
 *
 * Per-dashboard, because one Grafana can front several unrelated databases and a
 * question about a panel should query the database that panel is drawn from — not
 * whichever one happened to be set up first. Falls back to the default so the panel menu
 * still works on a dashboard nobody has run setup for.
 */
export function bindingFor(settings: AskAppSettings, dashboardUid?: string): DashboardBinding | undefined {
  const bound = dashboardUid ? settings.dashboards?.[dashboardUid] : undefined;
  if (bound) {
    return bound;
  }
  return settings.brygeDatasourceId ? { brygeDatasourceId: settings.brygeDatasourceId } : undefined;
}

/** The dashboard the browser is currently showing, from the URL. */
export function currentDashboardUid(): string | undefined {
  return /\/d\/([^/?#]+)/.exec(window.location.pathname)?.[1];
}
