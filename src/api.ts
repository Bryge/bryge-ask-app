/**
 * Talking to Bryge from the app.
 *
 * Same trick as the panel: the app holds no credentials, it borrows the Bryge *data
 * source's*. Requests go through `/api/datasources/proxy/uid/<uid>/bryge/…` and Grafana
 * attaches the stored API key server-side.
 *
 * (This mirrors `bryge-chat-panel/src/api.ts`. The two are separate npm packages with
 * separate webpack roots, so the file is duplicated rather than imported.)
 */
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

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

function url(uid: string, path: string) {
  return `/api/datasources/proxy/uid/${uid}/bryge${path}`;
}

async function post<T>(uid: string, path: string, data: unknown): Promise<T> {
  const res = await lastValueFrom(getBackendSrv().fetch<T>({ url: url(uid, path), method: 'POST', data }));
  return res.data;
}

async function get<T>(uid: string, path: string): Promise<T> {
  const res = await lastValueFrom(getBackendSrv().fetch<T>({ url: url(uid, path), method: 'GET' }));
  return res.data;
}

export function ask(
  uid: string,
  datasourceId: string,
  question: string,
  window: AskWindow,
  maxRows = 5000
): Promise<BrygeAnswer> {
  return post(uid, '/api/grafana/query', {
    datasource_id: datasourceId,
    question,
    max_rows: maxRows,
    use_cache: false,
    ...window,
  });
}

export function rerun(
  uid: string,
  datasourceId: string,
  sql: string,
  window: AskWindow,
  maxRows = 5000
): Promise<BrygeFrame> {
  return post(uid, '/api/grafana/run', {
    datasource_id: datasourceId,
    sql,
    max_rows: maxRows,
    ...window,
  });
}

export function listDatasources(uid: string): Promise<{ datasources: BrygeDatasourceInfo[] }> {
  return get(uid, '/api/grafana/datasources');
}

export function describeError(err: unknown): string {
  const e = err as { status?: number; data?: { detail?: string; message?: string }; message?: string };
  if (e?.status === 401) {
    return 'Bryge rejected the API key. Check the Bryge data source settings.';
  }
  if (e?.status === 429) {
    return 'Too many questions in a row — Bryge is rate limiting. Try again in a minute.';
  }
  return e?.data?.detail || e?.data?.message || e?.message || 'Bryge could not answer that.';
}
