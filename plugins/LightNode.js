/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
const { IPC } = require('../libs/IPC');
const { Database } = require('../libs/Database');
const { getCleanupDecision } = require('../libs/util/lightNodeCleanup');
const { PLUGIN_NAME: STREAMER_PLUGIN_NAME, PLUGIN_ACTIONS: STREAMER_PLUGIN_ACTIONS } = require('./Streamer.constants');

const PLUGIN_NAME = 'LightNode';
const PLUGIN_PATH = require.resolve(__filename);

const ipc = new IPC(PLUGIN_NAME);
let database = null;

let manageLightNodeTimeoutHandler = null;
let adaptiveCleanup = false;
let cleanupLagThreshold = 1000;
let maxConsecutiveCleanupSkips = 3;
let lastVerifiedBlockCacheTTL = 900000;
let consecutiveCleanupSkips = 0;
let stopping = false;

const getSyncLag = async () => {
  try {
    const response = await ipc.send({
      to: STREAMER_PLUGIN_NAME,
      action: STREAMER_PLUGIN_ACTIONS.GET_SYNC_LAG,
    });
    return response ? response.payload : null;
  } catch (error) {
    console.warn('could not query streamer sync lag:', error.message);
    return null;
  }
};

const manageLightNode = async (cleanupInterval) => {
  try {
    if (adaptiveCleanup) {
      const syncLag = await getSyncLag();
      const decision = getCleanupDecision(
        syncLag,
        consecutiveCleanupSkips,
        cleanupLagThreshold,
        maxConsecutiveCleanupSkips,
      );

      if (decision.shouldSkip) {
        consecutiveCleanupSkips += 1;
        console.log(
          `skipping light-node cleanup: ${decision.reason} (${syncLag} blocks behind; `
          + `${consecutiveCleanupSkips}/${maxConsecutiveCleanupSkips} skips)`,
        );
        return;
      }

      if (syncLag === null) {
        console.log(`could not determine streamer sync lag; running light-node cleanup (${decision.reason})`);
      } else if (decision.reason === 'maximum consecutive cleanup skips reached') {
        console.log(`running light-node cleanup despite ${syncLag}-block lag: ${decision.reason}`);
      }
    }

    await database.cleanupLightNode(lastVerifiedBlockCacheTTL);
    consecutiveCleanupSkips = 0;
  } catch (error) {
    console.error(`light-node cleanup failed: ${error.message}`);
    consecutiveCleanupSkips = 0;
  } finally {
    if (!stopping) {
      manageLightNodeTimeoutHandler = setTimeout(() => {
        manageLightNode(cleanupInterval);
      }, cleanupInterval);
    }
  }
};

const init = async (conf, callback) => {
  const {
    lightNode,
    databaseURL,
    databaseName,
    streamerEnabled,
  } = conf;

  adaptiveCleanup = lightNode.adaptiveCleanup === true && streamerEnabled === true;
  cleanupLagThreshold = Number.isFinite(lightNode.cleanupLagThreshold)
    && lightNode.cleanupLagThreshold >= 0
    ? lightNode.cleanupLagThreshold
    : 1000;
  maxConsecutiveCleanupSkips = Number.isInteger(lightNode.maxConsecutiveCleanupSkips)
    && lightNode.maxConsecutiveCleanupSkips >= 0
    ? lightNode.maxConsecutiveCleanupSkips
    : 3;
  lastVerifiedBlockCacheTTL = Number.isFinite(lightNode.lastVerifiedBlockCacheTTL)
    && lightNode.lastVerifiedBlockCacheTTL >= 0
    ? lightNode.lastVerifiedBlockCacheTTL
    : 900000;
  consecutiveCleanupSkips = 0;
  stopping = false;

  if (!lightNode.enabled) {
    console.log('LightNode not started as it is not enabled in the config.json file');
  } else {
    database = new Database();
    await database.init(databaseURL, databaseName, lightNode.enabled, lightNode.blocksToKeep);
    manageLightNode(lightNode.cleanupInterval ? lightNode.cleanupInterval : 600000);
  }
  callback(null);
};

function stop() {
  stopping = true;
  if (manageLightNodeTimeoutHandler) clearTimeout(manageLightNodeTimeoutHandler);
  if (database) database.close();
}

ipc.onReceiveMessage((message) => {
  const {
    action,
    payload,
  } = message;

  switch (action) {
    case 'init':
      init(payload, (res) => {
        console.log('successfully initialized'); // eslint-disable-line no-console
        ipc.reply(message, res);
      });
      break;
    case 'stop':
      ipc.reply(message, stop());
      console.log('successfully stopped'); // eslint-disable-line no-console
      break;
    default:
      ipc.reply(message);
      break;
  }
});

module.exports.PLUGIN_NAME = PLUGIN_NAME;
module.exports.PLUGIN_PATH = PLUGIN_PATH;
