const jayson = require('jayson');
const http = require('http');
const cors = require('cors');
const express = require('express');
const bodyParser = require('body-parser');
const { IPC } = require('../libs/IPC');
const { Database } = require('../libs/Database');

const STREAMER_PLUGIN_NAME = require('./Streamer.constants').PLUGIN_NAME;
const STREAMER_PLUGIN_ACTION = require('./Streamer.constants').PLUGIN_ACTIONS;
const packagejson = require('../package.json');
const config = require('../config.json');

const PLUGIN_NAME = 'JsonRPCServer';
const PLUGIN_PATH = require.resolve(__filename);

const ipc = new IPC(PLUGIN_NAME);
let serverRPC = null;
let server = null;
let database = null;

const requestLogger = function (req, _, next) {
  console.log(`Incoming request from ${req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress} - ${JSON.stringify(req.body)}`);
  next();
}

async function generateStatus() {
  return new Promise(async (resolve, reject) => {
    try {
      const result = {};
      // retrieve the last block of the sidechain
      const block = await database.getLatestBlockMetadata();

      if (block) {
        result.lastBlockNumber = block.blockNumber;
        result.lastBlockRefHiveBlockNumber = block.refHiveBlockNumber;
        result.lastHash = block.hash;
      }

      // get the Hive block number that the streamer is currently parsing
      const res = await ipc.send(
        { to: STREAMER_PLUGIN_NAME, action: STREAMER_PLUGIN_ACTION.GET_CURRENT_BLOCK },
      );

      if (res && res.payload) {
        result.lastParsedHiveBlockNumber = res.payload;
      }

      // get the version of the SSC node
      result.SSCnodeVersion = packagejson.version;

      // gets the domain of the SSC node
      result.domain = config.domain;

      // get the ssc chain id from config
      result.chainId = config.chainId;

      //get the disabled methods from config
      result.disabledMethods = config.rpcConfig.disabledMethods;

      // get light node config of the SSC node
      result.lightNode = config.lightNode.enabled;
      if (result.lightNode) {
        result.blocksToKeep = config.lightNode.blocksToKeep;
      }

      // first block currently stored by light node
      if (result.lightNode) {
        const firstBlock = await database.chain.findOne({ blockNumber: { $gt: 0 } }, { session: database.session });
        result.firstBlockNumber = firstBlock?.blockNumber;
      }

      const witnessParams = await database.findOne({ contract: 'witnesses', table: 'params', query: {} });
      if (witnessParams && witnessParams.lastVerifiedBlockNumber) {
        result.lastVerifiedBlockNumber = witnessParams.lastVerifiedBlockNumber;
      }

      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
}

function blockchainRPC() {
  let methods = {
    getLatestBlockInfo: async (args, callback) => {
      try {
        const lastestBlock = await database.getLatestBlockInfo();
        callback(null, lastestBlock);
      } catch (error) {
        callback(error, null);
      }
    },
    getBlockInfo: async (args, callback) => {
      try {
        const { blockNumber } = args;

        if (Number.isInteger(blockNumber)) {
          const block = await database.getBlockInfo(blockNumber);
          callback(null, block);
        } else {
          callback({
            code: 400,
            message: 'missing or wrong parameters: blockNumber is required',
          }, null);
        }
      } catch (error) {
        callback(error, null);
      }
    },
    getBlockRangeInfo: async (args, callback) => {
      try {
        const { startBlockNumber, count } = args;

        if (!Number.isInteger(startBlockNumber)) {
          callback({
            code: 400,
            message: 'missing or wrong parameters: startBlockNumber is required',
          }, null);
          return;
        }
        if (!Number.isInteger(count)) {
          callback({
            code: 400,
            message: 'missing or wrong parameters: count is required',
          }, null);
          return;
        }
        if ( count > 1000){
          callback({
            code: 400,
            message: 'count can not be over 1000',
          }, null);
          return;
        }
        const blocks = await database.getBlockRangeInfo(startBlockNumber, count);
        callback(null, blocks);
      } catch (error) {
        callback(error, null);
      }
    },
    getTransactionInfo: async (args, callback) => {
      try {
        const { txid } = args;

        if (txid && typeof txid === 'string') {
          const transaction = await database.getTransactionInfo(txid);
          callback(null, transaction);
        } else {
          callback({
            code: 400,
            message: 'missing or wrong parameters: txid is required',
          }, null);
        }
      } catch (error) {
        callback(error, null);
      }
    },
    getStatus: async (args, callback) => {
      try {
        const result = await generateStatus();
        callback(null, result);
      } catch (error) {
        callback(error, null);
      }
    },
  };
  for (const method in methods) {
    if (config.rpcConfig.disabledMethods?.blockchain?.includes(method) && method !== 'getStatus') {
      methods[method] = (args, callback) => {
        callback({
          code: 400,
          message: `method blockchain.${method} is disabled`,
        }, null);
      }
    }
  }
  return methods;
}

function contractsRPC() {
  let methods = {
    getContract: async (args, callback) => {
      try {
        const { name } = args;

        if (name && typeof name === 'string') {
          const contract = await database.findContract({ name });
          callback(null, contract);
        } else {
          callback({
            code: 400,
            message: 'missing or wrong parameters: name is required',
          }, null);
        }
      } catch (error) {
        callback(error, null);
      }
    },

    findOne: async (args, callback) => {
      try {
        const { contract, table, query } = args;

        if (contract && typeof contract === 'string'
          && table && typeof table === 'string'
          && query && typeof query === 'object') {
          const result = await database.findOne({
            contract,
            table,
            query,
          });

          callback(null, result);
        } else {
          callback({
            code: 400,
            message: 'missing or wrong parameters: contract, table and query are required',
          }, null);
        }
      } catch (error) {
        callback(error, null);
      }
    },

    find: async (args, callback) => {
      try {
        const {
          contract,
          table,
          query,
          limit,
          offset,
          indexes,
        } = args;

        if (contract && typeof contract === 'string'
          && table && typeof table === 'string'
          && query && typeof query === 'object') {
          const lim = limit || config.rpcConfig.maxLimit;
          const off = offset || 0;
          const ind = indexes || [];

          if (lim > config.rpcConfig.maxLimit) {
            callback({
              code: 400,
              message: `limit is too high, maximum limit is ${config.rpcConfig.maxLimit}`,
            }, null);
            return;
          }

          if (config.rpcConfig.maxOffset != -1 && off > config.rpcConfig.maxOffset) {
            callback({
              code: 400,
              message: `offset is too high, maximum offset is ${config.rpcConfig.maxOffset}`,
            }, null);
            return;
          }

          const result = await database.find({
            contract,
            table,
            query,
            limit: lim,
            offset: off,
            indexes: ind,
          }, true);

          callback(null, result);
        } else {
          callback({
            code: 400,
            message: 'missing or wrong parameters: contract, table and query are required',
          }, null);
        }
      } catch (error) {
        callback(error, null);
      }
    },
  };
  for (const method in methods) {
    if (config.rpcConfig.disabledMethods?.contracts?.includes(method)) {
      methods[method] = (args, callback) => {
        callback({
          code: 400,
          message: `method contracts.${method} is disabled`,
        }, null);
      }
    }
  }
  return methods;
}

function multiRPC() {
  const methods = {};
  for (const method in jayson.server(blockchainRPC())._methods) {
    methods['blockchain.' + method] = jayson.server(blockchainRPC())._methods[method]
  }
  for (const method in jayson.server(contractsRPC())._methods) {
    methods['contracts.' + method] = jayson.server(contractsRPC())._methods[method]
  }
  return methods
}

const init = async (conf, callback) => {
  const {
    rpcNodePort,
    databaseURL,
    databaseName,
    rpcWebsockets
  } = conf;

  database = new Database();
  await database.init(databaseURL, databaseName);

  serverRPC = express();
  serverRPC.use(cors({ methods: ['POST'] }));
  serverRPC.use(bodyParser.urlencoded({ extended: true }));
  serverRPC.use(bodyParser.json());
  serverRPC.set('trust proxy', true);
  serverRPC.set('trust proxy', 'loopback');
  if (config.rpcConfig.logRequests) {
    serverRPC.use(requestLogger);
  }
  serverRPC.post('/blockchain', jayson.server(blockchainRPC()).middleware());
  serverRPC.post('/contracts', jayson.server(contractsRPC()).middleware());
  serverRPC.post('/', jayson.server(multiRPC()).middleware());
  serverRPC.get('/', async (_, res) => {
    try {
      const status = await generateStatus();
      res.json(status);
    } catch (error) {
      res.status(500);
      res.json({ error: 'Error generating status.' });
    }
  });

  server = http.createServer(serverRPC)
    .listen(rpcNodePort, () => {
      console.log(`RPC Node now listening on port ${rpcNodePort}`); // eslint-disable-line
    });


  if (rpcWebsockets.enabled) {
    const wssServer = new jayson.Server(multiRPC());

    wssServer.websocket({
      port: rpcWebsockets.port,
    });
    console.log(`Websockets RPC Node now listening on port ${rpcWebsockets.port}`); // eslint-disable-line
  }

  callback(null);
};

function stop() {
  server.close();
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
