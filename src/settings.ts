/**
 * Where the app keeps its two settings: which Bryge data source to speak through, and
 * which connected database to answer from.
 *
 * Read straight off Grafana's plugin settings API rather than passed down through
 * React context, because the panel-menu extension opens its modal outside the app's own
 * component tree — there is no provider above it to read from.
 */
import { getBackendSrv } from '@grafana/runtime';

export const PLUGIN_ID = 'bryge-ask-app';

export interface AskAppSettings {
  datasourceUid?: string;
  brygeDatasourceId?: string;
}

let cached: AskAppSettings | undefined;

export async function loadSettings(force = false): Promise<AskAppSettings> {
  if (cached && !force) {
    return cached;
  }
  const res = await getBackendSrv().get<{ jsonData?: AskAppSettings }>(`/api/plugins/${PLUGIN_ID}/settings`);
  cached = res?.jsonData ?? {};
  return cached;
}

export async function saveSettings(jsonData: AskAppSettings): Promise<void> {
  await getBackendSrv().post(`/api/plugins/${PLUGIN_ID}/settings`, { enabled: true, pinned: true, jsonData });
  cached = jsonData;
}
