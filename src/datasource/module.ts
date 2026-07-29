/**
 * The Bryge API connection.
 *
 * This exists for one reason: a frontend-only plugin cannot hold a secret, and the ONLY
 * thing in Grafana that can — encrypting it and attaching it to outbound requests
 * server-side — is a data source with proxy `routes`. The app-level proxy
 * (`/api/plugin-proxy/…`) would have avoided this extra piece, but Grafana 13 no longer
 * registers those routes for an app without a backend: every request returns
 * "plugin route match not found".
 *
 * So this data source is a credential holder, not something you query. The Ask Bryge app
 * creates it during setup; nobody should ever need to add one by hand, which is why it
 * has no query editor worth speaking of.
 */
import { DataSourcePlugin } from '@grafana/data';

import { ConfigEditor } from './ConfigEditor';
import { BrygeApiDataSource } from './datasource';
import { QueryEditor } from './QueryEditor';

export const plugin = new DataSourcePlugin(BrygeApiDataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);
