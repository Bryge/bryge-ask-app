# Ask Bryge

Ask your dashboards questions in plain language, and get the answer with the query and the
data behind it.

Bryge connects to the database a dashboard already charts, reads its schema, works out how
the tables relate (including relationships nobody declared as foreign keys), and answers
questions against that map. Because it holds the map, a question like "why did consumption
spike on Tuesday" is answered from the tables that explain it, not only the one the panel
happens to draw.

Bryge only reads. It never writes to your database.

## What you get

- **"Ask Bryge about this panel"** in every panel's menu. Ask about what you're looking
  at, in the dashboard's own time range.
- **A chat panel** on the dashboard, for longer questions.
- **Every query it ran**, listed under each answer. A causal question usually rests on
  several, across several tables.
- **A pinned query that survives the time picker.** Bryge returns its SQL with the window
  left as `$__timeFrom` / `$__interval`, so switching 1h to 7d re-runs the same query
  against a new window and costs nothing.

## Requirements

- Grafana 11.1 or later.
- A dashboard that charts a PostgreSQL, ClickHouse or InfluxDB data source.
- A Bryge account, or the 24-hour trial that setup offers.

## Getting started

Go to **Administration → Plugins → Ask Bryge → Configuration**. Setup is six questions,
asked one at a time.

1. **Connect.** Choose "Start a 24-hour trial" and enter a work email, or paste an API key
   from your Bryge account. Nothing else is needed to get going.
2. **Pick a dashboard.** Bryge reads which database its panels already query.
3. **Let Bryge reach that database.** For PostgreSQL and ClickHouse the default route
   needs no password: setup creates a Grafana service account called `bryge-ask` with the
   Viewer role, and Bryge asks Grafana to run its SQL. The credential Grafana already
   holds never moves. Other engines ask for their own secret.
4. **Say what the data is for.** A plant's energy metering and a billing system with the
   same schema produce different relationships, so this steers what Bryge infers.
5. **Choose which tables Bryge may read.** The tables your dashboard already charts are
   pre-selected. Everything downstream is scoped to this list.
6. **Run it.** Bryge reads each table, summarizes it and works out the links. A few
   minutes is normal; a large schema can take five to ten. Progress is reported as it
   goes.

The chat panel is added to the dashboard when that finishes, and every panel's menu gets
"Ask Bryge about this panel".

## The 24-hour trial

Setup can issue this Grafana a key that works for 24 hours, so you can see it working
before anyone signs up for anything. The setup page counts down and warns you before it
ends. When it does, create an API key on a Bryge account and paste it in: the dashboards,
the analyzed database and the chat panel all stay exactly as they are.

A trial covers one database.

## Removing it

Use **"Remove Bryge from these dashboards"** on the configuration page *before*
uninstalling the plugin. It takes the chat panel off every dashboard and deletes the
connection, in the order that leaves nothing broken. Grafana leaves a panel whose plugin
has been uninstalled behind as a dead tile, which the dashboard owner then has to delete
by hand.

Your data and its analysis are left untouched, so reinstalling later costs nothing.

## Security

- The API key is stored encrypted by Grafana and attached server-side. It never reaches a
  browser.
- SQL that Bryge generates is checked before it runs: read-only, one statement, no schema
  changes, scoped to the tables you selected, with row and time limits applied by the
  server rather than requested in a prompt.
- The Grafana Viewer role is not read-only against the database behind a data source, so
  Bryge enforces read-only itself on every statement it sends.

## Feedback

Questions, bugs and feature requests: <https://bryge.io>.
