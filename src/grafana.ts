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
const CTE_NAME = /\b(?:with|,)\s+([a-zA-Z_][\w$]*)\s+as\s*\(/gi;

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
