import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PanelProps } from '@grafana/data';
import { Alert, Button, Icon, Input, Spinner, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { ask, BrygeFrame, describeError, rerun } from '../../api';
import { BrygeChatOptions } from '../types';

/** One exchange in the panel's conversation. */
interface Turn {
  question: string;
  answer?: string;
  sql?: string | null;
  frame?: BrygeFrame | null;
  error?: string;
  pending?: boolean;
}
import { ChartView } from '../../components/ChartView';

type Props = PanelProps<BrygeChatOptions>;

export function BrygeChatPanel({ options, width, height, timeRange }: Props) {
  const s = useStyles2(styles);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const configured = Boolean(options.brygeDatasourceId);

  const windowOf = useCallback(
    () => ({
      from: timeRange.from.toISOString(),
      to: timeRange.to.toISOString(),
      max_data_points: Math.max(200, Math.round(width)),
    }),
    [timeRange, width]
  );

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || !configured || busy) {
      return;
    }
    setInput('');
    setBusy(true);
    setTurns((t) => [...t, { question: q, pending: true }]);
    try {
      const res = await ask(options.brygeDatasourceId, q, windowOf(), options.maxRows);
      setTurns((t) =>
        t.map((turn, i) =>
          i === t.length - 1
            ? { question: q, answer: res.answer, sql: res.sql, frame: res.frame ?? undefined }
            : turn
        )
      );
    } catch (e) {
      const message = describeError(e);
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { question: q, error: message } : turn)));
    } finally {
      setBusy(false);
    }
  };

  // The dashboard time picker moved. Re-run the last answer's query against the new
  // window — same SQL, no model call — so the chart follows the range like every other
  // panel instead of going stale the moment someone switches to 7 days.
  const rangeKey = `${timeRange.from.valueOf()}-${timeRange.to.valueOf()}`;
  const lastRange = useRef(rangeKey);
  useEffect(() => {
    if (lastRange.current === rangeKey) {
      return;
    }
    lastRange.current = rangeKey;
    const idx = turns.map((t) => Boolean(t.sql)).lastIndexOf(true);
    if (idx < 0 || !configured) {
      return;
    }
    let live = true;
    rerun(options.brygeDatasourceId, turns[idx].sql!, windowOf(), options.maxRows)
      .then((frame) => {
        if (live) {
          setTurns((t) => t.map((turn, i) => (i === idx ? { ...turn, frame } : turn)));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [rangeKey, turns, configured, options, windowOf]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  if (!configured) {
    return (
      <div className={s.wrap}>
        <Alert title="Bryge chat is not configured yet" severity="info">
          Run setup from Administration &rarr; Plugins &rarr; Ask Bryge: pick this dashboard, and the
          panel is wired up for you.
        </Alert>
      </div>
    );
  }

  const chartHeight = Math.max(140, Math.min(260, height - 200));

  return (
    <div className={s.wrap} style={{ height }}>
      <div className={s.scroll} ref={scroller}>
        {!turns.length && (
          <div className={s.empty}>
            <Icon name="comment-alt-message" size="xl" />
            <p>Ask anything about this data. Bryge writes the query itself.</p>
            {options.starterQuestion && (
              <Button variant="secondary" size="sm" onClick={() => send(options.starterQuestion)}>
                {options.starterQuestion}
              </Button>
            )}
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={s.turn}>
            <div className={s.question}>{turn.question}</div>

            {turn.pending && (
              <div className={s.pending}>
                <Spinner /> Bryge is reading your data…
              </div>
            )}

            {turn.error && (
              <Alert title="Could not answer" severity="error">
                {turn.error}
              </Alert>
            )}

            {turn.answer && <div className={s.answer}>{turn.answer}</div>}

            {options.showChart && turn.frame?.fields?.length ? (
              <div className={s.chart}>
                <ChartView
                  frame={turn.frame}
                  timeRange={timeRange}
                  width={width - 32}
                  height={chartHeight}
                />
              </div>
            ) : null}

            {turn.sql && (
              <details className={s.sql}>
                <summary>Query Bryge wrote{turn.frame ? ` · ${turn.frame.row_count} rows` : ''}</summary>
                <pre>{turn.sql}</pre>
              </details>
            )}
          </div>
        ))}
      </div>

      <form
        className={s.composer}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Input
          value={input}
          disabled={busy}
          placeholder={busy ? 'Waiting for Bryge…' : 'Ask about your data…'}
          onChange={(e) => setInput(e.currentTarget.value)}
        />
        <Button type="submit" disabled={busy || !input.trim()} icon={busy ? 'fa fa-spinner' : 'message'}>
          Ask
        </Button>
      </form>
    </div>
  );
}

const styles = () => ({
  wrap: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    overflow: hidden;
  `,
  scroll: css`
    flex: 1;
    overflow-y: auto;
    padding-right: 4px;
  `,
  empty: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    opacity: 0.7;
    text-align: center;
  `,
  turn: css`
    margin-bottom: 16px;
  `,
  question: css`
    font-weight: 500;
    margin-bottom: 6px;
    &::before {
      content: '❯ ';
      opacity: 0.5;
    }
  `,
  pending: css`
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0.8;
  `,
  answer: css`
    white-space: pre-wrap;
    line-height: 1.5;
    margin-bottom: 8px;
  `,
  chart: css`
    margin: 8px 0;
  `,
  sql: css`
    font-size: 12px;
    opacity: 0.75;
    pre {
      white-space: pre-wrap;
      margin: 4px 0 0;
      font-size: 11px;
    }
  `,
  composer: css`
    display: flex;
    gap: 8px;
  `,
});
