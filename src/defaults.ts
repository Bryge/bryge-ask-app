/**
 * Where Bryge lives, so nobody has to be told.
 *
 * The plugin always talks to Bryge's hosted API, so there is no URL to choose and no key
 * to paste: installing it and picking a dashboard is the whole setup. The key is written
 * into `key.generated.ts` at build time by scripts/write-key.mjs and is never committed.
 *
 * A self-hosted Bryge is still possible — build without BRYGE_API_KEY and the setup page
 * asks for a URL and key instead.
 */
import { BUILT_IN_API_KEY } from './key.generated';

export const DEFAULT_BRYGE_URL = 'https://dlvhlr05g45ob.cloudfront.net';
export const DEFAULT_BRYGE_API_KEY = BUILT_IN_API_KEY;

/** True when this build carries its own credentials and needs no connection step. */
export const IS_HOSTED_BUILD = Boolean(DEFAULT_BRYGE_URL && DEFAULT_BRYGE_API_KEY);
