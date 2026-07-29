import React from 'react';
import { QueryEditorProps } from '@grafana/data';
import { Alert } from '@grafana/ui';

import { BrygeApiDataSource, BrygeApiOptions, BrygeApiQuery } from './datasource';

type Props = QueryEditorProps<BrygeApiDataSource, BrygeApiQuery, BrygeApiOptions>;

/** Nothing to edit. This data source is a credential holder for the Ask Bryge app; you
 *  ask questions from the chat panel or from a panel's menu, not from here. */
export function QueryEditor(_: Props) {
  return (
    <Alert title="This data source is not queried directly" severity="info">
      It holds the Bryge API URL and key for the Ask Bryge app. Ask questions from the Bryge chat
      panel, or from any panel&apos;s menu with &quot;Ask Bryge about this panel&quot;.
    </Alert>
  );
}
