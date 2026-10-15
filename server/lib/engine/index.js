// IRUSHY - engine factory.
//
// IRUSHY_ENGINE=local  (default) the built-in engine: no key, no network
// IRUSHY_ENGINE=apinex (optional) the APInex gateway; needs APINEX_API_KEY
//
// Both implement the same interface, so server/routes/chat.js does not care
// which one answers. There is no automatic fallback between them.

import { createLocalEngine } from './local.js';
import { createApinexEngine } from './apinex.js';

export function createEngine({ config, knowledge, fetchImpl }) {
  if (config.engine === 'apinex') return createApinexEngine({ config, knowledge, fetchImpl });
  return createLocalEngine({ config, knowledge });
}
