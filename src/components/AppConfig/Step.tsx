import React from 'react';
import { Icon, Text, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

export type StepState = 'todo' | 'active' | 'done';

const getStyles = (theme: GrafanaTheme2) => ({
  row: css({ display: 'flex', gap: theme.spacing(2), alignItems: 'flex-start' }),
  // The rail is what makes six separate questions read as one sequence. Without it the
  // page is a stack of unrelated forms and people fill them out of order.
  rail: css({
    display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'stretch',
  }),
  line: css({ flex: 1, width: 2, background: theme.colors.border.weak, minHeight: theme.spacing(1) }),
  bullet: css({
    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium, flexShrink: 0,
  }),
  todo: css({
    background: theme.colors.background.secondary, color: theme.colors.text.disabled,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  active: css({ background: theme.colors.primary.main, color: theme.colors.primary.contrastText }),
  done: css({ background: theme.colors.success.main, color: theme.colors.success.contrastText }),
  body: css({ flex: 1, minWidth: 0, paddingBottom: theme.spacing(3) }),
  dim: css({ opacity: 0.55 }),
});

interface Props {
  n: number;
  title: string;
  state: StepState;
  /** One line shown instead of the body once the step is behind you. */
  summary?: React.ReactNode;
  last?: boolean;
  children?: React.ReactNode;
}

/**
 * One step of the setup sequence.
 *
 * A completed step collapses to a single line of what was chosen. Keeping every form
 * open at once is what made the old page feel like paperwork: five fields visible, no
 * indication which of them still needed an answer.
 */
export function Step({ n, title, state, summary, last, children }: Props) {
  const s = useStyles2(getStyles);
  return (
    <div className={s.row}>
      <div className={s.rail}>
        <div className={`${s.bullet} ${state === 'done' ? s.done : state === 'active' ? s.active : s.todo}`}>
          {state === 'done' ? <Icon name="check" /> : n}
        </div>
        {!last && <div className={s.line} />}
      </div>
      <div className={`${s.body} ${state === 'todo' ? s.dim : ''}`}>
        <Text element="h4" variant="h5">
          {title}
        </Text>
        {state === 'active' && <div style={{ marginTop: 8 }}>{children}</div>}
        {/* Only a step you have actually finished gets a summary. Rendering it for a
            step still ahead announced answers nobody had given — "0 tables readable",
            "Skipped" — next to a Change link for a question not yet asked. */}
        {state === 'done' && summary && (
          <div style={{ marginTop: 4 }}>
            <Text variant="bodySmall" color="secondary">
              {summary}
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
