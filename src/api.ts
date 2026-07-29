/**
 * Talking to Bryge.
 *
 * Everything goes through the Bryge API data source's proxy route. The app-level proxy
 * (`/api/plugin-proxy/<id>/…`) would have avoided needing a data source at all, but
 * Grafana 13 does not register those routes for an app without a backend — every
 * request comes back "plugin route match not found" — so the data source stays.
 */
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { loadSettings } from './settings';

export interface BrygeField {
  name: string;
  type: 'time' | 'number' | 'string' | 'boolean';
  values: Array<number | string | boolean | null>;
}

export interface BrygeFrame {
  fields: BrygeField[];
  row_count: number;
  truncated?: boolean;
  sql?: string;
  executed_sql?: string;
  error?: string;
}

export interface BrygeAnswer {
  answer: string;
  sql: string | null;
  frame: BrygeFrame | null;
  templated: boolean;
  window: { from: string; to: string; bucket: string };
  meta?: { model?: string; cost_usd?: number };
}

export interface BrygeDatasourceInfo {
  id: string;
  name: string;
  kind: string;
  database: string;
  status: string;
}

export interface AskWindow {
  from: string;
  to: string;
  max_data_points: number;
}

export interface OnboardResult {
  id: string;
  name: string;
  status: string;
  created: boolean;
}

export interface BrygeStatus {
  status: string;
  last_error?: string | null;
  run?: { status: string; tables: number; links: number; foreign_keys: number; semantic_links: number } | null;
}

export interface BrygeHealth {
  ok: boolean;
  user: string;
  datasource_count: number;
  analyzed_count: number;
}

/**
 * Every call is proxied by the Bryge API data source the app creates during setup.
 * Grafana decrypts the stored key server-side and attaches it, so the browser never
 * sees it. The UID is looked up from the app's settings rather than threaded through
 * every call site, because the panel and the panel-menu modal both live outside the
 * app's component tree.
 */
async function base(): Promise<string> {
  const { datasourceUid } = await loadSettings();
  if (!datasourceUid) {
    throw new Error('Ask Bryge is not connected yet. Run setup under Administration -> Plugins -> Ask Bryge.');
  }
  return `/api/datasources/proxy/uid/${datasourceUid}/bryge`;
}

async function post<T>(path: string, data: unknown): Promise<T> {
  const res = await lastValueFrom(getBackendSrv().fetch<T>({ url: `${await base()}${path}`, method: 'POST', data }));
  return res.data;
}

async function get<T>(path: string): Promise<T> {
  const res = await lastValueFrom(getBackendSrv().fetch<T>({ url: `${await base()}${path}`, method: 'GET' }));
  return res.data;
}

export function health(): Promise<BrygeHealth> {
  return get('/api/grafana/health');
}

export function listDatasources(): Promise<{ datasources: BrygeDatasourceInfo[] }> {
  return get('/api/grafana/datasources');
}

/** Hand a database to Bryge. Idempotent by host/port/database, so re-running setup on a
 *  dashboard joins the existing analysis rather than duplicating it. */
export function onboard(body: Record<string, unknown>): Promise<OnboardResult> {
  return post('/api/grafana/onboard', body);
}

export function datasourceStatus(datasourceId: string): Promise<BrygeStatus> {
  return get(`/api/grafana/datasources/${datasourceId}/status`);
}

/**
 * Forget a database on the Bryge side: the connection, its analysis run, every table
 * node, every discovered relationship and its embeddings.
 *
 * Needed so that removing the plugin and adding it again starts clean instead of
 * layering a second analysis on top of the first. Deleting the row cascades to the
 * graph, so one call is enough.
 */
export async function forget(datasourceId: string): Promise<void> {
  await lastValueFrom(
    getBackendSrv().fetch({ url: `${await base()}/api/datasources/${datasourceId}`, method: 'DELETE' })
  );
}

/** Ask a question. Costs a model call. */
export function ask(
  datasourceId: string,
  question: string,
  window: AskWindow,
  maxRows = 5000
): Promise<BrygeAnswer> {
  return post('/api/grafana/query', {
    datasource_id: datasourceId,
    question,
    max_rows: maxRows,
    use_cache: false,
    ...window,
  });
}

/** Re-run an already-generated query for a new time window. No model call. */
export function rerun(
  datasourceId: string,
  sql: string,
  window: AskWindow,
  maxRows = 5000
): Promise<BrygeFrame> {
  return post('/api/grafana/run', {
    datasource_id: datasourceId,
    sql,
    max_rows: maxRows,
    ...window,
  });
}

export function describeError(err: unknown): string {
  const e = err as { status?: number; data?: { detail?: string; message?: string }; message?: string };
  if (e?.status === 401) {
    return 'Bryge rejected the API key. Check it on the Ask Bryge configuration page.';
  }
  if (e?.status === 502 || e?.status === 504) {
    return 'Grafana could not reach the Bryge API. Check the URL, and that Bryge is running and reachable from this Grafana server.';
  }
  if (e?.status === 429) {
    return 'Too many questions in a row — Bryge is rate limiting. Try again in a minute.';
  }
  return e?.data?.detail || e?.data?.message || e?.message || 'Bryge could not answer that.';
}
