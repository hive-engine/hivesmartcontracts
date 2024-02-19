/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
const { IPC } = require('../libs/IPC');
const { Database } = require('../libs/Database');

const PLUGIN_NAME = 'LightNode';
const PLUGIN_PATH = require.resolve(__filename);

const ipc = new IPC(PLUGIN_NAME);
let database = null;

let manageLightNodeTimeoutHandler = null;

const manageLightNode = async (cleanupInterval) => {
  await database.cleanupLightNode();

  manageLightNodeTimeoutHandler = setTimeout(() => {
    manageLightNode(cleanupInterval);
  }, cleanupInterval);
};

const init = async (conf, callback) => {
  const {
    lightNode,
    databaseURL,
    databaseName,
  } = conf;

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
