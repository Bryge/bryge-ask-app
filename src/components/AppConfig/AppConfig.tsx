import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppPluginMeta, PluginConfigPageProps, SelectableValue } from '@grafana/data';
import {
  Alert,
  Button,
  Collapse,
  Field,
  FieldSet,
  Icon,
  Input,
  SecretInput,
  Select,
  Spinner,
  Stack,
  Text,
  TextArea,
} from '@grafana/ui';

import { datasourceStatus, describeError, forget, health, listDatasources, onboard } from '../../api';
import { DEFAULT_BRYGE_API_KEY, DEFAULT_BRYGE_URL, IS_HOSTED_BUILD } from '../../defaults';
import {
  brygeKindOf,
  connectionFor,
  DATASOURCE_TYPE,
  DashboardSummary,
  deleteDatasource,
  getDashboard,
  GrafanaDatasource,
  listDashboards,
  listGrafanaDatasources,
  saveDashboard,
  secretPromptFor,
  sourcesUsedBy,
  upsertBrygeDatasource,
  withChatPanel,
  withoutChatPanel,
} from '../../grafana';
import { AskAppSettings, loadState, saveSettings } from '../../settings';

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AskAppSettings>> {}

type Phase = 'idle' | 'connecting' | 'analyzing' | 'installing' | 'done';

/**
 * Setup is one step: pick a dashboard.
 *
 * There is deliberately nothing to configure first. This build carries Bryge's own API
 * address and key, so the connection is made silently the first time this page opens —
 * asking for a URL and a key was ceremony with no decision behind it, since the answer
 * was always the same. Anyone running their own Bryge can still override both under
 * Advanced.
 *
 * Picking a dashboard does the rest: read which database its panels already query, hand
 * that database to Bryge scoped to those tables, wait for the schema analysis, and write
 * the chat panel onto the dashboard. The database password is the only thing typed by
 * hand, because Grafana encrypts stored credentials and never gives them back.
 */
const AppConfig = ({ plugin }: AppConfigProps) => {
  const [settings, setSettings] = useState<AskAppSettings>(plugin.meta.jsonData ?? {});
  const [connected, setConnected] = useState(false);
  const [connectionNote, setConnectionNote] = useState<string>();
  const [booting, setBooting] = useState(true);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);

  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [chosen, setChosen] = useState<string>();
  const [source, setSource] = useState<{ ds: GrafanaDatasource; tables: string[] } | null>(null);
  const [password, setPassword] = useState('');
  // The three questions the web onboarding asks. They are not decoration: the graph
  // builder injects them when it writes table summaries and infers relationships, so a
  // database described as "a plant's energy metering" produces different links than the
  // same schema described as "a billing system".
  const [description, setDescription] = useState('');
  const [industry, setIndustry] = useState('');
  const [useCases, setUseCases] = useState('');
  const [alreadyAnalyzed, setAlreadyAnalyzed] = useState<string>();

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [installed, setInstalled] = useState<{ uid: string; title: string; tables: number; links: number }>();
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState<string>();

  /** Connected means Bryge answers, not that a setting was saved once. */
  const probe = useCallback(async () => {
    try {
      const h = await health();
      setConnected(Boolean(h?.ok));
      setConnectionNote(h?.ok ? `Connected to Bryge as ${h.user}.` : undefined);
    } catch (e) {
      setConnected(false);
      setConnectionNote(describeError(e));
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await loadState(true);
        let ds = (await listGrafanaDatasources()).find((d) => d.type === DATASOURCE_TYPE);
        if (!ds && IS_HOSTED_BUILD) {
          // First run on a hosted build: make the connection without asking.
          const uid = await upsertBrygeDatasource(DEFAULT_BRYGE_URL, DEFAULT_BRYGE_API_KEY);
          await saveSettings({ ...s.jsonData, datasourceUid: uid });
          ds = (await listGrafanaDatasources()).find((d) => d.type === DATASOURCE_TYPE);
        }
        // Trust a stored UID only if that data source still exists — someone can delete it.
        setSettings(ds ? { ...s.jsonData, datasourceUid: ds.uid } : { ...s.jsonData, datasourceUid: undefined });
        setUrl((ds?.jsonData?.url as string) ?? DEFAULT_BRYGE_URL);
        setKeySaved(Boolean(ds));
        if (ds) {
          await probe();
        }
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBooting(false);
      }
    })();
  }, [probe]);

  useEffect(() => {
    if (!connected) {
      return;
    }
    listDashboards()
      .then(setDashboards)
      .catch((e) => setError(describeError(e)));
  }, [connected]);

  const saveConnection = async () => {
    setError(undefined);
    setPhase('connecting');
    try {
      const uid = await upsertBrygeDatasource(url.trim(), apiKey.trim());
      const next = { ...settings, datasourceUid: uid };
      await saveSettings(next);
      setSettings(next);
      setKeySaved(true);
      setApiKey('');
      // Grafana caches the data source registry in the running frontend, so a route for
      // one created seconds ago is not reachable until a reload.
      window.location.reload();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPhase('idle');
    }
  };

  const inspect = useCallback(async (uid: string) => {
    setSource(null);
    setError(undefined);
    try {
      const { dashboard } = await getDashboard(uid);
      const used = sourcesUsedBy(dashboard);
      const all = await listGrafanaDatasources();
      for (const u of used) {
        const ds = all.find((d) => d.uid === u.uid);
        if (ds && brygeKindOf(ds.type)) {
          setSource({ ds, tables: u.tables });
          // Already connected? Then setup is a no-op and the analysis is reused rather
          // than run a second time.
          try {
            const known = (await listDatasources()).datasources.find(
              (b) => b.database === ((ds.jsonData?.database as string) ?? ds.database)
            );
            setAlreadyAnalyzed(known && known.status === 'analyzed' ? known.name : undefined);
          } catch {
            setAlreadyAnalyzed(undefined);
          }
          return;
        }
      }
      setError(
        "None of this dashboard's panels query a database Bryge supports (Postgres, ClickHouse or InfluxDB)."
      );
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  useEffect(() => {
    if (chosen) {
      inspect(chosen);
    }
  }, [chosen, inspect]);

  const install = async () => {
    if (!chosen || !source) {
      return;
    }
    setError(undefined);
    setInstalled(undefined);
    const dashboardMeta = dashboards.find((d) => d.uid === chosen);
    try {
      setPhase('connecting');
      setProgress('Connecting the database…');
      const { kind, connection } = connectionFor(source.ds, password);
      const res = await onboard({
        name: source.ds.name,
        kind,
        connection,
        allowed_tables: source.tables.length ? source.tables : undefined,
        description:
          description.trim() ||
          `Connected from the Grafana dashboard "${dashboardMeta?.title ?? chosen}".`,
        industry: industry.trim() || undefined,
        use_cases: useCases.trim() || undefined,
      });

      setPhase('analyzing');
      let run: { tables?: number; links?: number } = {};
      for (let i = 0; i < 200; i++) {
        const status = await datasourceStatus(res.id);
        run = status.run ?? {};
        if (status.status === 'analyzed') {
          break;
        }
        if (status.status === 'error') {
          throw new Error(status.last_error ?? 'Schema analysis failed.');
        }
        setProgress(`Reading the schema — tables, foreign keys and inferred relationships… (${status.status})`);
        await new Promise((r) => setTimeout(r, 3000));
      }

      setPhase('installing');
      setProgress('Adding the chat panel to the dashboard…');
      const { dashboard, meta } = await getDashboard(chosen);
      await saveDashboard(withChatPanel(dashboard, res.id), meta?.folderUid, 'Added the Bryge chat panel');

      const next: AskAppSettings = {
        ...settings,
        brygeDatasourceId: settings.brygeDatasourceId ?? res.id,
        dashboards: {
          ...(settings.dashboards ?? {}),
          [chosen]: {
            brygeDatasourceId: res.id,
            brygeDatasourceName: res.name,
            dashboardTitle: dashboardMeta?.title,
            installedAt: new Date().toISOString(),
          },
        },
      };
      await saveSettings(next);
      setSettings(next);
      setInstalled({
        uid: chosen,
        title: dashboardMeta?.title ?? chosen,
        tables: run.tables ?? 0,
        links: run.links ?? 0,
      });
      setPhase('done');
      setPassword('');
    } catch (e) {
      setError(describeError(e));
      setPhase('idle');
    }
  };

  /**
   * Take Bryge back out, in the order that leaves nothing broken: panels first,
   * connection second, settings last. A panel whose plugin has been uninstalled renders
   * as a dead tile the dashboard owner then has to delete by hand — which is why this is
   * a button, and not something hopeful attached to uninstall, an event plugins never see.
   *
   * The Bryge side is deliberately untouched: the database stays connected and its
   * analysis intact, so re-installing later costs nothing.
   */
  const removeEverything = async () => {
    setRemoving(true);
    setError(undefined);
    setRemoved(undefined);
    try {
      const uids = Object.keys(settings.dashboards ?? {});
      const brygeIds = new Set(
        Object.values(settings.dashboards ?? {}).map((b) => b.brygeDatasourceId).filter(Boolean)
      );
      let cleaned = 0;
      for (const uid of uids) {
        try {
          const { dashboard, meta } = await getDashboard(uid);
          await saveDashboard(withoutChatPanel(dashboard), meta?.folderUid, 'Removed the Bryge chat panel');
          cleaned++;
        } catch {
          // A dashboard someone deleted or locked is no reason to abandon the rest.
        }
      }
      // Forget the analysis itself, so reconnecting later starts clean instead of
      // stacking a second graph on top of the first.
      let forgotten = 0;
      for (const id of brygeIds) {
        try {
          await forget(id);
          forgotten++;
        } catch {
          // someone else may already have removed it
        }
      }
      if (settings.datasourceUid) {
        try {
          await deleteDatasource(settings.datasourceUid);
        } catch {
          // already gone
        }
      }
      // Every key set EXPLICITLY: this endpoint MERGES jsonData, so an omitted key keeps
      // its old value and the panel menu would go on offering itself for a dashboard
      // that is no longer connected.
      await saveSettings({ dashboards: {}, brygeDatasourceId: undefined, datasourceUid: undefined });
      setSettings({ dashboards: {} });
      setChosen(undefined);
      setSource(null);
      setConnected(false);
      setRemoved(
        `Removed the chat panel from ${cleaned} dashboard(s), forgot ${forgotten} analyzed database(s), ` +
          `and deleted the connection. It is now safe to uninstall the plugin.`
      );
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRemoving(false);
    }
  };

  const dashboardOptions: Array<SelectableValue<string>> = useMemo(
    () =>
      dashboards.map((d) => ({
        value: d.uid,
        label: d.title,
        description: [d.folderTitle, settings.dashboards?.[d.uid] ? 'already set up' : undefined]
          .filter(Boolean)
          .join(' · '),
      })),
    [dashboards, settings.dashboards]
  );

  const busy = phase !== 'idle' && phase !== 'done';

  const connectionFields = (
    <>
      <Field label="Bryge API URL" description="Must be reachable from this Grafana server.">
        <Input
          value={url}
          placeholder="https://api.bryge.io"
          width={50}
          onChange={(e) => setUrl(e.currentTarget.value)}
        />
      </Field>
      <Field
        label="API key"
        description="Stored encrypted by Grafana and attached server-side, so it never reaches the browser."
      >
        <SecretInput
          isConfigured={keySaved}
          value={apiKey}
          placeholder="bk_…"
          width={50}
          onReset={() => {
            setKeySaved(false);
            setApiKey('');
          }}
          onChange={(e) => setApiKey(e.currentTarget.value)}
        />
      </Field>
      <Button onClick={saveConnection} disabled={!url.trim() || (!apiKey.trim() && !keySaved) || busy}>
        Save connection
      </Button>
    </>
  );

  if (booting) {
    return (
      <Stack direction="row" gap={1} alignItems="center">
        <Spinner />
        <Text color="secondary">Connecting to Bryge…</Text>
      </Stack>
    );
  }

  return (
    <Stack direction="column" gap={3}>
      {!IS_HOSTED_BUILD && <FieldSet label="Connect to Bryge">{connectionFields}</FieldSet>}

      <FieldSet label="Add Bryge to a dashboard">
        <Stack direction="column" gap={1}>
          {connected && connectionNote && (
            <Text variant="bodySmall" color="secondary">
              {connectionNote}
            </Text>
          )}

          {!connected ? (
            <Alert title="Bryge is not reachable" severity="warning">
              {connectionNote ?? 'Could not reach the Bryge API from this Grafana server.'}
            </Alert>
          ) : (
            <>
              <Field label="Dashboard" description="Bryge reads which database this dashboard already charts.">
                <Select
                  options={dashboardOptions}
                  value={chosen}
                  placeholder={dashboards.length ? 'Select a dashboard' : 'Loading dashboards…'}
                  onChange={(v) => setChosen(v.value)}
                  width={50}
                />
              </Field>

              {source && (
                <>
                  <Alert title={`Found ${source.ds.name}`} severity="info">
                    <Stack direction="column" gap={0}>
                      <span>
                        {brygeKindOf(source.ds.type)} ·{' '}
                        {(source.ds.jsonData?.host as string) ?? source.ds.url} ·{' '}
                        {(source.ds.jsonData?.defaultBucket as string) ??
                          (source.ds.jsonData?.defaultDatabase as string) ??
                          (source.ds.jsonData?.database as string) ??
                          source.ds.database}
                        {/* ClickHouse keeps the user in jsonData, Postgres at the top level. */}
                        {((source.ds.jsonData?.username as string) ?? source.ds.user) ? (
                          <>
                            {' '}as <strong>{(source.ds.jsonData?.username as string) ?? source.ds.user}</strong>
                          </>
                        ) : null}
                      </span>
                      <span>
                        {source.tables.length
                          ? `Bryge will be scoped to the ${source.tables.length} table(s) this dashboard queries: ${source.tables.join(', ')}.`
                          : 'No table names were found in the panel queries, so Bryge will analyze the whole database.'}
                      </span>
                    </Stack>
                  </Alert>
                  {alreadyAnalyzed ? (
                    <Alert title={`Bryge already knows this database`} severity="success">
                      It was analyzed earlier as &quot;{alreadyAnalyzed}&quot;. Connecting again reuses that
                      analysis — the schema is not read a second time and no duplicate is created.
                    </Alert>
                  ) : (
                    <>
                      <Field
                        label="What does this operation do?"
                        description="Plain language. Bryge uses it when it writes table summaries and works out how tables relate."
                      >
                        <TextArea
                          rows={2}
                          value={description}
                          width={50}
                          placeholder="e.g. a manufacturing plant's electricity metering, solar generation and local weather"
                          onChange={(e) => setDescription(e.currentTarget.value)}
                        />
                      </Field>
                      <Field label="Industry" description="One or two words.">
                        <Input
                          value={industry}
                          width={50}
                          placeholder="e.g. energy, manufacturing"
                          onChange={(e) => setIndustry(e.currentTarget.value)}
                        />
                      </Field>
                      <Field
                        label="What do you want to get out of it?"
                        description="What people will actually ask. It steers which relationships are worth inferring."
                      >
                        <TextArea
                          rows={2}
                          value={useCases}
                          width={50}
                          placeholder="e.g. spot consumption spikes, compare generation against irradiance, explain cost changes"
                          onChange={(e) => setUseCases(e.currentTarget.value)}
                        />
                      </Field>
                    </>
                  )}
                  <Field
                    label={secretPromptFor(brygeKindOf(source.ds.type)!).label}
                    description={secretPromptFor(brygeKindOf(source.ds.type)!).hint}
                  >
                    <Input
                      type="password"
                      value={password}
                      width={50}
                      placeholder={secretPromptFor(brygeKindOf(source.ds.type)!).label}
                      onChange={(e) => setPassword(e.currentTarget.value)}
                    />
                  </Field>
                  <Stack direction="row" gap={1} alignItems="center">
                    <Button onClick={install} disabled={busy || !password}>
                      {busy ? 'Setting up…' : 'Add Bryge to this dashboard'}
                    </Button>
                    {busy && (
                      <>
                        <Spinner />
                        <Text variant="bodySmall" color="secondary">
                          {progress ?? 'Working…'}
                        </Text>
                      </>
                    )}
                  </Stack>
                </>
              )}
            </>
          )}

          {error && (
            <Alert title="Setup failed" severity="error" onRemove={() => setError(undefined)}>
              {error}
            </Alert>
          )}

          {installed && (
            <Alert title={`${installed.title} is ready`} severity="success">
              <Stack direction="column" gap={1}>
                <span>
                  Bryge found {installed.tables} tables and {installed.links} relationships. The chat panel is at the
                  bottom of the dashboard, and every panel&apos;s menu now has &quot;Ask Bryge about this panel&quot;.
                </span>
                <Button
                  icon="external-link-alt"
                  size="sm"
                  // A full page load, not SPA navigation: the panel-menu link is decided
                  // from settings cached when the plugin module loaded, and this dashboard
                  // was bound seconds ago.
                  onClick={() => window.location.assign(`/d/${installed.uid}`)}
                >
                  Open the dashboard
                </Button>
              </Stack>
            </Alert>
          )}
        </Stack>
      </FieldSet>

      {settings.dashboards && Object.keys(settings.dashboards).length > 0 && (
        <FieldSet label="Dashboards using Bryge">
          <Stack direction="column" gap={1}>
            {Object.entries(settings.dashboards).map(([uid, b]) => (
              <Stack key={uid} direction="row" gap={1} alignItems="center">
                <Icon name="apps" />
                <a href={`/d/${uid}`}>{b.dashboardTitle ?? uid}</a>
              </Stack>
            ))}
            <Stack direction="row" gap={1} alignItems="center">
              <Button variant="destructive" size="sm" onClick={removeEverything} disabled={removing} icon="trash-alt">
                {removing ? 'Removing…' : 'Remove Bryge from these dashboards'}
              </Button>
              <Text variant="bodySmall" color="secondary">
                Run this before uninstalling. It takes the chat panel off every dashboard and deletes the
                connection; your data and its analysis are left untouched.
              </Text>
            </Stack>
          </Stack>
        </FieldSet>
      )}

      {removed && (
        <Alert title="Removed" severity="success" onRemove={() => setRemoved(undefined)}>
          {removed}
        </Alert>
      )}

      {IS_HOSTED_BUILD && (
        <Collapse label="Advanced" isOpen={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)} collapsible>
          <Text variant="bodySmall" color="secondary">
            This plugin talks to Bryge&apos;s hosted API. Override it only if you run your own Bryge.
          </Text>
          {connectionFields}
        </Collapse>
      )}
    </Stack>
  );
};

export default AppConfig;
