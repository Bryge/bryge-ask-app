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

/** One query the agent actually ran on the way to the answer. */
export interface BrygeQuery {
  sql: string;
  row_count?: number | null;
  /** How many distinct tables it reads. */
  tables?: number;
}

export interface BrygeAnswer {
  answer: string;
  sql: string | null;
  /**
   * Every query behind the answer, in the order they ran. `sql` above is the one the
   * panel charts (the widest of these); a causal question normally runs several.
   */
  queries?: BrygeQuery[];
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

export interface BrygeRun {
  status: string;
  tables: number;
  links: number;
  foreign_keys: number;
  semantic_links: number;
  /** queued | introspecting | summarizing | embedding | linking | done | error */
  phase?: string | null;
  phase_detail?: string | null;
  started_at?: string | null;
}

export interface BrygeStatus {
  status: string;
  last_error?: string | null;
  run?: BrygeRun | null;
}

export interface BrygeHealth {
  ok: boolean;
  user: string;
  role?: string;
  /** ISO-8601, or null for a key that never expires. */
  key_expires_at?: string | null;
  /** True while this Grafana is running on a time-boxed trial key. */
  trial?: boolean;
  datasource_count: number;
  analyzed_count: number;
}

/** What `POST /api/grafana/trial` hands back. The key is shown once and never again. */
export interface TrialGrant {
  key: string;
  expires_at: string;
  hours: number;
  account: string;
  trial: boolean;
  max_datasources: number;
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

/**
 * Start the 24-hour trial for this Grafana.
 *
 * The one Bryge route that needs no credential, which is the point: whoever just
 * installed the plugin does not have one yet. It still goes through the data source
 * proxy, so the URL stays in one place and no request is made from the browser to a
 * host the Grafana server might not be allowed to reach.
 *
 * `install_id` is this Grafana's own id from the app's settings, so calling twice
 * re-issues a key against the same deadline instead of starting a second trial.
 */
export function startTrial(body: {
  email: string;
  install_id: string;
  grafana_url?: string;
}): Promise<TrialGrant> {
  return post('/api/grafana/trial', body);
}

/** True when Bryge refused because the key's time ran out, rather than it being wrong. */
export function isExpiredKey(err: unknown): boolean {
  const e = err as { status?: number; data?: { detail?: string } };
  return e?.status === 401 && /expired/i.test(e?.data?.detail ?? '');
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

/** Prove a connection works before anything is saved on either side. */
export function testConnection(kind: string, connection: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  return post('/api/grafana/test', { kind, connection });
}

/**
 * Every table the connection can actually read.
 *
 * Asked BEFORE onboarding so the table picker offers what exists rather than what the
 * dashboard's SQL happens to mention. A panel charting one view names one table; the
 * question the user wants to ask usually spans several more.
 */
export function listTables(kind: string, connection: Record<string, unknown>): Promise<{ tables: string[] }> {
  return post('/api/grafana/tables', { kind, connection });
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
  if (isExpiredKey(err)) {
    return (
      'This Bryge key has expired. If this Grafana was on a trial, the trial has ended — ' +
      'create an API key on bryge.io and paste it in under Administration → Plugins → Ask Bryge.'
    );
  }
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
