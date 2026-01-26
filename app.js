require('dotenv').config();
const fs = require('fs-extra');
const http = require('http');
const program = require('commander');
const { fork } = require('child_process');
const { createLogger, format, transports } = require('winston');
const packagejson = require('./package.json');
const blockchain = require('./plugins/Blockchain');
const jsonRPCServer = require('./plugins/JsonRPCServer');
const streamer = require('./plugins/Streamer');
const replay = require('./plugins/Replay');
const p2p = require('./plugins/P2P');
const lightNodePlugin = require('./plugins/LightNode');

const conf = require('./config');
const { Database } = require('./libs/Database');

const logger = createLogger({
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(
          info => `${info.timestamp} ${info.level}: ${info.message}`,
        ),
      ),
    }),
    new transports.File({
      filename: 'node_app.log',
      format: format.combine(
        format.printf(
          info => `${info.timestamp} ${info.level}: ${info.message}`,
        ),
      ),
    }),
  ],
});

const plugins = {};

const jobs = new Map();
let currentJobId = 0;
let requestedPlugins = [];

const defaultRpcHealthCheck = {
  enabled: true,
  intervalMs: 15000,
  timeoutMs: 2000,
  failuresBeforeRestart: 3,
  restartDelayMs: 5000,
  stopTimeoutMs: 5000,
  killAfterMs: 10000,
  escalateAfter: 0,
  escalationWindowMs: 600000,
  escalationSignal: 'SIGTERM',
};

const getRpcHealthConfig = () => ({
  ...defaultRpcHealthCheck,
  ...(conf.rpcConfig?.healthCheck || {}),
});

// send an IPC message to a plugin with a promise in return
const send = (plugin, message) => {
  const newMessage = {
    ...message,
    to: plugin.name,
    from: 'MASTER',
    type: 'request',
  };
  currentJobId += 1;
  if (currentJobId > Number.MAX_SAFE_INTEGER) {
    currentJobId = 1;
  }
  newMessage.jobId = currentJobId;
  plugin.cp.send(newMessage);
  return new Promise((resolve) => {
    jobs.set(currentJobId, {
      message: newMessage,
      resolve,
    });
  });
};

const sendWithTimeout = (plugin, message, timeoutMs) => {
  const newMessage = {
    ...message,
    to: plugin.name,
    from: 'MASTER',
    type: 'request',
  };
  currentJobId += 1;
  if (currentJobId > Number.MAX_SAFE_INTEGER) {
    currentJobId = 1;
  }
  const jobId = currentJobId;
  newMessage.jobId = jobId;
  plugin.cp.send(newMessage);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      jobs.delete(jobId);
      resolve({ timeout: true });
    }, timeoutMs);
    jobs.set(jobId, {
      message: newMessage,
      resolve: (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      },
    });
  });
};

// function to route the IPC requests
const route = (message) => {
  // console.log(message);
  const { to, type, jobId } = message;
  if (to) {
    if (to === 'MASTER') {
      if (type && type === 'request') {
        // do something
      } else if (type && type === 'response' && jobId) {
        const job = jobs.get(jobId);
        if (job && job.resolve) {
          const { resolve } = job;
          jobs.delete(jobId);
          resolve(message);
        }
      }
    } else if (type && type === 'broadcast') {
      plugins.forEach((plugin) => {
        plugin.cp.send(message);
      });
    } else if (plugins[to]) {
      plugins[to].cp.send(message);
    } else {
      logger.error(`ROUTING ERROR: ${message}`);
    }
  }
};

const getPlugin = (plugin) => {
  if (plugins[plugin.PLUGIN_NAME]) {
    return plugins[plugin.PLUGIN_NAME];
  }

  return null;
};

const isPluginRunning = (plugin) => {
  const plg = getPlugin(plugin);
  return Boolean(plg && plg.cp && plg.cp.exitCode === null);
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let rpcHealthTimer = null;
let rpcHealthFailures = 0;
let rpcHealthProbeInFlight = false;
let rpcRestartInProgress = false;
const rpcRestartHistory = [];

const shouldEscalateRestart = (cfg) => {
  if (!cfg.escalateAfter || cfg.escalateAfter <= 0) return false;
  const now = Date.now();
  const windowMs = cfg.escalationWindowMs || defaultRpcHealthCheck.escalationWindowMs;
  rpcRestartHistory.push(now);
  while (rpcRestartHistory.length && now - rpcRestartHistory[0] > windowMs) {
    rpcRestartHistory.shift();
  }
  return rpcRestartHistory.length >= cfg.escalateAfter;
};

const probeRpcHealth = (cfg) => new Promise((resolve) => {
  const req = http.get({
    hostname: '127.0.0.1',
    port: conf.rpcNodePort,
    path: '/health',
    timeout: cfg.timeoutMs,
  }, (res) => {
    res.resume();
    resolve(res.statusCode === 200);
  });

  req.on('timeout', () => {
    req.destroy(new Error('health check timeout'));
  });
  req.on('error', () => {
    resolve(false);
  });
});

const unloadPlugin = async (plugin, options = {}) => {
  let res = null;
  const plg = getPlugin(plugin);
  if (plg) {
    logger.info(`unloading plugin ${plugin.PLUGIN_NAME}`);
    if (options.timeoutMs) {
      res = await sendWithTimeout(plg, { action: 'stop' }, options.timeoutMs);
    } else {
      res = await send(plg, { action: 'stop' });
    }
    plg.cp.kill('SIGINT');
    if (options.killAfterMs) {
      const killTimer = setTimeout(() => {
        if (plg.cp.exitCode === null) {
          plg.cp.kill('SIGKILL');
        }
      }, options.killAfterMs);
      if (killTimer.unref) killTimer.unref();
    }
  }
  return res;
};

const restartJsonRpc = async (reason) => {
  if (rpcRestartInProgress || shuttingDown) return;
  if (!requestedPlugins.includes(jsonRPCServer.PLUGIN_NAME)) return;
  const cfg = getRpcHealthConfig();
  if (shouldEscalateRestart(cfg)) {
    logger.error(`[${jsonRPCServer.PLUGIN_NAME}] escalation threshold reached; signaling ${cfg.escalationSignal}`);
    stopRpcHealthCheck();
    process.kill(process.pid, cfg.escalationSignal || 'SIGTERM');
    return;
  }
  rpcRestartInProgress = true;
  logger.warn(`[${jsonRPCServer.PLUGIN_NAME}] restarting (${reason})`);
  try {
    await unloadPlugin(jsonRPCServer, {
      timeoutMs: cfg.stopTimeoutMs,
      killAfterMs: cfg.killAfterMs,
    });
  } catch (error) {
    logger.error(`[${jsonRPCServer.PLUGIN_NAME}] restart unload error: ${error}`);
  }
  rpcHealthFailures = 0;
  await delay(cfg.restartDelayMs);
  try {
    await loadPlugin(jsonRPCServer, requestedPlugins);
  } catch (error) {
    logger.error(`[${jsonRPCServer.PLUGIN_NAME}] restart load error: ${error}`);
  }
  rpcRestartInProgress = false;
};

const startRpcHealthCheck = () => {
  const cfg = getRpcHealthConfig();
  if (!cfg.enabled || !requestedPlugins.includes(jsonRPCServer.PLUGIN_NAME)) return;
  if (rpcHealthTimer) clearInterval(rpcHealthTimer);
  rpcHealthTimer = setInterval(async () => {
    if (rpcHealthProbeInFlight || rpcRestartInProgress || shuttingDown) return;
    if (!isPluginRunning(jsonRPCServer)) return;
    rpcHealthProbeInFlight = true;
    try {
      const ok = await probeRpcHealth(cfg);
      if (!ok) {
        rpcHealthFailures += 1;
        logger.warn(`[${jsonRPCServer.PLUGIN_NAME}] health check failed (${rpcHealthFailures}/${cfg.failuresBeforeRestart})`);
        if (rpcHealthFailures >= cfg.failuresBeforeRestart) {
          await restartJsonRpc('health check failure threshold reached');
        }
      } else if (rpcHealthFailures > 0) {
        rpcHealthFailures = 0;
      }
    } finally {
      rpcHealthProbeInFlight = false;
    }
  }, cfg.intervalMs);
  if (rpcHealthTimer.unref) rpcHealthTimer.unref();
};

const stopRpcHealthCheck = () => {
  if (rpcHealthTimer) {
    clearInterval(rpcHealthTimer);
    rpcHealthTimer = null;
  }
};

const loadPlugin = (newPlugin, requestedPlugins) => {
  if (Array.isArray(requestedPlugins) && requestedPlugins.indexOf(newPlugin.PLUGIN_NAME) === -1) {
    return { payload: null };
  }
  const plugin = {};
  plugin.name = newPlugin.PLUGIN_NAME;
  plugin.cp = fork(newPlugin.PLUGIN_PATH, [], { silent: true, detached: true });
  plugin.cp.on('message', msg => route(msg));
  plugin.cp.on('error', err => logger.error(`[${newPlugin.PLUGIN_NAME}] ${err}`));
  plugin.cp.stdout.on('data', (data) => {
    logger.info(`[${newPlugin.PLUGIN_NAME}] ${data.toString()}`);
  });
  plugin.cp.stderr.on('data', (data) => {
    logger.error(`[${newPlugin.PLUGIN_NAME}] ${data.toString()}`);
  });

  plugins[newPlugin.PLUGIN_NAME] = plugin;

  return send(plugin, { action: 'init', payload: conf });
};

const stop = async () => {
  logger.info('Stopping node...');
  await unloadPlugin(jsonRPCServer);
  await unloadPlugin(p2p);
  // get the last Hive block parsed
  let res = null;
  const streamerPlugin = getPlugin(streamer);
  if (streamerPlugin) {
    res = await unloadPlugin(streamer);
  } else {
    res = await unloadPlugin(replay);
  }

  await unloadPlugin(blockchain);
  await unloadPlugin(lightNodePlugin);

  return res ? res.payload : null;
};

const saveConfig = (lastBlockParsed) => {
  logger.info('Saving config');
  const config = fs.readJSONSync('./config.json');
  config.startHiveBlock = lastBlockParsed;
  fs.writeJSONSync('./config.json', config, { spaces: 4 });
};

const stopApp = async (signal = 0) => {
  stopRpcHealthCheck();
  const lastBlockParsed = await stop();
  saveConfig(lastBlockParsed);
  // calling process.exit() won't inform parent process of signal
  process.kill(process.pid, signal);
};

// graceful app closing
let shuttingDown = false;

const gracefulShutdown = () => {
  if (shuttingDown === false) {
    shuttingDown = true;
    stopApp('SIGINT');
  }
};

const initLightNode = async () => {
  const {
    databaseURL,
    databaseName,
    lightNode,
    blocksToKeep,
    startHiveBlock,
    genesisHiveBlock,
  } = conf;
  const database = new Database();
  await database.init(databaseURL, databaseName, lightNode.enabled, blocksToKeep);

  if (!lightNode.enabled && startHiveBlock !== genesisHiveBlock) {
    // check if was previously a light node
    const wasLightNode = await database.wasLightNodeBefore();
    if (wasLightNode) {
      console.log('Looks like your database belongs to a light node. Did you forget to set lightNode.enabled = true in the config.json? Switching from a light node to a full node is not possible - you would have to do a full database restore in such a case.');
      await gracefulShutdown();
      process.exit();
    }
    return;
  }
  console.log('Initializing light node - this may take a while..');

  // cleanup old blocks / transactions for light nodes
  await database.cleanupLightNode();
};

// start streaming the Hive blockchain and produce the sidechain blocks accordingly
const start = async (requestedPlugins) => {
  await initLightNode();

  let res = await loadPlugin(blockchain, requestedPlugins);
  if (res && res.payload === null) {
    res = await loadPlugin(streamer, requestedPlugins);
    if (res && res.payload === null) {
      res = await loadPlugin(p2p, requestedPlugins);
      if (res && res.payload === null) {
        res = await loadPlugin(jsonRPCServer, requestedPlugins);
        if (res && res.payload === null) {
          res = await loadPlugin(lightNodePlugin, requestedPlugins);
        }
      }
    }
  }
};

// replay the sidechain from a blocks log file
const replayBlocksLog = async () => {
  let res = await loadPlugin(blockchain);
  if (res && res.payload === null) {
    await loadPlugin(replay);
    res = await send(getPlugin(replay),
      { action: replay.PLUGIN_ACTIONS.REPLAY_FILE });
    stopApp();
  }
};

// manage the console args
program
  .version(packagejson.version)
  .option('-r, --replay [type]', 'replay the blockchain from [file]', /^(file)$/i)
  .option('-p, --plugins <plugins>', 'which plugins to run. (Available plugins: Blockchain,Streamer,P2P,JsonRPCServer,LightNode', 'Blockchain,Streamer,P2P,JsonRPCServer,LightNode')
  .parse(process.argv);

requestedPlugins = program.plugins.split(',');
if (program.replay !== undefined) {
  replayBlocksLog();
} else {
  start(requestedPlugins).then(() => startRpcHealthCheck());
}

process.on('SIGTERM', () => {
  gracefulShutdown();
});

process.on('SIGINT', () => {
  gracefulShutdown();
});
