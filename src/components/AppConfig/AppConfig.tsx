import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppPluginMeta, PluginConfigPageProps, SelectableValue } from '@grafana/data';
import {
  Alert,
  Button,
  Collapse,
  Field,
  FieldSet,
  Icon,
  Input,
  LinkButton,
  MultiSelect,
  RadioButtonGroup,
  SecretInput,
  Select,
  Spinner,
  Stack,
  Text,
  TextArea,
} from '@grafana/ui';

import {
  datasourceStatus, describeError, forget, health, isExpiredKey, listDatasources, listTables,
  onboard, startTrial, testConnection,
} from '../../api';
import {
  BRYGE_API_KEYS_URL, BRYGE_EARLY_ACCESS_URL, DEFAULT_BRYGE_URL, PREFILLED_API_KEY,
} from '../../defaults';
import {
  brygeKindOf,
  connectionFor,
  DATASOURCE_TYPE,
  DashboardSummary,
  deleteDatasource,
  getDashboard,
  GrafanaDatasource,
  grafanaConnectionFor,
  grafanaKindOf,
  guessGrafanaUrl,
  isLocalUrl,
  issueServiceAccountToken,
  listDashboards,
  listGrafanaDatasources,
  saveDashboard,
  secretPromptFor,
  sourcesUsedBy,
  upsertBrygeDatasource,
  withChatPanel,
  withoutChatPanel,
} from '../../grafana';
import { AskAppSettings, ensureInstallId, loadState, saveSettings } from '../../settings';
import { Step, StepState } from './Step';

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AskAppSettings>> {}

type Route = 'grafana' | 'password';

/** Trial or paste-your-own-key, in step 1. */
type Access = 'trial' | 'key';

/**
 * Where a trial email waits out the page reload.
 *
 * Starting a trial needs the Bryge data source to exist first (the trial call goes
 * through its proxy), and Grafana will not route to a data source created seconds ago
 * until the page reloads. So the email is parked here, the data source is created, the
 * page reloads, and setup picks the trial back up on its own. localStorage rather than
 * the plugin's settings because it is one admin's half-finished action, not state this
 * Grafana should carry.
 */
const PENDING_TRIAL = 'bryge.pendingTrialEmail';

/** "21h 04m" from now until `iso`, or undefined once it has passed. */
function timeLeft(iso?: string | null): string | undefined {
  if (!iso) {
    return undefined;
  }
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) {
    return undefined;
  }
  const mins = Math.floor(ms / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/** What a completed setup produced, kept so the last step can report it. */
interface Installed {
  uid: string;
  title: string;
  tables: number;
  links: number;
}

/**
 * Setup, as six questions asked one at a time.
 *
 * The order is the order the answers become knowable. Which Bryge account is this?
 * Which dashboard? Which database does that dashboard already read, and can Bryge reach
 * it? What is the data for? Which tables may it see? Then it runs.
 *
 * Two things changed the shape of this page:
 *
 *  - **No password.** Grafana stores the database credentials encrypted and will not
 *    return them, which used to leave one field the user had to fill by hand for a
 *    database Grafana was querying on the dashboard they had just picked. Setup now mints
 *    a Grafana service-account token and Bryge sends its SQL through Grafana, so the
 *    credential never moves. Engines Grafana cannot run SQL for still ask for a secret.
 *
 *  - **Analysis takes minutes, and says so.** Reading a large schema and working out how
 *    its tables relate is a five-to-ten minute job. The old page showed a spinner for all
 *    of it, which reads as a hung tab. The last step names the phase, counts the elapsed
 *    time, and says up front how long this takes.
 */
const AppConfig = ({ plugin }: AppConfigProps) => {
  const [settings, setSettings] = useState<AskAppSettings>(plugin.meta.jsonData ?? {});
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string>();

  // ---- step 1: the Bryge account
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState<string>();
  const [url, setUrl] = useState(DEFAULT_BRYGE_URL);
  const [apiKey, setApiKey] = useState(PREFILLED_API_KEY ?? '');
  const [connecting, setConnecting] = useState(false);
  const [showApiAdvanced, setShowApiAdvanced] = useState(false);
  // The trial: how this Grafana gets a key without anyone having a Bryge account yet.
  const [access, setAccess] = useState<Access>(PREFILLED_API_KEY ? 'key' : 'trial');
  const [email, setEmail] = useState('');
  const [starting, setStarting] = useState(false);
  const [trial, setTrial] = useState(false);
  const [keyExpiresAt, setKeyExpiresAt] = useState<string | null>();
  const [expired, setExpired] = useState(false);
  // Set when the user asks to swap the key on an already-working install, which is the
  // only reason to reopen step 1 while Bryge is answering.
  const [replacing, setReplacing] = useState(false);

  // ---- step 2: the dashboard
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [chosen, setChosen] = useState<string>();
  const [source, setSource] = useState<{ ds: GrafanaDatasource; tables: string[] } | null>(null);
  const [alreadyAnalyzed, setAlreadyAnalyzed] = useState<string>();

  // ---- step 3: reaching the database
  const [route, setRoute] = useState<Route>('grafana');
  const [grafanaUrl, setGrafanaUrl] = useState(guessGrafanaUrl());
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [reachable, setReachable] = useState(false);

  // ---- step 4: what the data is for
  const [description, setDescription] = useState('');
  const [industry, setIndustry] = useState('');
  const [useCases, setUseCases] = useState('');
  const [described, setDescribed] = useState(false);

  // ---- step 5: which tables
  const [tables, setTables] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [scopeChosen, setScopeChosen] = useState(false);

  // ---- step 6: the run
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>();
  const [elapsed, setElapsed] = useState(0);
  const [installed, setInstalled] = useState<Installed>();

  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState<string>();

  const startedAt = useRef<number>(0);

  /** Connected means Bryge answers, not that a setting was saved once. */
  const probe = useCallback(async () => {
    try {
      const h = await health();
      setConnected(Boolean(h?.ok));
      setAccount(h?.user);
      setTrial(Boolean(h?.trial));
      setKeyExpiresAt(h?.key_expires_at ?? null);
      setExpired(false);
      return Boolean(h?.ok);
    } catch (e) {
      setConnected(false);
      setAccount(undefined);
      // An expired key is a different situation from a wrong one and gets a different
      // page: nothing is misconfigured, the 24 hours are simply up.
      if (isExpiredKey(e)) {
        setExpired(true);
        setTrial(true);
        setAccess('key');
      }
      return false;
    }
  }, []);

  /**
   * Ask Bryge for a trial key and put it on the data source.
   *
   * Split out from `beginTrial` because it also runs on its own after the reload that
   * creating the data source needs — see PENDING_TRIAL.
   */
  const finishTrial = useCallback(async (addr: string, apiUrl: string) => {
    setStarting(true);
    setError(undefined);
    try {
      const grant = await startTrial({
        email: addr,
        install_id: await ensureInstallId(),
        grafana_url: window.location.origin,
      });
      // Straight onto the data source, where Grafana encrypts it and attaches it
      // server-side. The key is in this browser for the length of this function and is
      // never written anywhere it could be read back.
      await upsertBrygeDatasource(apiUrl.trim(), grant.key);
      window.localStorage.removeItem(PENDING_TRIAL);
      await probe();
    } catch (e) {
      setError(describeError(e));
      // Dropped either way: a failed attempt must not silently re-fire on every reload.
      window.localStorage.removeItem(PENDING_TRIAL);
    } finally {
      setStarting(false);
    }
  }, [probe]);

  useEffect(() => {
    (async () => {
      try {
        const s = await loadState(true);
        const ds = (await listGrafanaDatasources()).find((d) => d.type === DATASOURCE_TYPE);
        setSettings(ds ? { ...s.jsonData, datasourceUid: ds.uid } : { ...s.jsonData, datasourceUid: undefined });
        const apiUrl = (ds?.jsonData?.url as string) ?? DEFAULT_BRYGE_URL;
        setUrl(apiUrl);
        const pending = window.localStorage.getItem(PENDING_TRIAL);
        if (ds) {
          const live = await probe();
          // Half a trial: the data source was created, the page reloaded, and the key
          // was never fetched. Finish it rather than making the user type the address
          // again into a form that looks like it did nothing.
          if (!live && pending) {
            setEmail(pending);
            await finishTrial(pending, apiUrl);
          }
        } else if (pending) {
          // The data source went away between the two halves. Start over cleanly.
          window.localStorage.removeItem(PENDING_TRIAL);
          setEmail(pending);
        }
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBooting(false);
      }
    })();
    // Runs once on mount: this is the boot sequence, and re-running it on a changed
    // callback would re-enter the trial resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!connected) {
      return;
    }
    listDashboards()
      .then(setDashboards)
      .catch((e) => setError(describeError(e)));
  }, [connected]);

  // A ticking elapsed counter. The number is the point: it is the difference between
  // "this is taking a while" and "this has stopped".
  useEffect(() => {
    if (!running) {
      return;
    }
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  const connect = async () => {
    setError(undefined);
    setConnecting(true);
    try {
      const uid = await upsertBrygeDatasource(url.trim(), apiKey.trim());
      await saveSettings({ ...settings, datasourceUid: uid });
      // Grafana caches the data source registry in the running frontend, so the proxy
      // route for one created seconds ago is not reachable until a reload.
      window.location.reload();
    } catch (e) {
      setError(describeError(e));
      setConnecting(false);
    }
  };

  /**
   * Start the 24-hour trial.
   *
   * Two shapes, because of what Grafana requires. If the Bryge data source already
   * exists, the trial call can go straight through its proxy and the key lands without
   * anything else happening. If it does not, the data source has to be created first
   * (empty key, which is fine: the trial route is the one Bryge route that needs no
   * credential) and the page reloaded before its proxy route resolves — so the email is
   * parked and the boot sequence above finishes the job.
   */
  const beginTrial = async () => {
    const addr = email.trim();
    if (!addr) {
      return;
    }
    setError(undefined);
    if (settings.datasourceUid) {
      await finishTrial(addr, url);
      return;
    }
    setStarting(true);
    try {
      window.localStorage.setItem(PENDING_TRIAL, addr);
      const uid = await upsertBrygeDatasource(url.trim(), '');
      await saveSettings({ ...settings, datasourceUid: uid });
      window.location.reload();
    } catch (e) {
      window.localStorage.removeItem(PENDING_TRIAL);
      setError(describeError(e));
      setStarting(false);
    }
  };

  const inspect = useCallback(async (uid: string) => {
    setSource(null);
    setReachable(false);
    setToken(undefined);
    setTables([]);
    setPicked([]);
    setScopeChosen(false);
    setDescribed(false);
    setError(undefined);
    try {
      const { dashboard } = await getDashboard(uid);
      const used = sourcesUsedBy(dashboard);
      const all = await listGrafanaDatasources();
      for (const u of used) {
        const ds = all.find((d) => d.uid === u.uid);
        if (ds && brygeKindOf(ds.type)) {
          setSource({ ds, tables: u.tables });
          setRoute(grafanaKindOf(ds.type) ? 'grafana' : 'password');
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

  // Driven from the picker rather than an effect on `chosen`: inspecting is something the
  // user did, not something the state happens to imply, and running it from an effect
  // makes React re-render the whole page once before the work even starts.
  const pickDashboard = (uid?: string) => {
    setChosen(uid);
    if (uid) {
      inspect(uid);
    }
  };

  /** The connection Bryge will be given, in whichever way this database is reachable. */
  const buildConnection = async (): Promise<{ kind: string; connection: Record<string, unknown> }> => {
    if (!source) {
      throw new Error('No database selected.');
    }
    if (route === 'grafana') {
      let t = token;
      if (!t) {
        try {
          t = await issueServiceAccountToken();
        } catch (e) {
          // Creating a service account needs a Grafana admin. Say which door is shut and
          // which one is still open, rather than surfacing a bare 403 from Grafana.
          throw new Error(
            'Grafana would not let this account create a service account, which is what ' +
              'lets Bryge connect without a password. Ask a Grafana admin to run this setup, ' +
              'or switch to "Direct, with a password" above. ' +
              describeError(e)
          );
        }
      }
      setToken(t);
      return grafanaConnectionFor(source.ds, t, grafanaUrl) as never;
    }
    return connectionFor(source.ds, password) as never;
  };

  /**
   * Prove the connection AND fetch the table list in one press.
   *
   * Listing tables IS the connection test — it is the first thing the analysis does, and
   * a connection that tests green then fails to read a catalog is the failure worth
   * catching here rather than ten minutes into a background job.
   */
  const checkAndLoadTables = async () => {
    setError(undefined);
    setChecking(true);
    setLoadingTables(true);
    try {
      const { kind, connection } = await buildConnection();
      const t = await testConnection(kind, connection);
      if (!t?.ok) {
        throw new Error(t?.error || 'Bryge could not reach this database.');
      }
      setReachable(true);
      const res = await listTables(kind, connection);
      const all = res.tables ?? [];
      setTables(all);
      // Pre-tick what the dashboard already charts. Its panel SQL often names tables
      // unqualified, so match on the trailing segment rather than the whole id.
      const wanted = new Set(source!.tables.map((x) => x.toLowerCase()));
      const pre = all.filter(
        (id) => wanted.has(id.toLowerCase()) || wanted.has(id.split('.').pop()!.toLowerCase())
      );
      setPicked(pre.length ? pre : all);
    } catch (e) {
      setReachable(false);
      // A token that was minted and then failed is dead weight; drop it so the next
      // attempt issues a fresh one rather than retrying with a known-bad value.
      setToken(undefined);
      setError(describeError(e));
    } finally {
      setChecking(false);
      setLoadingTables(false);
    }
  };

  const run = async () => {
    if (!chosen || !source) {
      return;
    }
    setError(undefined);
    setInstalled(undefined);
    setRunning(true);
    startedAt.current = Date.now();
    setElapsed(0);
    setPhase('Handing the database to Bryge…');
    const meta = dashboards.find((d) => d.uid === chosen);
    try {
      const { kind, connection } = await buildConnection();
      const res = await onboard({
        name: source.ds.name,
        kind,
        connection,
        allowed_tables: picked.length && picked.length !== tables.length ? picked : undefined,
        description:
          description.trim() || `Connected from the Grafana dashboard "${meta?.title ?? chosen}".`,
        industry: industry.trim() || undefined,
        use_cases: useCases.trim() || undefined,
      });

      let run: { tables?: number; links?: number } = {};
      // 20 minutes at 3s. A schema big enough to need longer than that has hit something
      // worth investigating, and a poll loop with no end is how a page hangs forever.
      for (let i = 0; i < 400; i++) {
        const status = await datasourceStatus(res.id);
        run = status.run ?? {};
        if (status.status === 'analyzed') {
          break;
        }
        if (status.status === 'error') {
          throw new Error(status.last_error ?? 'Schema analysis failed.');
        }
        setPhase(status.run?.phase_detail ?? 'Reading the schema…');
        await new Promise((r) => setTimeout(r, 3000));
      }

      setPhase('Adding the chat panel to the dashboard…');
      const { dashboard, meta: dm } = await getDashboard(chosen);
      await saveDashboard(withChatPanel(dashboard, res.id), dm?.folderUid, 'Added the Bryge chat panel');

      const next: AskAppSettings = {
        ...settings,
        brygeDatasourceId: settings.brygeDatasourceId ?? res.id,
        dashboards: {
          ...(settings.dashboards ?? {}),
          [chosen]: {
            brygeDatasourceId: res.id,
            brygeDatasourceName: res.name,
            dashboardTitle: meta?.title,
            installedAt: new Date().toISOString(),
          },
        },
      };
      await saveSettings(next);
      setSettings(next);
      setInstalled({
        uid: chosen,
        title: meta?.title ?? chosen,
        tables: run.tables ?? 0,
        links: run.links ?? 0,
      });
      setPassword('');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRunning(false);
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

  const tableOptions: Array<SelectableValue<string>> = useMemo(
    () => tables.map((t) => ({ value: t, label: t })),
    [tables]
  );

  // Which step is open. Derived rather than stored, so a "Change" button only has to
  // clear the answer it owns and the sequence re-opens at the right place.
  const current =
    replacing || !connected ? 1 : !chosen || !source ? 2 : !reachable ? 3 : !described ? 4 : !scopeChosen ? 5 : 6;
  const stateOf = (n: number): StepState => (current === n ? 'active' : current > n ? 'done' : 'todo');

  const canUseGrafanaRoute = Boolean(source && grafanaKindOf(source.ds.type));
  const secret = source ? secretPromptFor(brygeKindOf(source.ds.type)!) : undefined;
  const mmss = `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, '0')}s`;
  const left = timeLeft(keyExpiresAt);
  // Under six hours is when telling somebody matters: enough time to get an account
  // before the dashboard stops answering, not so early that it is noise.
  const endingSoon = trial && connected && (!left || Number(left.split('h')[0]) < 6);

  if (booting) {
    return (
      <Stack direction="row" gap={1} alignItems="center">
        <Spinner />
        <Text color="secondary">Loading…</Text>
      </Stack>
    );
  }

  return (
    <Stack direction="column" gap={2}>
      {endingSoon && (
        <Alert title="This Grafana's Bryge trial is nearly over" severity="warning">
          <Stack direction="column" gap={1}>
            <span>
              {left ? `About ${left} left on the trial key.` : 'The trial key expires shortly.'} Get a
              Bryge account, create an API key on it, and paste it into step 1. Nothing else has to
              be redone: the dashboards, the analyzed database and the chat panel all stay as they
              are.
            </span>
            <Stack direction="row" gap={1}>
              <LinkButton
                variant="secondary"
                size="sm"
                icon="external-link-alt"
                href={BRYGE_EARLY_ACCESS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get a Bryge account
              </LinkButton>
              <Button size="sm" onClick={() => { setReplacing(true); setAccess('key'); }}>
                Paste a new key
              </Button>
            </Stack>
          </Stack>
        </Alert>
      )}

      <Step
        n={1}
        title="Connect your Bryge account"
        state={stateOf(1)}
        summary={
          <Stack direction="row" gap={1} alignItems="center">
            <span>
              {account ? `Connected as ${account}.` : 'Connected.'}
              {trial && left ? ` Trial ends in ${left}.` : ''}
            </span>
            <Button size="sm" fill="text" onClick={() => { setReplacing(true); setAccess('key'); }}>
              Replace the key
            </Button>
          </Stack>
        }
      >
        <Stack direction="column" gap={2}>
          {expired && (
            <Alert title="This Grafana's Bryge trial has ended" severity="warning">
              The 24 hours are up and the trial key has stopped working. Everything you set up
              is still here. Get a Bryge account, create an API key on it, and paste it below to
              carry on with the same dashboards.
            </Alert>
          )}

          {!expired && !replacing && (
            <RadioButtonGroup<Access>
              value={access}
              onChange={setAccess}
              options={[
                { value: 'trial', label: 'Start a 24-hour trial' },
                { value: 'key', label: 'I have a Bryge API key' },
              ]}
            />
          )}

          {access === 'trial' && !expired && !replacing ? (
            <>
              <Text variant="bodySmall" color="secondary">
                No account needed to try this. Bryge issues this Grafana a key that works for 24
                hours, and the rest of setup runs exactly as it will afterwards. The key is stored
                encrypted by Grafana and attached server-side, so it never reaches a browser. When
                the 24 hours are up, replace it with a key from your own Bryge account and
                everything you set up keeps working.
              </Text>
              <Field
                label="Your work email"
                description="So the Bryge team knows who is trying it and can get you an account."
              >
                <Input
                  type="email"
                  value={email}
                  width={52}
                  placeholder="you@company.com"
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />
              </Field>
              <Stack direction="row" gap={1} alignItems="center">
                <Button onClick={beginTrial} disabled={!email.trim() || !url.trim() || starting}>
                  {starting ? 'Starting your trial…' : 'Start the trial'}
                </Button>
                {starting && <Spinner />}
              </Stack>
            </>
          ) : (
            <>
              <Text variant="bodySmall" color="secondary">
                Bryge needs an API key so it knows whose databases and analyses this Grafana is
                using. Create one in your Bryge account, then paste it below. The key is stored
                encrypted by Grafana and attached server-side, so it never reaches a browser.
              </Text>
              <Stack direction="row" gap={1}>
                <LinkButton
                  variant="secondary"
                  icon="external-link-alt"
                  href={BRYGE_API_KEYS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Create an API key on bryge.io
                </LinkButton>
                <LinkButton
                  variant="secondary"
                  fill="text"
                  href={BRYGE_EARLY_ACCESS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  No account yet? Request access
                </LinkButton>
              </Stack>
              <Field label="API key">
                <SecretInput
                  isConfigured={false}
                  value={apiKey}
                  placeholder="bk_…"
                  width={52}
                  onReset={() => setApiKey('')}
                  onChange={(e) => setApiKey(e.currentTarget.value)}
                />
              </Field>
            </>
          )}

          <Collapse
            label="Self-hosted Bryge"
            isOpen={showApiAdvanced}
            onToggle={() => setShowApiAdvanced(!showApiAdvanced)}
            collapsible
          >
            <Field label="Bryge API URL" description="Must be reachable from this Grafana server.">
              <Input value={url} width={52} onChange={(e) => setUrl(e.currentTarget.value)} />
            </Field>
          </Collapse>

          {(access === 'key' || expired || replacing) && (
            <Stack direction="row" gap={1} alignItems="center">
              <Button onClick={connect} disabled={!apiKey.trim() || !url.trim() || connecting}>
                {connecting ? 'Checking the key…' : 'Connect'}
              </Button>
              {connecting && <Spinner />}
              {replacing && (
                <Button variant="secondary" fill="text" onClick={() => setReplacing(false)}>
                  Cancel
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Step>

      <Step
        n={2}
        title="Pick a dashboard"
        state={stateOf(2)}
        summary={
          <Stack direction="row" gap={1} alignItems="center">
            <span>
              {dashboards.find((d) => d.uid === chosen)?.title ?? chosen} · reads {source?.ds.name}
            </span>
            <Button size="sm" fill="text" onClick={() => pickDashboard(undefined)}>
              Change
            </Button>
          </Stack>
        }
      >
        <Stack direction="column" gap={1}>
          <Field label="Dashboard" description="Bryge reads which database this dashboard already charts.">
            <Select
              options={dashboardOptions}
              value={chosen}
              placeholder={dashboards.length ? 'Select a dashboard' : 'Loading dashboards…'}
              onChange={(v) => pickDashboard(v.value)}
              width={52}
            />
          </Field>
          {source && (
            <Alert title={`Found ${source.ds.name}`} severity="info">
              {brygeKindOf(source.ds.type)} ·{' '}
              {(source.ds.jsonData?.host as string) ?? source.ds.url} ·{' '}
              {(source.ds.jsonData?.defaultBucket as string) ??
                (source.ds.jsonData?.defaultDatabase as string) ??
                (source.ds.jsonData?.database as string) ??
                source.ds.database}
            </Alert>
          )}
          {alreadyAnalyzed && (
            <Alert title="Bryge already knows this database" severity="success">
              It was analyzed earlier as &quot;{alreadyAnalyzed}&quot;. Connecting again reuses that
              analysis — the schema is not read a second time and no duplicate is created.
            </Alert>
          )}
        </Stack>
      </Step>

      <Step
        n={3}
        title="Let Bryge reach the database"
        state={stateOf(3)}
        summary={
          <Stack direction="row" gap={1} alignItems="center">
            <span>
              {route === 'grafana'
                ? `Through this Grafana — no password stored. ${tables.length} tables readable.`
                : `Direct connection. ${tables.length} tables readable.`}
            </span>
            <Button size="sm" fill="text" onClick={() => setReachable(false)}>
              Change
            </Button>
          </Stack>
        }
      >
        <Stack direction="column" gap={2}>
          {canUseGrafanaRoute ? (
            <>
              <RadioButtonGroup<Route>
                value={route}
                onChange={(v) => {
                  setRoute(v);
                  setReachable(false);
                }}
                options={[
                  { value: 'grafana', label: 'Through Grafana (no password)' },
                  { value: 'password', label: 'Direct, with a password' },
                ]}
              />
              {route === 'grafana' && (
                <>
                  <Text variant="bodySmall" color="secondary">
                    Grafana already holds this database&apos;s credentials and will not give them
                    back, so Bryge asks Grafana to run the query instead of connecting itself.
                    Setup creates a Grafana service account called <strong>bryge-ask</strong> with
                    the Viewer role and uses its token. Nothing about your database is typed here,
                    and revoking that service account cuts Bryge off completely.
                  </Text>
                  <Field
                    label="Grafana address Bryge should call"
                    description="Bryge's servers connect to this, so it has to be reachable from outside this browser."
                    invalid={isLocalUrl(grafanaUrl)}
                    error={
                      isLocalUrl(grafanaUrl)
                        ? 'This address only works on your own machine. Enter the address Bryge can reach.'
                        : undefined
                    }
                  >
                    <Input
                      value={grafanaUrl}
                      width={52}
                      onChange={(e) => {
                        setGrafanaUrl(e.currentTarget.value);
                        setReachable(false);
                      }}
                    />
                  </Field>
                </>
              )}
            </>
          ) : (
            <Text variant="bodySmall" color="secondary">
              Grafana cannot run queries for this engine on Bryge&apos;s behalf, so this one needs
              its own credential.
            </Text>
          )}

          {route === 'password' && secret && (
            <Field label={secret.label} description={secret.hint}>
              <Input
                type="password"
                value={password}
                width={52}
                placeholder={secret.label}
                onChange={(e) => {
                  setPassword(e.currentTarget.value);
                  setReachable(false);
                }}
              />
            </Field>
          )}

          <Stack direction="row" gap={1} alignItems="center">
            <Button
              onClick={checkAndLoadTables}
              disabled={checking || (route === 'password' && !password)}
            >
              {checking ? 'Checking…' : 'Check the connection'}
            </Button>
            {checking && <Spinner />}
          </Stack>
        </Stack>
      </Step>

      <Step
        n={4}
        title="Tell Bryge what this data is"
        state={stateOf(4)}
        summary={
          <Stack direction="row" gap={1} alignItems="center">
            <span>{description.trim() ? description.trim().slice(0, 90) : 'Skipped.'}</span>
            <Button size="sm" fill="text" onClick={() => setDescribed(false)}>
              Change
            </Button>
          </Stack>
        }
      >
        <Stack direction="column" gap={1}>
          <Text variant="bodySmall" color="secondary">
            These answers are not decoration. Bryge injects them while it writes table
            summaries and works out how tables relate, so a database described as a
            plant&apos;s energy metering produces different links than the same schema
            described as a billing system.
          </Text>
          <Field label="What does this operation do?" description="Plain language.">
            <TextArea
              rows={2}
              value={description}
              width={52}
              placeholder="e.g. a manufacturing plant's electricity metering, solar generation and local weather"
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
          </Field>
          <Field label="Industry" description="One or two words.">
            <Input
              value={industry}
              width={52}
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
              width={52}
              placeholder="e.g. spot consumption spikes, compare generation against irradiance, explain cost changes"
              onChange={(e) => setUseCases(e.currentTarget.value)}
            />
          </Field>
          <Stack direction="row" gap={1}>
            <Button onClick={() => setDescribed(true)}>Continue</Button>
            <Button variant="secondary" fill="text" onClick={() => setDescribed(true)}>
              Skip
            </Button>
          </Stack>
        </Stack>
      </Step>

      <Step
        n={5}
        title="Choose which tables Bryge may read"
        state={stateOf(5)}
        summary={
          <Stack direction="row" gap={1} alignItems="center">
            <span>
              {picked.length === tables.length
                ? `All ${tables.length} tables.`
                : `${picked.length} of ${tables.length} tables.`}
            </span>
            <Button size="sm" fill="text" onClick={() => setScopeChosen(false)}>
              Change
            </Button>
          </Stack>
        }
      >
        <Stack direction="column" gap={1}>
          <Text variant="bodySmall" color="secondary">
            {tables.length} tables are readable with this connection. The ones your dashboard
            already charts are ticked. Everything downstream is scoped to this list, so leaving
            out the tables nobody asks about makes the analysis faster and the answers sharper.
          </Text>
          <Field label="Tables">
            <MultiSelect
              options={tableOptions}
              value={picked}
              onChange={(v) => setPicked(v.map((o) => o.value!).filter(Boolean))}
              placeholder={loadingTables ? 'Reading the catalog…' : 'Select tables'}
              width={70}
              isClearable
              closeMenuOnSelect={false}
            />
          </Field>
          <Stack direction="row" gap={1}>
            <Button onClick={() => setScopeChosen(true)} disabled={!picked.length}>
              Continue
            </Button>
            <Button variant="secondary" fill="text" onClick={() => setPicked(tables)}>
              Select all
            </Button>
          </Stack>
        </Stack>
      </Step>

      <Step n={6} title="Let Bryge read the schema" state={stateOf(6)} last>
        <Stack direction="column" gap={2}>
          {!installed && !running && (
            <Alert title="This takes a while, and that is normal" severity="info">
              Bryge reads every table you selected, samples it, writes a summary for each one and
              then works out how they relate. On {picked.length} tables expect a few minutes; a
              large schema can take five to ten. You can leave this page open — progress is
              reported below, and the analysis keeps running on Bryge either way.
            </Alert>
          )}

          {running && (
            <Alert title="Working…" severity="info">
              <Stack direction="column" gap={1}>
                <Stack direction="row" gap={1} alignItems="center">
                  <Spinner />
                  <span>{phase ?? 'Working…'}</span>
                </Stack>
                <Text variant="bodySmall" color="secondary">
                  {mmss} elapsed. Five to ten minutes is normal for a large schema. Nothing is
                  stuck — the slow part is reading each table and inferring the links between them.
                </Text>
              </Stack>
            </Alert>
          )}

          {installed && (
            <Alert title={`${installed.title} is ready`} severity="success">
              <Stack direction="column" gap={1}>
                <span>
                  Bryge found {installed.tables} tables and {installed.links} relationships in {mmss}.
                  The chat panel is at the bottom of the dashboard, and every panel&apos;s menu now
                  has &quot;Ask Bryge about this panel&quot;.
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

          {!installed && (
            <Button onClick={run} disabled={running}>
              {running ? 'Setting up…' : 'Add Bryge to this dashboard'}
            </Button>
          )}
        </Stack>
      </Step>

      {error && (
        <Alert title="Setup failed" severity="error" onRemove={() => setError(undefined)}>
          {error}
        </Alert>
      )}

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
                Run this before uninstalling. It takes the chat panel off every dashboard and
                deletes the connection; your data and its analysis are left untouched.
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
    </Stack>
  );
};

export default AppConfig;
