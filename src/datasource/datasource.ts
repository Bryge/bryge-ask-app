import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  DataSourceJsonData,
  TestDataSourceResponse,
} from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { DataQuery } from '@grafana/schema';
import { lastValueFrom } from 'rxjs';

export interface BrygeApiOptions extends DataSourceJsonData {
  url?: string;
}

export interface BrygeApiQuery extends DataQuery {}

/**
 * Not a queryable data source. Panels never target this — the chat panel and the panel
 * menu call Bryge through its proxy route and render the frames themselves. All this
 * class does is prove the connection works when someone presses Save & test.
 */
export class BrygeApiDataSource extends DataSourceApi<BrygeApiQuery, BrygeApiOptions> {
  private readonly proxy: string;

  constructor(instanceSettings: DataSourceInstanceSettings<BrygeApiOptions>) {
    super(instanceSettings);
    this.proxy = `/api/datasources/proxy/uid/${instanceSettings.uid}/bryge`;
  }

  async query(_: DataQueryRequest<BrygeApiQuery>): Promise<DataQueryResponse> {
    return { data: [] };
  }

  async testDatasource(): Promise<TestDataSourceResponse> {
    try {
      const res = await lastValueFrom(
        getBackendSrv().fetch<{ ok: boolean; user: string; datasource_count: number; analyzed_count: number }>({
          url: `${this.proxy}/api/grafana/health`,
          method: 'GET',
        })
      );
      const h = res.data;
      if (!h?.ok) {
        return { status: 'error', message: 'Bryge rejected the API key.' };
      }
      return {
        status: 'success',
        message: `Connected as ${h.user} — ${h.analyzed_count} of ${h.datasource_count} database(s) analyzed.`,
      };
    } catch (err: unknown) {
      const e = err as { status?: number; data?: { detail?: string }; message?: string };
      if (e?.status === 401) {
        return { status: 'error', message: 'Bryge rejected the API key (401).' };
      }
      if (e?.status === 502 || e?.status === 504) {
        return {
          status: 'error',
          message: 'Grafana could not reach the Bryge API. Check the URL is reachable from the Grafana server.',
        };
      }
      return { status: 'error', message: e?.data?.detail ?? e?.message ?? 'Could not reach Bryge.' };
    }
  }
}
