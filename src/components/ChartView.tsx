import React, { useMemo } from 'react';
import { createDataFrame, DataFrame, FieldType, LoadingState, TimeRange } from '@grafana/data';
import { PanelRenderer } from '@grafana/runtime';

import { BrygeFrame } from '../api';

const FIELD_TYPES: Record<string, FieldType> = {
  time: FieldType.time,
  number: FieldType.number,
  string: FieldType.string,
  boolean: FieldType.boolean,
};

interface Props {
  frame: BrygeFrame;
  timeRange: TimeRange;
  width: number;
  height: number;
}

/** Draws Bryge's rows with Grafana's own timeseries/table panel, so the result looks
 *  like the rest of the dashboard rather than a bespoke chart. */
export function ChartView({ frame, timeRange, width, height }: Props) {
  const data: DataFrame = useMemo(
    () =>
      createDataFrame({
        fields: (frame.fields ?? []).map((f) => ({
          name: f.name,
          type: FIELD_TYPES[f.type] ?? FieldType.other,
          values: f.values,
        })),
      }),
    [frame]
  );

  const hasTime = (frame.fields ?? []).some((f) => f.type === 'time');
  const hasNumber = (frame.fields ?? []).some((f) => f.type === 'number');
  const pluginId = hasTime && hasNumber ? 'timeseries' : 'table';

  return (
    <PanelRenderer
      pluginId={pluginId}
      title=""
      width={width}
      height={height}
      data={{ series: [data], state: LoadingState.Done, timeRange }}
      options={
        pluginId === 'timeseries'
          ? { legend: { displayMode: 'list', placement: 'bottom', showLegend: true }, tooltip: { mode: 'single' } }
          : {}
      }
      fieldConfig={{ defaults: { custom: { lineWidth: 1, fillOpacity: 8, showPoints: 'never' } }, overrides: [] }}
    />
  );
}
