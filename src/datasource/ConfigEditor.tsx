import React, { ChangeEvent } from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { InlineField, Input, SecretInput } from '@grafana/ui';

import { BrygeApiOptions } from './datasource';

interface SecureData {
  apiKey?: string;
}

interface Props extends DataSourcePluginOptionsEditorProps<BrygeApiOptions, SecureData> {}

/** Normally filled in by the Ask Bryge app's setup page. Editable here too, for anyone
 *  who would rather change the URL or rotate the key directly. */
export function ConfigEditor({ onOptionsChange, options }: Props) {
  const { jsonData, secureJsonFields, secureJsonData } = options;

  const onUrlChange = (e: ChangeEvent<HTMLInputElement>) =>
    onOptionsChange({ ...options, jsonData: { ...jsonData, url: e.target.value.trim() } });

  return (
    <>
      <InlineField label="Bryge API URL" labelWidth={18} tooltip="Must be reachable from the Grafana server.">
        <Input value={jsonData.url ?? ''} placeholder="https://api.bryge.io" width={48} onChange={onUrlChange} />
      </InlineField>
      <InlineField label="API key" labelWidth={18} tooltip="A bk_… key from Bryge. Stored encrypted; never sent to the browser.">
        <SecretInput
          isConfigured={secureJsonFields?.apiKey}
          value={secureJsonData?.apiKey ?? ''}
          placeholder="bk_…"
          width={48}
          onReset={() =>
            onOptionsChange({
              ...options,
              secureJsonFields: { ...options.secureJsonFields, apiKey: false },
              secureJsonData: { ...options.secureJsonData, apiKey: '' },
            })
          }
          onChange={(e) => onOptionsChange({ ...options, secureJsonData: { apiKey: e.currentTarget.value.trim() } })}
        />
      </InlineField>
    </>
  );
}
