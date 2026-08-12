import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  dateMath,
  dateTime,
  PluginExtensionPanelContext,
  TimeRange,
} from '@grafana/data';
import { Alert, Button, Input, Spinner, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

import { ask, BrygeFrame, BrygeQuery, describeError } from '../api';
import { bindingFor, currentDashboardUid, DashboardBinding, loadSettings } from '../settings';
import { ChartView } from './ChartView';

interface Turn {
  question: string;
  answer?: string;
  sql?: string | null;
  /** Every query the answer rests on, not just the one that is charted. */
  queries?: BrygeQuery[];
  frame?: BrygeFrame | null;
  error?: string;
  pending?: boolean;
}

interface Props {
  context?: Readonly<PluginExtensionPanelContext>;
  onDismiss?: () => void;
}

/** Absolute bounds for whatever the dashboard's time picker currently says, including
 *  relative expressions like `now-6h`. */
function resolveRange(context?: Readonly<PluginExtensionPanelContext>): TimeRange {
  const raw = context?.timeRange ?? { from: 'now-6h', to: 'now' };
  const from = dateMath.parse(raw.from, false) ?? dateTime().subtract(6, 'hours');
  const to = dateMath.parse(raw.to, true) ?? dateTime();
  return { from, to, raw };
}

/**
 * Suggestions built from the panel the user clicked.
 *
 * The panel title is the one piece of context that is always present and always in the
 * user's own words, so it makes a better question seed than anything derived from the
 * SQL. No column or table name is assumed anywhere — the title is whatever the
 * dashboard author typed.
 */
function suggestions(title: string): string[] {
  const subject = title.replace(/^bryge\s*[—-]\s*/i, '').replace(/["']/g, '').trim();
  if (!subject) {
    return ['What stands out in this data?'];
  }
  return [
    `What stands out in ${subject}?`,
    `Why did ${subject} change during this window?`,
    `Show ${subject} over time`,
  ];
}

export function AskModal({ context, onDismiss }: Props) {
  const s = useStyles2(styles);
  // Resolved per dashboard: one Grafana can front several unrelated databases, and a
  // question about this panel has to hit the database this dashboard was set up against.
  const [binding, setBinding] = useState<DashboardBinding | null>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const range = useMemo(() => resolveRange(context), [context]);
  const title = context?.title ?? 'this panel';
  const prompts = useMemo(() => suggestions(title), [title]);

  useEffect(() => {
    loadSettings()
      .then((s) => setBinding(bindingFor(s, currentDashboardUid()) ?? null))
      .catch(() => setBinding(null));
  }, []);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy || !binding?.brygeDatasourceId) {
      return;
    }
    setInput('');
    setBusy(true);
    setTurns((t) => [...t, { question: q, pending: true }]);
    try {
      const res = await ask(binding.brygeDatasourceId, q, {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        max_data_points: 1000,
      });
      setTurns((t) =>
        t.map((turn, i) =>
          i === t.length - 1
            ? { question: q, answer: res.answer, sql: res.sql, queries: res.queries, frame: res.frame }
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

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  if (binding === null) {
    return (
      <Alert title="This dashboard has not been set up yet" severity="info">
        An admin can connect it under Administration → Plugins → Ask Bryge: pick this dashboard, and
        Bryge reads the database its panels already query.
      </Alert>
    );
  }

  return (
    <div className={s.wrap}>
      <div className={s.context}>
        Asking about <strong>{title}</strong> · {range.from.format('YYYY-MM-DD HH:mm')} to{' '}
        {range.to.format('YYYY-MM-DD HH:mm')}
      </div>

      <div className={s.scroll} ref={scroller}>
        {!turns.length && (
          <div className={s.prompts}>
            {prompts.map((p) => (
              <Button key={p} variant="secondary" size="sm" onClick={() => send(p)} disabled={!binding}>
                {p}
              </Button>
            ))}
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
            {turn.frame?.fields?.length ? (
              <div className={s.chart}>
                <ChartView frame={turn.frame} timeRange={range} width={720} height={220} />
              </div>
            ) : null}
            {turn.sql && (
              <details className={s.sql}>
                {/* A causal answer normally rests on several queries across several
                    tables. Showing only the charted one made Bryge look like it had
                    read one table when it had read four. */}
                <summary>
                  {turn.queries && turn.queries.length > 1
                    ? `${turn.queries.length} queries Bryge ran`
                    : 'Query Bryge wrote'}
                  {turn.frame ? ` · ${turn.frame.row_count} rows charted` : ''}
                </summary>
                {(turn.queries?.length ? turn.queries.map((q) => q.sql) : [turn.sql]).map((sql, n) => (
                  <pre key={n}>{sql}</pre>
                ))}
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
          autoFocus
          value={input}
          disabled={busy || !binding}
          placeholder={busy ? 'Waiting for Bryge…' : `Ask about ${title}…`}
          onChange={(e) => setInput(e.currentTarget.value)}
        />
        <Button type="submit" disabled={busy || !input.trim()}>
          Ask
        </Button>
        {onDismiss && (
          <Button variant="secondary" onClick={onDismiss}>
            Close
          </Button>
        )}
      </form>
    </div>
  );
}

const styles = () => ({
  wrap: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 320px;
    max-height: 70vh;
  `,
  context: css`
    font-size: 12px;
    opacity: 0.7;
  `,
  scroll: css`
    flex: 1;
    overflow-y: auto;
    min-height: 200px;
  `,
  prompts: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
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
