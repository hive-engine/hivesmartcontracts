/* eslint-disable no-console */
const { fork } = require('child_process');
const { Database } = require('../../Database');
const blockchain = require('../../../plugins/Blockchain');
const { setupContractPayload } = require('../contractUtil');
const { CONSTANTS } = require('../../Constants');
const { Transaction } = require('../../Transaction');

const conf = {
  chainId: 'test-chain-id',
  genesisSteemBlock: 2000000,
  dataDirectory: './test/data/',
  databaseFileName: 'database.db',
  autosaveInterval: 0,
  javascriptVMTimeout: 10000,
  databaseURL: 'mongodb://localhost:27017',
  databaseName: 'testssc',
  streamNodes: ['https://api.hive.blog'],
  enablePerUserTxLimit: false,
  defaultLogLevel: "warn",
};

class Fixture {
  constructor() {
    this.plugins = {};
    this.jobs = new Map();
    this.currentJobId = 0;
    this.database = null;
    this.txId = 1;
    this.refBlockNumber = 100000000;
    this.startBlockOffset = 0;
  }

  sendBlock(block) {
    return this.send(blockchain.PLUGIN_NAME, 'MASTER', { action: blockchain.PLUGIN_ACTIONS.PRODUCE_NEW_BLOCK_SYNC, payload: block });
  }

  send(pluginName, from, message) {
    const plugin = this.plugins[pluginName];
    const newMessage = {
      ...message,
      to: plugin.name,
      from,
      type: 'request',
    };
    this.currentJobId += 1;
    newMessage.jobId = this.currentJobId;
    plugin.cp.send(newMessage);
    return new Promise((resolve) => {
      this.jobs.set(this.currentJobId, {
        message: newMessage,
        resolve,
      });
    });
  }

  // function to route the IPC requests
  route(message) {
    const { to, type, jobId } = message;
    if (to) {
      if (to === 'MASTER') {
        if (type && type === 'request') {
          // do something
        } else if (type && type === 'response' && jobId) {
          const job = this.jobs.get(jobId);
          if (job && job.resolve) {
            const { resolve } = job;
            this.jobs.delete(jobId);
            resolve(message);
          }
        }
      } else if (type && type === 'broadcast') {
        this.plugins.forEach((plugin) => {
          plugin.cp.send(message);
        });
      } else if (this.plugins[to]) {
        this.plugins[to].cp.send(message);
      } else {
        console.error('ROUTING ERROR: ', message);
      }
    }
  }

  loadPlugin(newPlugin) {
    const plugin = {};
    plugin.name = newPlugin.PLUGIN_NAME;
    plugin.cp = fork(newPlugin.PLUGIN_PATH, [], { silent: true });
    plugin.cp.on('message', msg => this.route(msg));
    plugin.cp.stdout.on('data', data => console.log(`[${newPlugin.PLUGIN_NAME}]`, data.toString()));
    plugin.cp.stderr.on('data', data => console.error(`[${newPlugin.PLUGIN_NAME}]`, data.toString()));

    this.plugins[newPlugin.PLUGIN_NAME] = plugin;

    return this.send(newPlugin.PLUGIN_NAME, 'MASTER', { action: 'init', payload: conf });
  }

  unloadPlugin(plugin) {
    if (this.plugins[plugin.PLUGIN_NAME]) {
      this.plugins[plugin.PLUGIN_NAME].cp.kill('SIGINT');
      this.plugins[plugin.PLUGIN_NAME] = null;
    }
  }

  getNextTxId() {
    this.txId += 1;
    return `TXID${this.txId.toString().padStart(8, '0')}`;
  }

  getNextRefBlockNumber() {
    this.refBlockNumber += 1;
    return this.refBlockNumber;
  }

  async setUp() {
    console.log("Please remember to run npm run minify:files");
    await this.loadPlugin(blockchain);
    this.database = new Database();
    await this.database.init(conf.databaseURL, conf.databaseName);
    this.refBlockNumber = 100000000;
    this.txId = 1;

    // set up resource manager
    const rmContractPayload = setupContractPayload('resourcemanager', './contracts/resourcemanager.js');
    const transactions = [];
    transactions.push(new Transaction(undefined, this.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(rmContractPayload)));
    transactions.push(new Transaction(undefined, this.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateParams', '{ "numberOfFreeTx": 10000 }'));
    const block = {
       refHiveBlockNumber: 10,
       refHiveBlockId: 'ABCD1',
       prevRefHiveBlockId: 'ABCD2',
       timestamp: '2018-01-01T00:00:00',
       transactions,
     };
     await this.sendBlock(block);
     this.startBlockOffset = 1;
  }

  tearDown() {
    this.unloadPlugin(blockchain);
    this.jobs = new Map();
    this.currentJobId = 0;
    this.database.close();
  }
}

module.exports.Fixture = Fixture;
module.exports.conf = conf;
