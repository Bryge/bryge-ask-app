/**
 * The Grafana side of installation.
 *
 * The app sets a dashboard up on the user's behalf: it reads the dashboards they
 * already have, works out which database each one charts, and writes the chat panel
 * back into the one they pick. All of it goes through Grafana's own HTTP API with the
 * signed-in user's session, so it can never do anything the user could not do by hand.
 */
import { getBackendSrv } from '@grafana/runtime';

export const DATASOURCE_TYPE = 'bryge-ask-datasource';
export const PANEL_TYPE = 'bryge-ask-panel';

export interface DashboardSummary {
  uid: string;
  title: string;
  folderTitle?: string;
  url: string;
}

export interface GrafanaDatasource {
  id: number;
  uid: string;
  name: string;
  type: string;
  url?: string;
  database?: string;
  user?: string;
  jsonData?: Record<string, unknown>;
}

/** Grafana datasource type -> the engine name Bryge knows it by. */
const KIND_BY_TYPE: Record<string, string> = {
  postgres: 'postgres',
  'grafana-postgresql-datasource': 'postgres',
  'grafana-clickhouse-datasource': 'clickhouse',
  'vertamedia-clickhouse-datasource': 'clickhouse',
  'grafana-influxdb-datasource': 'influxdb2',
  influxdb: 'influxdb2',
};

const DEFAULT_PORTS: Record<string, number> = { postgres: 5432, clickhouse: 8123, influxdb2: 8086 };

/** Split "host:port" as Grafana stores a data source URL. */
function splitHostPort(url: string | undefined, fallbackPort: number): { host: string; port: number } {
  const raw = (url ?? '').replace(/^\w+:\/\//, '').trim();
  const idx = raw.lastIndexOf(':');
  if (idx === -1) {
    return { host: raw, port: fallbackPort };
  }
  const port = Number(raw.slice(idx + 1));
  return { host: raw.slice(0, idx), port: Number.isFinite(port) && port > 0 ? port : fallbackPort };
}

export function brygeKindOf(type: string): string | undefined {
  return KIND_BY_TYPE[type];
}

export function listDashboards(): Promise<DashboardSummary[]> {
  return getBackendSrv().get<DashboardSummary[]>('/api/search', { type: 'dash-db', limit: 500 });
}

export function getDashboard(uid: string): Promise<{ dashboard: any; meta: any }> {
  return getBackendSrv().get(`/api/dashboards/uid/${uid}`);
}

export function saveDashboard(dashboard: any, folderUid: string | undefined, message: string) {
  return getBackendSrv().post('/api/dashboards/db', {
    dashboard,
    folderUid,
    message,
    overwrite: false,
  });
}

export function listGrafanaDatasources(): Promise<GrafanaDatasource[]> {
  return getBackendSrv().get<GrafanaDatasource[]>('/api/datasources');
}

/**
 * Create (or update) the data source that carries the Bryge URL and key.
 *
 * Done for the user rather than asking them to go and create one first: they have
 * already typed the two values on the setup page, and a data source is simply where
 * Grafana insists an encrypted secret lives.
 */
export async function upsertBrygeDatasource(url: string, apiKey: string): Promise<string> {
  const existing = (await listGrafanaDatasources()).find((d) => d.type === DATASOURCE_TYPE);
  if (existing) {
    const body: Record<string, unknown> = {
      ...existing,
      type: DATASOURCE_TYPE,
      access: 'proxy',
      jsonData: { ...(existing.jsonData ?? {}), url },
    };
    // Only send the key when the user typed a new one — an empty string would wipe it.
    if (apiKey) {
      body.secureJsonData = { apiKey };
    }
    await getBackendSrv().put(`/api/datasources/uid/${existing.uid}`, body);
    return existing.uid;
  }
  const created = await getBackendSrv().post<{ datasource: GrafanaDatasource }>('/api/datasources', {
    name: 'Bryge API',
    type: DATASOURCE_TYPE,
    access: 'proxy',
    jsonData: { url },
    secureJsonData: { apiKey },
  });
  return created.datasource.uid;
}

const FROM_JOIN = /\b(?:from|join)\s+([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)/gi;
// `\b` belongs on `with` alone: a comma after a closing paren (`), b AS (`) has no word
// boundary in front of it, so `\b(?:with|,)` misses every CTE after the first and then
// reads its name as a table.
const CTE_NAME = /(?:\bwith\b|,)\s+([a-zA-Z_][\w$]*)\s+as\s*\(/gi;

function tablesInSql(sql: string): string[] {
  const ctes = new Set<string>();
  for (const m of sql.matchAll(CTE_NAME)) {
    ctes.add(m[1].toLowerCase());
  }
  const found = new Set<string>();
  for (const m of sql.matchAll(FROM_JOIN)) {
    if (!ctes.has(m[1].toLowerCase())) {
      found.add(m[1]);
    }
  }
  return [...found];
}

export interface DashboardSource {
  uid: string;
  panels: number;
  tables: string[];
}

/**
 * Which databases a dashboard actually reads, and which tables it touches in each.
 *
 * The tables matter as much as the datasource: they are the user's own statement of
 * what is worth looking at, and scoping Bryge to them keeps it from analyzing every
 * unrelated schema that happens to live on the same server.
 */
export function sourcesUsedBy(dashboard: any): DashboardSource[] {
  const byUid = new Map<string, DashboardSource>();

  const visit = (panels: any[]) => {
    for (const panel of panels ?? []) {
      for (const target of panel?.targets ?? []) {
        const uid = target?.datasource?.uid ?? panel?.datasource?.uid;
        if (!uid || typeof uid !== 'string' || uid.startsWith('-- ')) {
          continue;
        }
        const entry = byUid.get(uid) ?? { uid, panels: 0, tables: [] };
        entry.panels += 1;
        const sql = target?.rawSql ?? target?.query ?? target?.sql;
        if (typeof sql === 'string') {
          for (const t of tablesInSql(sql)) {
            if (!entry.tables.includes(t)) {
              entry.tables.push(t);
            }
          }
        }
        byUid.set(uid, entry);
      }
      if (Array.isArray(panel?.panels)) {
        visit(panel.panels);
      }
    }
  };

  visit(dashboard?.panels ?? []);
  return [...byUid.values()].sort((a, b) => b.panels - a.panels);
}

/**
 * Grafana data source type -> the Bryge engine that reaches it THROUGH Grafana.
 *
 * These are the engines Bryge can query without ever being told a password: Grafana runs
 * the SQL with the credentials it already stores, so nothing has to be typed twice.
 * A type absent from this map still works, it just falls back to asking for the secret.
 */
const GRAFANA_KIND_BY_TYPE: Record<string, string> = {
  postgres: 'grafana-postgres',
  'grafana-postgresql-datasource': 'grafana-postgres',
  'grafana-clickhouse-datasource': 'grafana-clickhouse',
  'vertamedia-clickhouse-datasource': 'grafana-clickhouse',
};

export function grafanaKindOf(type: string): string | undefined {
  return GRAFANA_KIND_BY_TYPE[type];
}

const SERVICE_ACCOUNT_NAME = 'bryge-ask';

interface ServiceAccount {
  id: number;
  name: string;
  login: string;
}

/**
 * Get Bryge a Grafana service-account token, creating the account the first time.
 *
 * This is what removes the password prompt. Grafana encrypts stored data source
 * credentials and will never hand them back, so the old setup page had no choice but to
 * ask the user to type the database password a second time — for a database Grafana was
 * already querying on the very dashboard they had just picked. A token lets Bryge ask
 * Grafana to run the query instead, so the credential never moves.
 *
 * Viewer, deliberately: it is the least Grafana offers that can still query a data
 * source. Note that Viewer is NOT read-only against the database — Grafana passes SQL
 * straight through — so Bryge enforces read-only itself on the way out.
 *
 * Throws if the signed-in user may not manage service accounts. The caller falls back to
 * asking for the password, which always works.
 */
export async function issueServiceAccountToken(): Promise<string> {
  const srv = getBackendSrv();
  let account: ServiceAccount | undefined;
  try {
    const found = await srv.get<{ serviceAccounts: ServiceAccount[] }>('/api/serviceaccounts/search', {
      query: SERVICE_ACCOUNT_NAME,
      perpage: 100,
    });
    account = found?.serviceAccounts?.find((a) => a.name === SERVICE_ACCOUNT_NAME);
  } catch {
    // Search can be denied where create is not; let the create attempt produce the error.
  }
  if (!account) {
    account = await srv.post<ServiceAccount>('/api/serviceaccounts', {
      name: SERVICE_ACCOUNT_NAME,
      role: 'Viewer',
      isDisabled: false,
    });
  }
  // Token names must be unique within the account, and an existing token's value cannot
  // be read back, so every setup run issues a new one rather than trying to reuse.
  const created = await srv.post<{ key: string }>(`/api/serviceaccounts/${account.id}/tokens`, {
    name: `bryge-ask-${Date.now()}`,
  });
  if (!created?.key) {
    throw new Error('Grafana created the token but returned no value.');
  }
  return created.key;
}

/**
 * The address Bryge should use to call this Grafana.
 *
 * The browser's own origin is the right guess and the wrong answer often enough to matter:
 * `http://localhost:3000` is what an admin sees when Grafana runs on their machine, and
 * Bryge's servers cannot reach that. It is offered as a prefill the user can correct, and
 * the backend proves it by actually connecting before anything is saved.
 */
export function guessGrafanaUrl(): string {
  return window.location.origin;
}

export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(url.trim());
}

/**
 * The connection blob for reaching `ds` through this Grafana.
 *
 * host/port/database are carried alongside the Grafana fields for display only — they are
 * what the workspace shows in a service list, and they are not used to connect.
 */
export function grafanaConnectionFor(ds: GrafanaDatasource, token: string, grafanaUrl: string) {
  const kind = grafanaKindOf(ds.type)!;
  const json = ds.jsonData ?? {};
  const engine = brygeKindOf(ds.type)!;
  const { host, port } = splitHostPort((json.host as string) ?? ds.url, DEFAULT_PORTS[engine] ?? 5432);
  return {
    kind,
    connection: {
      grafana_url: grafanaUrl.trim().replace(/\/+$/, ''),
      grafana_token: token,
      datasource_uid: ds.uid,
      datasource_type: ds.type,
      host: (json.host as string) ?? host,
      port: Number(json.port) || port,
      database:
        (json.defaultDatabase as string) ??
        (json.database as string) ??
        ds.database ??
        '',
      username: (json.username as string) ?? ds.user ?? '',
    },
  };
}

/** What the secret field should be called and explained for a given engine. */
export function secretPromptFor(kind: string): { label: string; hint: string } {
  if (kind === 'influxdb2' || kind === 'influxdb3') {
    return {
      label: 'InfluxDB API token',
      hint: 'Grafana stores the token encrypted and never returns it, so it has to be entered once here.',
    };
  }
  return {
    label: 'Database password',
    hint: 'Grafana stores credentials encrypted and never returns them, so the password has to be entered once here.',
  };
}

/**
 * Build the connection blob Bryge expects for this engine.
 *
 * Each engine wants a different shape, and only the SQL ones look like
 * host/port/database/user/password. InfluxDB is authenticated by a token and addresses
 * data by org + bucket, so reusing the Postgres shape produces a connection that fails
 * with a confusing error rather than an obvious one.
 *
 * Everything except the secret is read off the Grafana data source; the secret is the
 * one thing Grafana will not hand back.
 */
export function connectionFor(ds: GrafanaDatasource, secret: string) {
  const kind = brygeKindOf(ds.type)!;
  const json = ds.jsonData ?? {};

  if (kind === 'influxdb2' || kind === 'influxdb3') {
    const { host, port } = splitHostPort(ds.url, 8086);
    return {
      kind,
      connection: {
        host,
        port,
        token: secret,
        org: (json.organization as string) ?? '',
        bucket: (json.defaultBucket as string) ?? ds.database ?? '',
      },
    };
  }

  if (kind === 'clickhouse') {
    // Grafana talks to ClickHouse over the native protocol (9000) by default; Bryge
    // speaks its HTTP interface. Carrying 9000 across gives a connection that times out
    // for no visible reason, so fall back to the HTTP port unless one is configured.
    const configured = Number(json.port);
    const nativePort = !configured || configured === 9000 || configured === 9440;
    return {
      kind,
      connection: {
        host: (json.host as string) ?? splitHostPort(ds.url, 8123).host,
        port: nativePort ? 8123 : configured,
        database: (json.defaultDatabase as string) ?? ds.database ?? 'default',
        username: (json.username as string) ?? ds.user ?? 'default',
        password: secret,
      },
    };
  }

  const { host, port } = splitHostPort(ds.url, DEFAULT_PORTS[kind] ?? 5432);
  return {
    kind,
    connection: {
      host,
      port,
      // Grafana 13 keeps the database name in jsonData; older versions used the
      // top-level field. Read both so this works either way.
      database: (json.database as string) ?? ds.database ?? '',
      username: ds.user ?? '',
      password: secret,
      sslmode: (json.sslmode as string) ?? 'prefer',
    },
  };
}

/**
 * Take the chat panel back off a dashboard.
 *
 * Uninstalling a plugin leaves any panel of its type behind as a broken tile, so the
 * panel has to be removed BEFORE the plugin goes. This is the undo for withChatPanel.
 */
export function withoutChatPanel(dashboard: any) {
  return { ...dashboard, panels: (dashboard.panels ?? []).filter((p: any) => p.type !== PANEL_TYPE) };
}

export async function deleteDatasource(uid: string): Promise<void> {
  await getBackendSrv().delete(`/api/datasources/uid/${uid}`);
}

/** Append the chat panel below everything already on the dashboard. */
export function withChatPanel(dashboard: any, brygeDatasourceId: string) {
  const panels: any[] = [...(dashboard.panels ?? [])];
  const existing = panels.findIndex((p) => p.type === PANEL_TYPE);
  const bottom = panels.reduce((max, p) => Math.max(max, (p.gridPos?.y ?? 0) + (p.gridPos?.h ?? 0)), 0);
  const maxId = panels.reduce((max, p) => Math.max(max, p.id ?? 0), 0);

  const panel = {
    id: existing >= 0 ? panels[existing].id : maxId + 1,
    type: PANEL_TYPE,
    title: 'Ask Bryge',
    description:
      "Ask a question about this dashboard's data in plain language. Bryge writes the query and answers in the time range above.",
    gridPos: existing >= 0 ? panels[existing].gridPos : { h: 13, w: 24, x: 0, y: bottom },
    options: {
      brygeDatasourceId,
      starterQuestion: 'What stands out in this data?',
      showChart: true,
      maxRows: 5000,
    },
  };

  if (existing >= 0) {
    panels[existing] = panel;
  } else {
    panels.push(panel);
  }
  return { ...dashboard, panels };
}
