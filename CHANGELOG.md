# Changelog

All notable changes to the Ask Bryge Grafana app. This file is shown on the plugin's
details page, so it is written for someone deciding whether to update.

## 1.3.3 (2026-08-13)

**Changed**

- Every release archive now carries a signed build provenance attestation, so anyone
  installing it can verify the zip came out of this repository's release workflow at a
  known commit rather than being assembled by hand. Raised by Grafana's plugin checks
  during catalog review. No code change.

## 1.3.2 (2026-08-13)

**Changed**

- Screenshots for the plugin catalog listing: a panel being asked why its data changed,
  the six-step setup, and the queries behind an answer. No code change.

## 1.3.1 (2026-08-12)

Housekeeping, aimed at a Grafana plugin catalog submission. No behaviour change.

**Security**

- `@grafana/*` moved from 13.1.0 to 13.1.3, `js-cookie` pinned to `^3.0.6` through an
  override, and the unused Go scaffolding removed. High and critical advisories against
  this plugin are now zero (they were five high and one critical, all in dependencies
  nothing shipped).

**Fixed**

- The nested data source and panel are now declared in the app's `includes` with a path to
  their `plugin.json`, which the Grafana plugin validator requires.
- The LICENSE carried the Apache template's `{yyyy} {name of copyright owner}`
  placeholders.
- The plugin's README was still the generator's comment block.

## 1.3.0 (2026-08-12)

**Features**

- **A 24-hour trial, so setup no longer starts with a key you don't have.** Step 1 now
  offers "Start a 24-hour trial": enter a work email and this Grafana is issued a key that
  works for a day, with the rest of setup running exactly as it will afterwards. Pasting
  your own key is still there under "I have a Bryge API key".
- The setup page counts down the trial, warns under six hours, and when the key runs out
  says so plainly. Replacing it with a key from a Bryge account keeps every dashboard,
  the analyzed database and the chat panel exactly as they are.
- "Replace the key" is now reachable on a working install, instead of only before one.

**Bug fixes**

- The panel menu's "Ask Bryge" showed the SQL of a single table under an answer that had
  crossed three, sometimes not even the table the question was about. Bryge pinned the
  *last* query it ran, which on a "why did this change" question is the narrow confirming
  check rather than the result the answer describes. It now pins the widest query, and
  both the panel menu and the chat panel list every query behind an answer.
- Answers to causal questions now correlate the effect against the tables the knowledge
  graph links it to, returned side by side from one aligned query, instead of fetching
  each measure separately.
- The table picker's SQL parsing counted every CTE after the first as a table
  (`\b(?:with|,)` never matches a comma that follows a closing paren).

## 1.2.1 (2026-08-10)

**Bug fixes**

- The nested data source and panel shipped without their logos, and a clean checkout could
  not build at all: `ignore-scripts=true` silently disabled the prebuild and postbuild
  hooks.

## 1.2.0 (2026-08-10)

**Features**

- **No database password.** Setup mints a Grafana service-account token and Bryge sends
  its SQL through Grafana, so the credential Grafana already holds never has to be typed
  again. Engines Grafana cannot run SQL for still ask for their own secret.
- Setup became six questions asked one at a time, in the order the answers become
  knowable, replacing a single form.
- Schema analysis names the phase it is in and counts elapsed time. On a large schema it
  takes five to ten minutes, and a bare spinner for that long reads as a hung tab.
- "Remove Bryge from these dashboards" takes the chat panel off every dashboard and
  deletes the connection, in the order that leaves nothing broken. Run it before
  uninstalling: Grafana leaves a panel whose plugin is gone as a dead tile.

## 1.1.0 (2026-07-31)

**Features**

- One app plugin that sets a dashboard up by itself: it reads which database the dashboard
  already charts, hands it to Bryge, and writes the chat panel back in.

## 1.0.0 (2026-07-29)

- First release: the Bryge API data source, the Bryge Chat panel, and "Ask Bryge about
  this panel" in every panel's menu.
