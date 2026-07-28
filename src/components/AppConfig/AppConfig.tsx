import React, { useEffect, useState } from 'react';
import { AppPluginMeta, PluginConfigPageProps, SelectableValue } from '@grafana/data';
import { DataSourcePicker } from '@grafana/runtime';
import { Alert, Button, Field, FieldSet, Select } from '@grafana/ui';

import { BrygeDatasourceInfo, describeError, listDatasources } from '../../api';
import { AskAppSettings, saveSettings } from '../../settings';

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AskAppSettings>> {}

/**
 * Two settings, both pickers, no typing.
 *
 * The Bryge data source already holds the API URL and the key, so this page never
 * touches a credential — it just records which data source to borrow and which of the
 * connected databases to answer from.
 */
const AppConfig = ({ plugin }: AppConfigProps) => {
  const stored = plugin.meta.jsonData ?? {};
  const [datasourceUid, setDatasourceUid] = useState(stored.datasourceUid ?? '');
  const [brygeDatasourceId, setBrygeDatasourceId] = useState(stored.brygeDatasourceId ?? '');
  const [databases, setDatabases] = useState<BrygeDatasourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!datasourceUid) {
      setDatabases([]);
      return;
    }
    let live = true;
    setLoading(true);
    setError(undefined);
    listDatasources(datasourceUid)
      .then((res) => live && setDatabases(res.datasources ?? []))
      .catch((e) => live && setError(describeError(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [datasourceUid]);

  const options: Array<SelectableValue<string>> = databases.map((d) => ({
    value: d.id,
    label: d.name,
    description: `${d.kind} · ${d.database} · ${d.status}`,
  }));

  const save = async () => {
    setError(undefined);
    try {
      await saveSettings({ datasourceUid, brygeDatasourceId });
      setSaved(true);
      // Grafana caches plugin settings in the running frontend; a reload is the honest
      // way to make the panel menu pick up the change immediately.
      window.setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <FieldSet label="Ask Bryge">
      <Field
        label="Bryge data source"
        description="Carries the Bryge API URL and API key. Create it under Connections → Data sources."
      >
        <DataSourcePicker
          current={datasourceUid}
          filter={(ds) => ds.type === 'bryge-assistant-datasource'}
          noDefault
          onChange={(ds) => {
            setDatasourceUid(ds.uid);
            setBrygeDatasourceId('');
          }}
        />
      </Field>

      <Field label="Database" description="Which connected database panel questions are answered from.">
        <Select
          options={options}
          value={brygeDatasourceId}
          isLoading={loading}
          placeholder={datasourceUid ? 'Select a connected database' : 'Pick the Bryge data source first'}
          onChange={(v) => setBrygeDatasourceId(v.value!)}
          width={50}
        />
      </Field>

      {error && (
        <Alert title="Bryge" severity="error">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert title="Saved" severity="success">
          &quot;Ask Bryge&quot; is now in every panel&apos;s menu. Reloading…
        </Alert>
      )}

      <Button onClick={save} disabled={!datasourceUid || !brygeDatasourceId}>
        Save
      </Button>
    </FieldSet>
  );
};

export default AppConfig;
