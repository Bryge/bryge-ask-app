/**
 * Where Bryge lives, so nobody has to be told.
 *
 * The plugin talks to Bryge's hosted API, so the URL is a prefill rather than a question.
 * The API KEY is a question: it identifies the account whose databases and analyses this
 * Grafana will use, and it belongs to a person, not to a build. Setup sends people to
 * their Bryge account to create one and paste it back.
 *
 * `key.generated.ts` still exists and is still written at build time by
 * scripts/write-key.mjs. It is now only a convenience prefill for Bryge's own demo
 * builds — setup asks for a key either way, and an empty value is the normal case.
 */
import { BUILT_IN_API_KEY } from './key.generated';

/**
 * The Bryge API the plugin calls. The CloudFront hostname rather than bryge.io: this one
 * is dialled by a Grafana server, and pinning it to the distribution keeps the plugin
 * working through a DNS change on the apex domain.
 */
export const DEFAULT_BRYGE_URL = 'https://dlvhlr05g45ob.cloudfront.net';

/**
 * The Bryge web app, for links a PERSON clicks. Both hosts serve the same SPA and both
 * proxy /api, but a human reading "go and create an API key" should be sent somewhere
 * they recognise, not to a distribution id.
 */
export const BRYGE_WEB_URL = 'https://bryge.io';

/** Deep links used by the setup page's first step. */
// `/keys`, not `/api-keys`: CloudFront sends `/api*` to the backend as a prefix match, so
// an /api-keys link would 403 for every real user while working fine locally.
export const BRYGE_API_KEYS_URL = `${BRYGE_WEB_URL}/keys`;
// Where a trial that has run out is sent for a permanent account. `/signup` redirects
// here: Bryge accounts are early-access gated, so this is the only door.
export const BRYGE_EARLY_ACCESS_URL = `${BRYGE_WEB_URL}/early-access`;

/** Prefilled into the key field on Bryge's own demo builds; empty everywhere else. */
export const PREFILLED_API_KEY = BUILT_IN_API_KEY;
