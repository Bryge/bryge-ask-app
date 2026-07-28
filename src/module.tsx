import React, { Suspense, lazy } from 'react';
import { AppPlugin, PluginExtensionPanelContext, PluginExtensionPoints } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';

import { AskModal } from './components/AskModal';
import type { AppConfigProps } from './components/AppConfig/AppConfig';

const LazyAppConfig = lazy(() => import('./components/AppConfig/AppConfig'));

const AppConfig = (props: AppConfigProps) => (
  <Suspense fallback={<LoadingPlaceholder text="" />}>
    <LazyAppConfig {...props} />
  </Suspense>
);

export const plugin = new AppPlugin<{}>()
  .addConfigPage({
    title: 'Configuration',
    icon: 'cog',
    body: AppConfig,
    id: 'configuration',
  })
  // This is the whole point of the app: it puts "Ask Bryge" in the menu of EVERY panel
  // on every dashboard, without anyone editing those panels. Grafana passes the panel's
  // own context — its title, its time range, its queries — so the question is answered
  // about the thing the user is actually looking at.
  .addLink<PluginExtensionPanelContext>({
    targets: [PluginExtensionPoints.DashboardPanelMenu],
    // Must match the entry in plugin.json exactly, and Grafana rejects titles shorter
    // than 10 characters — a plain "Ask Bryge" is silently dropped from every menu.
    title: 'Ask Bryge about this panel',
    description: 'Ask a question about this panel in plain language',
    icon: 'comment-alt-message',
    onClick: (_event, { context, openModal }) => {
      openModal({
        title: `Ask Bryge — ${context?.title ?? 'panel'}`,
        width: 900,
        body: ({ onDismiss }) => <AskModal context={context} onDismiss={onDismiss} />,
      });
    },
  });
