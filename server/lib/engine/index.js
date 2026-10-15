// IRUSHY - engine factory.
//
// IRUSHY_ENGINE=local  (default) the built-in engine: no key, no network
// IRUSHY_ENGINE=apinex (optional) the APInex gateway; needs APINEX_API_KEY
// IRUSHY_ENGINE=ollama (optional) a model on this machine; needs OLLAMA_MODEL
//
// All three implement the same interface, so server/routes/chat.js does not
// care which one answers. There is no automatic fallback between them.

import { createLocalEngine } from './local.js';
import { createApinexEngine } from './apinex.js';
import { createOllamaEngine } from './ollama.js';

export function createEngine({ config, knowledge, fetchImpl }) {
  if (config.engine === 'apinex') return createApinexEngine({ config, knowledge, fetchImpl });
  if (config.engine === 'ollama') return createOllamaEngine({ config, knowledge, fetchImpl });
  return createLocalEngine({ config, knowledge });
}
