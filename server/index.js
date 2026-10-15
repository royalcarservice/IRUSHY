// IRUSHY - server entry point.
//
//   npm install && npm start
//
// Works with no .env at all: the local engine needs no key, no account and
// no network. Copy .env.example to .env only to change defaults or to turn
// on an optional backend (IRUSHY_ENGINE=apinex or IRUSHY_ENGINE=ollama).

import path from 'node:path';
import { ROOT, loadEnvFile, buildConfig, secretValues, ConfigError } from './config.js';
import { createLogger } from './lib/log.js';
import { loadKnowledge } from './lib/data.js';
import { createEngine } from './lib/engine/index.js';
import { createApp } from './app.js';

const envFileSetting = process.env.IRUSHY_ENV_FILE;
const envFile = envFileSetting === 'none' ? null : envFileSetting ? path.resolve(ROOT, envFileSetting) : path.join(ROOT, '.env');
const envInfo = loadEnvFile(envFile);

let config;
try {
  config = buildConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`IRUSHY configuration error: ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const log = createLogger({ level: config.log.level, secrets: secretValues(config) });

let knowledge;
try {
  knowledge = loadKnowledge({ dataDir: config.dataDir, allowSample: config.features.allowSample, log });
} catch (err) {
  log.error('knowledge_load_failed', { error: err.message });
  process.exit(1);
}

const engine = createEngine({ config, knowledge });
const app = createApp({ config, knowledge, engine, log });

const server = app.listen(config.port, config.host, () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  log.info('listening', {
    url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${port}`,
    host: config.host,
    port,
    engine: engine.name,
    engine_version: engine.version,
    ...(engine.model ? { model: engine.model } : {}),
    requires_key: engine.requiresKey,
    connected: engine.connected(),
    sample_content: knowledge.allowSample,
    knowledge_version: knowledge.version,
    env_file: envInfo.loaded ? path.basename(envInfo.file) : 'none',
    session_signing: config.session.secretEphemeral ? 'per-boot key (sessions reset on restart)' : 'configured'
  });
  if (engine.name === 'apinex' && !engine.connected()) {
    log.warn('not_connected', { detail: 'IRUSHY_ENGINE=apinex but APINEX_API_KEY is not set: chat answers "IRUSHY is not connected yet."' });
  }
  // Optional Ollama backend: say at once whether Ollama is running and the
  // model is installed, instead of at the first visitor's question.
  if (engine.name === 'ollama') {
    engine.probe().then((p) => {
      const fields = { engine: 'ollama', ok: p.ok, model: p.model, reachable: p.reachable, model_listed: p.modelListed, remote_model: p.remoteModel };
      if (p.ok) return log.info('engine_probe', fields);
      let detail = 'Ollama answered, but OLLAMA_MODEL is not installed there: run "ollama pull <model>" on that machine.';
      if (!p.reachable) detail = 'Ollama is not reachable at OLLAMA_BASE_URL: start it ("ollama serve" or the Ollama app).';
      else if (p.status) detail = `Ollama answered /api/tags with HTTP ${p.status}.`;
      else if (p.remoteModel) detail = 'OLLAMA_MODEL points at a cloud model (remote_host): set IRUSHY_OLLAMA_ALLOW_REMOTE=true to allow it, or use a local model.';
      return log.warn('engine_probe', { ...fields, detail });
    }).catch(() => {});
  }
});

// Bounded socket timeouts.
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  log.info('shutting_down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
