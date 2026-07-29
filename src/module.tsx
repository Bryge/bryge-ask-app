import React, { Suspense, lazy } from 'react';
import { AppPlugin, PluginExtensionPanelContext, PluginExtensionPoints } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';

import { AskModal } from './components/AskModal';
import type { AppConfigProps } from './components/AppConfig/AppConfig';
import { currentDashboardUid, peekSettings, prime } from './settings';

// Load the app's settings once, as early as possible: the panel-menu link is shown or
// hidden by a synchronous callback, so the answer has to be in memory before Grafana
// builds a menu.
prime();

/** The dashboard `configure` last refreshed for, so navigation triggers exactly one. */
let lastSeenDashboard: string | undefined;

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
    // Only on dashboards that have actually been set up. Offering it everywhere means a
    // menu item that opens a modal saying "not configured", on dashboards whose data
    // Bryge has never seen — noise in someone else's dashboard for no reason.
    configure: (context) => {
      const uid = context?.dashboard?.uid ?? currentDashboardUid();
      // Refresh in the background the first time each dashboard is seen. Grafana keeps
      // this plugin's module alive across SPA navigation, so a dashboard set up after
      // the module loaded would otherwise stay invisible until a full page reload.
      if (uid && uid !== lastSeenDashboard) {
        lastSeenDashboard = uid;
        prime();
      }
      const bound = uid ? peekSettings()?.dashboards?.[uid] : undefined;
      return bound ? {} : undefined;
    },
    onClick: (_event, { context, openModal }) => {
      openModal({
        title: `Ask Bryge — ${context?.title ?? 'panel'}`,
        width: 900,
        body: ({ onDismiss }) => <AskModal context={context} onDismiss={onDismiss} />,
      });
    },
  });
