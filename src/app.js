// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring. (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { httpRequest } from './blueair/http.js';
import { normalizeConfig } from './config.js';
import { BlueairHub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'blueair-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, request, timers, timings, now, sleep
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new BlueairHub({
    gladys,
    store: options.store ?? new Store(),
    request: options.request ?? httpRequest,
    timers: options.timers ?? true,
    timings: options.timings,
    now: options.now,
    sleep: options.sleep,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first read is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): send again what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      logger.info('Connected to Gladys');
      await hub.start(config);
    } catch (err) {
      logger.error(`Initialization failed: ${err.message}`);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The devices are published with should_poll: false (the hub reads the
  // cloud on its own timer); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady((device) => hub.pollDevice(device)));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'test_connection',
    whenReady(() => {
      logger.info('Action: test the connection');
      return hub.testConnection();
    }),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
