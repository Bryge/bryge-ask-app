# Ask Bryge — Grafana app plugin

The plugin users see is described in [`src/README.md`](./src/README.md), which is the file
the Grafana catalog renders. This one is for working on it.

One app plugin, three plugin ids. Grafana treats the nested data source and panel as
plugins in their own right, so all three have to be allowed when running unsigned:

| id | type | what it is |
|---|---|---|
| `bryge-ask-app` | app | the setup page, and "Ask Bryge about this panel" in the panel menu |
| `bryge-ask-datasource` | datasource | carries the Bryge URL and the encrypted API key, and proxies every call |
| `bryge-ask-panel` | panel | the chat panel added to a dashboard |

There is no Go backend. `plugin.json` sets `"backend": false` and nothing ships a binary.

## Layout

```
src/
  plugin.json                  the app; nested plugins are declared in `includes` with a path
  module.tsx                   app registration + the panel-menu extension
  api.ts                       every call to Bryge, through the data source proxy
  settings.ts                  the app's own jsonData, and the install id the trial is keyed on
  defaults.ts                  where Bryge lives; key.generated.ts is written at build time
  grafana.ts                   everything done through Grafana's own API on the user's behalf
  components/AppConfig/        the six-step setup page
  components/AskModal.tsx      the panel menu's ask dialog
  datasource/                  nested data source (proxy route + config editor)
  panel/                       nested chat panel
```

## Develop

```bash
npm install
npm run dev          # webpack watch into dist/
npm run typecheck
npm run lint
npm run test:ci
```

Point a local Grafana at `dist/`, or copy it onto one:

```bash
npm run build
rsync -a --delete dist/ <host>:~/grafana/plugins/bryge-ask-app/
```

An unsigned build needs this on the installing Grafana:

```
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=bryge-ask-app,bryge-ask-datasource,bryge-ask-panel
```

`plugin.json` is read at startup, so **restart Grafana after changing it**. Frontend code
is served from disk and only needs a page reload.

## Things that have bitten us

- **Run npm from this directory.** The repository root has no `package.json`, and a stray
  root lockfile re-roots Turbopack for the web app next door.
- **`ignore-scripts=true`** silently disables the prebuild and postbuild hooks, which is
  how a release once shipped with no logos on the nested plugins.
- **A new data source is not reachable until the page reloads.** Grafana caches the data
  source registry in the running frontend. Updating an existing one's secret needs no
  reload.
- **Nested plugins must be declared** in the parent `plugin.json` `includes` with a `path`
  pointing at their `plugin.json`, or the Grafana plugin validator rejects the archive.
- **`key.generated.ts` is generated and gitignored.** A clean checkout cannot typecheck
  until `npm run prepare:key` has run. `npm run build` does it; the CI quality gate runs
  first, so it does it explicitly.

## Release

Tag `plugin-v<version>` where `<version>` matches `package.json` exactly. The workflow
(`.github/workflows/release.yml`) typechecks, lints, tests, builds, verifies the archive
looks like a plugin and carries no `bk_` key, optionally signs it, and attaches the zip
plus its SHA1 to a GitHub Release.

Signing is skipped unless `GRAFANA_ACCESS_POLICY_TOKEN` is set as a repository secret and
`GRAFANA_ROOT_URLS` as a repository variable. Unsigned is the correct state until Grafana
reviews the plugin and grants a signature level.

## Contributing

Bugs and feature requests: <https://github.com/Bryge/bryge-ask-app/issues>. Pull requests
are welcome; `npm run typecheck`, `npm run lint` and `npm run test:ci` all have to pass,
and anything user-visible needs a `CHANGELOG.md` entry.

`scripts/verify/` holds Playwright scripts that walk a real install end to end against a
live Grafana and a live Bryge. They need credentials passed as environment variables and
are not part of CI.
