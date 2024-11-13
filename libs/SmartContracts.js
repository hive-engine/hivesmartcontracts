/* eslint-disable max-len */

const { Decimal128 } = require('bson');
const ivm = require('isolated-vm');
const SHA256FN = require('crypto-js/sha256');
const enchex = require('crypto-js/enc-hex');
const dhive = require('@hiveio/dhive');
const { Base64 } = require('js-base64');
const BigNumber = require('bignumber.js');
const log = require('loglevel');
const validator = require('validator');
const seedrandom = require('seedrandom');
const { CONSTANTS } = require('../libs/Constants');

const RESERVED_CONTRACT_NAMES = ['contract', 'blockProduction', 'null'];
const RESERVED_ACTIONS = ['createSSC'];

const maybeDeref = (y) => typeof y === 'object' && y !== null && y.deref ? y.deref() : y;
function deepDeref(x) {
  let y = x;
  if (typeof x === "object" && x !== null) {
    Object.keys(x).forEach(k => {
        y[k] = deepDeref(y[k]);
    });
  } else if (typeof x === "array") {
    y = x.map(deepDeref);
  }
  return maybeDeref(y);
}

function deepConvertDecimal128(x) {
  let y = x;
  if (typeof x === "object" && x !== null) {
    Object.keys(x).forEach(k => {
        y[k] = deepConvertDecimal128(y[k]);
    });
  } else if (typeof x === "array") {
    y = x.map(deepConvertDecimal128);
  }
  if (y instanceof BigNumber || y instanceof Decimal128) {
    y = new ivm.Reference(y);
  }
  return y;
}

class SmartContracts {
  // deploy the smart contract to the blockchain and initialize the database if needed
  static async deploySmartContract(
    database, transaction, blockNumber, timestamp, refHiveBlockId, prevRefHiveBlockId, jsVMTimeout,
  ) {
    const { transactionId, refHiveBlockNumber, sender } = transaction;
    try {
      const payload = JSON.parse(transaction.payload);
      const { name, params, code } = payload;

      if (name && typeof name === 'string'
        && code && typeof code === 'string') {
        // the contract name has to be a string made of letters and numbers
        if (!validator.isAlphanumeric(name)
          || RESERVED_CONTRACT_NAMES.includes(name)
          || name.length < 3
          || name.length > 50) {
          return { logs: { errors: ['invalid contract name'] } };
        }

        let existingContract = null;

        existingContract = await database.findContract({ name });

        let finalSender = sender;

        // allow "HIVE_ENGINE_ACCOUNT" to update contracts owned by "null"
        if (existingContract && finalSender === CONSTANTS.HIVE_ENGINE_ACCOUNT && existingContract.owner === 'null') {
          finalSender = 'null';
        }

        if (existingContract && existingContract.owner !== finalSender) {
          return { logs: { errors: ['you are not allowed to update this contract'] } };
        }

        // this code template is used to manage the code of the smart contract
        // this way we keep control of what can be executed in a smart contract
        let codeTemplate = `
          function wrapper () {
            RegExp.prototype.constructor = function () { };
            RegExp.prototype.exec = function () {  };
            RegExp.prototype.test = function () {  };
  
            let actions = {};
  
            ###ACTIONS###
  
            const execute = async function () {
              try {
                if (api.action && typeof api.action === 'string' && typeof actions[api.action] === 'function') {
                  if (api.action !== 'createSSC') {
                    actions.createSSC = null;
                  }
                  await actions[api.action](api.payload);
                  done(null);
                } else {
                  done('invalid action');
                }
              } catch (error) {
                done(error);
              }
            }
  
            execute();
          }

          wrapper();
        `;

        // the code of the smart contarct comes as a Base64 encoded string
        codeTemplate = codeTemplate.replace('###ACTIONS###', Base64.decode(code));

        const tables = {};

        // prepare the db object that will be available in the VM
        const db = {
          // create a new table for the smart contract
          createTable: new ivm.Reference(async (tableName, indexes = [], tableParams = {}) => await SmartContracts.createTable(
            database, tables, name, tableName, indexes, tableParams,
          )),
          // add indexes for an existing table
          addIndexes: new ivm.Reference(async (tableName, indexes) => await SmartContracts.addIndexes(
            database, tables, name, tableName, indexes,
          )),
          // perform a query find on a table of the smart contract
          find: new ivm.Reference(async (table, query, limit = 1000, offset = 0, indexes = []) => new ivm.ExternalCopy(await SmartContracts.find(
            database, name, table, query, limit, offset, indexes,
          ))),
          // perform a query find on a table of an other smart contract
          findInTable: new ivm.Reference(async (contractName, table, query, limit = 1000, offset = 0, index = '', descending = false) => new ivm.ExternalCopy(await SmartContracts.find(
            database, contractName, table, query, limit, offset, index, descending,
          ))),
          // perform a query findOne on a table of the smart contract
          findOne: new ivm.Reference(async (table, query) => new ivm.ExternalCopy(await SmartContracts.findOne(database, name, table, query))),
          // perform a query findOne on a table of an other smart contract
          findOneInTable: new ivm.Reference(async (contractName, table, query) => new ivm.ExternalCopy(await SmartContracts.findOne(
            database, contractName, table, query,
          ))),
          // find the information of a contract
          findContract: new ivm.Reference(async (contractName) => new ivm.ExternalCopy(await SmartContracts.findContract(database, contractName))),
          // insert a record in the table of the smart contract
          insert: new ivm.Reference(async (table, record) => new ivm.ExternalCopy(await SmartContracts.dinsert(database, name, table, record))),
          // insert a record in the table of the smart contract
          remove: new ivm.Reference(async (table, record) => new ivm.ExternalCopy(await SmartContracts.remove(database, name, table, record))),
          // insert a record in the table of the smart contract
          update: new ivm.Reference(async (table, record, unsets = undefined) => new ivm.ExternalCopy(await SmartContracts.update(database, name, table, record, unsets))),
          // check if a table exists
          tableExists: new ivm.Reference(async (table) => await SmartContracts.tableExists(database, name, table)),
        };

        // logs used to store events or errors
        const logs = {
          errors: [],
          events: [],
        };

        const rng = seedrandom(`${prevRefHiveBlockId}${refHiveBlockId}${transactionId}`);

        // init bignumber decimal places
        BigNumber.set({ DECIMAL_PLACES: 20 });

        if (refHiveBlockNumber >= 55039841) {
          BigNumber.set({ RANGE: 500 });
        }

        const contractVersion = existingContract && existingContract.version
          ? existingContract.version
          : 1;

        // initialize the state that will be available in the VM
        const vmState = {
          api: {
            action: 'createSSC',
            payload: params ? JSON.parse(JSON.stringify(params)) : null,
            transactionId,
            blockNumber,
            refHiveBlockNumber,
            hiveBlockTimestamp: timestamp,
            contractVersion,
            BigNumber: new ivm.Reference((x) => BigNumber(x)),
            SHA256: new ivm.Reference((payloadToHash) => {
              if (typeof payloadToHash === 'string') {
                return new ivm.ExternalCopy(SHA256FN(payloadToHash).toString(enchex));
              }

              return new ivm.ExternalCopy(SHA256FN(JSON.stringify(payloadToHash)).toString(enchex));
            }),
            checkSignature: new ivm.Reference((payloadToCheck, signature, publicKey, isPayloadSHA256 = false) => {
              if ((typeof payloadToCheck !== 'string'
              && typeof payloadToCheck !== 'object')
              || typeof signature !== 'string'
              || typeof publicKey !== 'string') return false;
              try {
                const sig = dhive.Signature.fromString(signature);
                const finalPayload = typeof payloadToCheck === 'string' ? payloadToCheck : JSON.stringify(payloadToCheck);
                const payloadHash = isPayloadSHA256 === true
                  ? finalPayload
                  : SHA256FN(finalPayload).toString(enchex);
                const buffer = Buffer.from(payloadHash, 'hex');
                return dhive.PublicKey.fromString(publicKey).verify(buffer, sig);
              } catch (error) {
                return false;
              }
            }),
            random: new ivm.Reference(() => rng()),
            debug: (logmsg) => log.info(logmsg), // eslint-disable-line no-console
            // execute a smart contract from the current smart contract
            executeSmartContract: new ivm.Reference(async (
              contractName, actionName, parameters,
            ) => new ivm.ExternalCopy(await SmartContracts.executeSmartContractFromSmartContract(
              database, logs, finalSender, params, contractName, actionName,
              JSON.stringify(deepDeref(parameters)),
              blockNumber, timestamp,
              refHiveBlockNumber, refHiveBlockId, prevRefHiveBlockId, jsVMTimeout,
              name, 'createSSC', contractVersion,
            ))),
            // emit an event that will be stored in the logs
            emit: new ivm.Reference((event, data) => typeof event === 'string' && logs.events.push({ contract: name, event, data: deepDeref(data) })),
            // add an error that will be stored in the logs
            assert: new ivm.Reference((condition, error) => {
              if (!condition && typeof error === 'string') {
                logs.errors.push(error);
              }
              return new ivm.ExternalCopy(condition);
            }),
            isValidAccountName: new ivm.Reference((account) => SmartContracts.isValidAccountName(account, refHiveBlockNumber)),
          },
          db
        };

        const error = await SmartContracts.runContractCode(vmState, codeTemplate, jsVMTimeout);
        if (error) {
          if (error.name && typeof error.name === 'string'
            && error.message && typeof error.message === 'string') {
            return { logs: { errors: [`${error.name}: ${error.message}`] } };
          }

          return { logs: { errors: ['unknown error'] } };
        }

        const newContract = {
          _id: name,
          owner: finalSender,
          code: codeTemplate,
          codeHash: SHA256FN(codeTemplate).toString(enchex),
          tables,
          version: 1,
        };

        // if contract already exists, update it
        if (existingContract !== null) {
          newContract._id = existingContract._id; // eslint-disable-line no-underscore-dangle
          newContract.tables = Object.assign(existingContract.tables, newContract.tables);
          newContract.version = existingContract.version + 1;

          await database.updateContract(newContract);
        } else {
          await database.addContract(newContract);
        }
        return { executedCodeHash: newContract.codeHash, logs };
      }
      return { logs: { errors: ['parameters name and code are mandatory and they must be strings'] } };
    } catch (e) {
      log.error('ERROR DURING CONTRACT DEPLOYMENT: ', e);
      if (refHiveBlockNumber <= 83680408) { // Approximately Saturday March 16, 2024, 2 am UTC
        if (e.message.includes('Unexpected identifier')) {
          e.message = 'Unexpected identifier';
        }
        return { logs: { errors: [`${e.name}: ${e.message}`] } };
      }
      return { logs: { errors: ['A node.js error occoured during deployment'] } };
    }
  }

  // register tick action
  static async registerTick(database, transaction) {
    try {
      const { refHiveBlockNumber } = transaction;
      const payload = JSON.parse(transaction.payload);
      const { contractName, tickAction } = payload;

      const existingContract = await database.findContract({ name: contractName });
      if (!existingContract) {
        return { logs: { errors: ['contract does not exist'] } };
      }
      const contractsConfig = await database.getContractsConfig();
      const { contractTicks } = contractsConfig;
      if (contractTicks.find(t => t.contract === contractName && t.action === tickAction)) {
        return { logs: { errors: ['contract tick already registered'] } };
      }
      const newContractTick = {
        contract: contractName,
        action: tickAction,
        startRefBlock: refHiveBlockNumber + 1,
      };
      contractTicks.push(newContractTick);
      await database.updateContractsConfig(contractsConfig);
      return {
        logs: {
          errors: [],
          events: [
            {
              contract: 'contract',
              event: 'registerTick',
              data: newContractTick,
            },
          ],
        },
      };
    } catch (e) {
      return { logs: { errors: [`${e.name}: ${e.message}`] } };
    }
  }

  // execute the smart contract and perform actions on the database if needed
  static async executeSmartContract(
    database, transaction, blockNumber, timestamp, refHiveBlockId, prevRefHiveBlockId, jsVMTimeout,
  ) {
    try {
      const {
        transactionId,
        sender,
        contract,
        action,
        payload,
        refHiveBlockNumber,
      } = transaction;

      log.info('Execute smart contract ', transaction);
      if (RESERVED_ACTIONS.includes(action)) return { logs: { errors: ['you cannot trigger this action'] } };

      const payloadObj = payload ? JSON.parse(payload) : {};

      const contractInDb = await database.findContract({ name: contract });
      if (contractInDb === null) {
        return { logs: { errors: ['contract doesn\'t exist'] } };
      }

      const contractCode = contractInDb.code;
      const contractOwner = contractInDb.owner;
      const contractVersion = contractInDb.version;

      const tables = {};

      // prepare the db object that will be available in the VM
      const db = {
        // create a new table for the smart contract
        createTable: new ivm.Reference(async (tableName, indexes = [], params = {}) => await SmartContracts.createTable(
          database, tables, contract, tableName, indexes, params,
        )),
        // perform a query find on a table of the smart contract
        find: new ivm.Reference(async (table, query, limit = 1000, offset = 0, indexes = []) => new ivm.ExternalCopy(await SmartContracts.find(
          database, contract, table, query, limit, offset, indexes,
        ))),
        // perform a query find on a table of an other smart contract
        findInTable: new ivm.Reference(async (contractName, table, query, limit = 1000, offset = 0, index = '', descending = false) => new ivm.ExternalCopy(await SmartContracts.find(
          database, contractName, table, query, limit, offset, index, descending,
        ))),
        // perform a query findOne on a table of the smart contract
        findOne: new ivm.Reference(async (table, query) => new ivm.ExternalCopy(await SmartContracts.findOne(database, contract, table, query))),
        // perform a query findOne on a table of an other smart contract
        findOneInTable: new ivm.Reference(async (contractName, table, query) => new ivm.ExternalCopy(await SmartContracts.findOne(
          database, contractName, table, query,
        ))),
        // find the information of a contract
        findContract: new ivm.Reference(async (contractName) => new ivm.ExternalCopy(await SmartContracts.findContract(database, contractName))),
        // insert a record in the table of the smart contract
        insert: new ivm.Reference(async (table, record) => new ivm.ExternalCopy(await SmartContracts.insert(database, contract, table, record))),
        // insert a record in the table of the smart contract
        remove: new ivm.Reference(async (table, record) => await SmartContracts.remove(database, contract, table, record)),
        // insert a record in the table of the smart contract
        update: new ivm.Reference(async (table, record, unsets = undefined) => await SmartContracts.update(database, contract, table, record, unsets)),
        // check if a table exists
        tableExists: new ivm.Reference(async table => await SmartContracts.tableExists(database, contract, table)),
        // get block information
        getBlockInfo: new ivm.Reference(async blockNum => new ivm.ExternalCopy(await SmartContracts.getBlockInfo(database, blockNum))),
      };

      // logs used to store events or errors
      const results = {
        executedCodeHash: contractInDb.codeHash,
        logs: {
          errors: [],
          events: [],
        },
      };

      const rng = seedrandom(`${prevRefHiveBlockId}${refHiveBlockId}${transactionId}`);

      // init bignumber decimal places
      if (refHiveBlockNumber > 33719500) {
        BigNumber.set({ DECIMAL_PLACES: 20 });
      } else {
        BigNumber.set({ DECIMAL_PLACES: 3 });
      }

      if (refHiveBlockNumber >= 55039841) {
        BigNumber.set({ RANGE: 500 });
      }


      // initialize the state that will be available in the VM
      const vmState = {
        api: {
          sender,
          owner: contractOwner,
          refHiveBlockNumber,
          hiveBlockTimestamp: timestamp,
          contractVersion,
          transactionId,
          blockNumber,
          action,
          payload: JSON.parse(JSON.stringify(payloadObj)),
          BigNumber: new ivm.Reference((x) => BigNumber(x)),
          logs: new ivm.Reference(() => new ivm.ExternalCopy(JSON.parse(JSON.stringify(results.logs)))),
          random: new ivm.Reference(() => rng()),
          SHA256: new ivm.Reference((payloadToHash) => {
            if (typeof payloadToHash === 'string') {
              return new ivm.ExternalCopy(SHA256FN(payloadToHash).toString(enchex));
            }
            return new ivm.ExternalCopy(SHA256FN(JSON.stringify(payloadToHash)).toString(enchex));
          }),
          checkSignature: new ivm.Reference((payloadToCheck, signature, publicKey, isPayloadSHA256 = false) => {
            if ((typeof payloadToCheck !== 'string'
            && typeof payloadToCheck !== 'object')
            || typeof signature !== 'string'
            || typeof publicKey !== 'string') return false;
            try {
              const sig = dhive.Signature.fromString(signature);
              const finalPayload = typeof payloadToCheck === 'string' ? payloadToCheck : JSON.stringify(payloadToCheck);
              const payloadHash = isPayloadSHA256 === true
                ? finalPayload
                : SHA256FN(finalPayload).toString(enchex);
              const buffer = Buffer.from(payloadHash, 'hex');
              return dhive.PublicKey.fromString(publicKey).verify(buffer, sig);
            } catch (error) {
              return false;
            }
          }),
          debug: (logmsg) => log.info(logmsg), // eslint-disable-line no-console
          // execute a smart contract from the current smart contract
          executeSmartContract: new ivm.Reference(async (
            contractName, actionName, parameters,
          ) => new ivm.ExternalCopy(await SmartContracts.executeSmartContractFromSmartContract(
            database, results, sender, payloadObj, contractName, actionName,
            JSON.stringify(deepDeref(parameters)),
            blockNumber, timestamp,
            refHiveBlockNumber, refHiveBlockId, prevRefHiveBlockId, jsVMTimeout,
            contract, action, contractVersion,
          ))),
          // execute a smart contract from the current smart contract
          // with the contractOwner authority level
          executeSmartContractAsOwner: new ivm.Reference(async (
            contractName, actionName, parameters,
          ) => new ivm.ExternalCopy(await SmartContracts.executeSmartContractFromSmartContract(
            database, results, contractOwner, payloadObj, contractName, actionName,
            JSON.stringify(deepDeref(parameters)),
            blockNumber, timestamp,
            refHiveBlockNumber, refHiveBlockId, prevRefHiveBlockId, jsVMTimeout,
            contract, action, contractVersion,
          ))),
          // execute a token transfer from the contract balance
          transferTokens: new ivm.Reference(async (
            to, symbol, quantity, type,
          ) => new ivm.ExternalCopy(await SmartContracts.executeSmartContractFromSmartContract(
            database, results, 'null', payloadObj, 'tokens', 'transferFromContract',
            JSON.stringify({
              from: contract,
              to,
              quantity: maybeDeref(quantity),
              symbol,
              type,
            }),
            blockNumber, timestamp,
            refHiveBlockNumber, refHiveBlockId, prevRefHiveBlockId, jsVMTimeout,
            contract, action, contractVersion,
          ))),
          verifyBlock: new ivm.Reference(async (block) => {
            if (contract !== 'witnesses') return;
            await SmartContracts.verifyBlock(database, block);
          }),
          // emit an event that will be stored in the logs
          emit: new ivm.Reference((event, data) => typeof event === 'string' && results.logs.events.push({ contract, event, data: deepDeref(data) })),
          // add an error that will be stored in the logs
          assert: new ivm.Reference((condition, error) => {
            if (!condition && typeof error === 'string') {
              results.logs.errors.push(error);
            }
            return new ivm.ExternalCopy(condition);
          }),
          isValidAccountName: new ivm.Reference((account) => SmartContracts.isValidAccountName(account, refHiveBlockNumber)),
        },
        db,
      };

      // if action is called from another contract, we can add an additional function
      // to allow token transfers from the calling contract
      if ('callingContractInfo' in payloadObj) {
        vmState.api.transferTokensFromCallingContract = new ivm.Reference(async (
          to, symbol, quantity, type,
        ) => new ivm.ExternalCopy(await SmartContracts.executeSmartContractFromSmartContract(
          database, results, 'null', payloadObj, 'tokens', 'transferFromContract',
          JSON.stringify({
            from: payloadObj.callingContractInfo.name,
            to,
            quantity: maybeDeref(quantity),
            symbol,
            type,
          }),
          blockNumber, timestamp,
          refHiveBlockNumber, refHiveBlockId, prevRefHiveBlockId, jsVMTimeout,
          contract, contractVersion,
        )));
      }

      const error = await SmartContracts.runContractCode(vmState, contractCode, jsVMTimeout);

      if (error) {
        const { name, message } = error;
        if (name && typeof name === 'string'
          && message && typeof message === 'string') {
          return { logs: { errors: [`${name}: ${message}`] } };
        }

        return { logs: { errors: ['unknown error'] } };
      }

      // if new tables were created, we need to do a contract update
      if (Object.keys(tables).length > 0) {
        Object.assign(contractInDb.tables, tables);
        await database.updateContract(contractInDb);
      }
      return results;
    } catch (e) {
      log.error('ERROR DURING CONTRACT EXECUTION: ', e);
      return { logs: { errors: [`${e.name}: ${e.message}`] } };
    } finally {
      log.info('executeSmartContract done');
    }
  }

  static getJSVM(jsVMTimeout) {
    const isolate = new ivm.Isolate({ memoryLimit: 128 });
    const context = isolate.createContextSync();
    return {
      timeout: jsVMTimeout,
      context,
      isolate,
      isActive: true,
    };
  }

  // run the contractCode in a VM with the vmState as a state for the VM
  static runContractCode(vmState, contractCode, jsVMTimeout) {
    return new Promise((resolve) => {
      // run the code in the VM
      const vm = SmartContracts.getJSVM(jsVMTimeout);
      if (vm !== null) {
        vm.context.global.setSync('done', (error) => {
          vm.isActive = false;
          resolve(error);
        });
        vm.context.global.setSync('sscglobal_externalCopy', x => new ivm.ExternalCopy(x));
        Object.keys(vmState.api).forEach((key) => {
            vm.context.global.setSync('sscglobal_' + key, key === 'payload' && typeof(vmState.api[key]) === 'object' ? new ivm.ExternalCopy(vmState.api[key]) : vmState.api[key]);
            });
        Object.keys(vmState.db).forEach((key) => {
            vm.context.global.setSync('sscglobal_' + key, vmState.db[key]);
            });
        vm.context.global.setSync('sscglobalv_isAlpha', new ivm.Callback(validator.isAlpha));
        vm.context.global.setSync('sscglobalv_isAlphanumeric', new ivm.Callback(validator.isAlphanumeric));
        vm.context.global.setSync('sscglobalv_blacklist', new ivm.Callback(validator.blacklist));
        vm.context.global.setSync('sscglobalv_isUppercase', new ivm.Callback(validator.isUppercase));
        vm.context.global.setSync('sscglobalv_isIP', new ivm.Callback(validator.isIP));
        vm.context.global.setSync('sscglobalv_isFQDN', new ivm.Callback(validator.isFQDN));

        vm.context.global.setSync('sscglobal_bn_construct', new ivm.Reference((x, y) => BigNumber(maybeDeref(x))));
        vm.context.global.setSync('sscglobal_bn_plus', new ivm.Reference((x, y) => x.deref().plus(maybeDeref(y))));
        vm.context.global.setSync('sscglobal_bn_minus', new ivm.Reference((x, y) => x.deref().minus(maybeDeref(y))));
        vm.context.global.setSync('sscglobal_bn_times', new ivm.Reference((x, y) => x.deref().times(maybeDeref(y))));
        vm.context.global.setSync('sscglobal_bn_multipliedBy', new ivm.Reference((x, y, z) => x.deref().multipliedBy(maybeDeref(y), z)));
        vm.context.global.setSync('sscglobal_bn_dividedBy', new ivm.Reference((x, y, z) => x.deref().dividedBy(maybeDeref(y), z)));
        vm.context.global.setSync('sscglobal_bn_sqrt', new ivm.Reference((x) => x.deref().sqrt()));
        vm.context.global.setSync('sscglobal_bn_pow', new ivm.Reference((x, y) => x.deref().pow(maybeDeref(y))));
        vm.context.global.setSync('sscglobal_bn_negated', new ivm.Reference((x) => x.deref().negated()));
        vm.context.global.setSync('sscglobal_bn_abs', new ivm.Reference((x) => x.deref().abs()));
        vm.context.global.setSync('sscglobal_bn_lt', new ivm.Reference((x, y) => x.deref().lt(maybeDeref(y))));
        vm.context.global.setSync('sscglobal_bn_lte', new ivm.Reference((x, y) => x.deref().lte(maybeDeref(y))));
        vm.context.global.setSync('sscglobal_bn_eq', new ivm.Reference((x, y) => x.deref().eq(maybeDeref(y))));
        vm.context.global.setSync('sscglobal_bn_gt', new ivm.Reference((x, y) => x.deref().gt(maybeDeref(y))));
        vm.context.global.setSync('sscglobal_bn_gte', new ivm.Reference((x, y) => x.deref().gte(maybeDeref(y))));
        vm.context.global.setSync('sscglobal_bn_dp', new ivm.Reference((x, y, z) => x.deref().dp(y, z)));
        vm.context.global.setSync('sscglobal_bn_decimalPlaces', new ivm.Reference((x, y, z) => x.deref().decimalPlaces(y, z)));
        vm.context.global.setSync('sscglobal_bn_isNaN', new ivm.Reference((x) => x.deref().isNaN()));
        vm.context.global.setSync('sscglobal_bn_isFinite', new ivm.Reference((x) => x.deref().isFinite()));
        vm.context.global.setSync('sscglobal_bn_isInteger', new ivm.Reference((x) => x.deref().isInteger()));
        vm.context.global.setSync('sscglobal_bn_isPositive', new ivm.Reference((x) => x.deref().isPositive()));
        vm.context.global.setSync('sscglobal_bn_toFixed', new ivm.Reference((x, y, z) => x.deref().toFixed(y, z)));
        vm.context.global.setSync('sscglobal_bn_toNumber', new ivm.Reference((x) => x.deref().toNumber()));
        vm.context.global.setSync('sscglobal_bn_toString', new ivm.Reference((x) => x.deref().toString()));
        vm.context.global.setSync('sscglobal_bn_integerValue', new ivm.Reference((x, y) => x.deref().integerValue(y)));
        vm.context.global.setSync('sscglobal_bn_min', new ivm.Reference((...args) => BigNumber.min.apply(undefined, args.map(maybeDeref))));
        vm.context.global.setSync('sscglobal_bn_max', new ivm.Reference((...args) => BigNumber.max.apply(undefined, args.map(maybeDeref))));

        const wrappedCode = `
        function deepUnwrap(x) {
          let y = x;
          if (typeof x === "object" && x !== null) {
            Object.keys(x).forEach(k => {
                y[k] = deepUnwrap(y[k]);
            });
          } else if (typeof x === "array") {
            y = x.map(deepUnwrap);
          }
          return maybeUnwrap(y);
        }
        function applyWrapper(fn) {
          return async (...args) => {
            const extArgs = args.map(x => sscglobal_externalCopy(deepUnwrap(x)).copyInto());
            const result = await fn.applySyncPromise(undefined, extArgs);
            return (typeof result === 'object' && result.copy) ? await result.copy() : result;
          }
        }
        function applyWrapperSync(fn) {
          return (...args) => {
            const extArgs = args.map(x => sscglobal_externalCopy(deepUnwrap(x)).copyInto());
            const result = fn.applySync(undefined, extArgs);
            return (typeof result === 'object' && result.copy) ? result.copy() : result;
          }
        }
        function maybeUnwrap(x) {
          return typeof x === 'object' && x !== null && x.unwrap ? x.unwrap() : x;
        }
        function makeBigNumber(x) {
          return bigNumberWrapper(sscglobal_bn_construct.applySync(undefined, [maybeUnwrap(x)]));
        }
        function bigNumberWrapper(x) {
          return {
            plus: (y) => bigNumberWrapper(sscglobal_bn_plus.applySync(undefined,[x, maybeUnwrap(y)])),
            minus: (y) => bigNumberWrapper(sscglobal_bn_minus.applySync(undefined,[x, maybeUnwrap(y)])),
            times: (y) => bigNumberWrapper(sscglobal_bn_times.applySync(undefined,[x, maybeUnwrap(y)])),
            multipliedBy: (y, z) => bigNumberWrapper(sscglobal_bn_multipliedBy.applySync(undefined,[x, maybeUnwrap(y), z])),
            dividedBy: (y, z) => bigNumberWrapper(sscglobal_bn_dividedBy.applySync(undefined,[x, maybeUnwrap(y), z])),
            sqrt: () => bigNumberWrapper(sscglobal_bn_sqrt.applySync(undefined,[x])),
            pow: (y) => bigNumberWrapper(sscglobal_bn_pow.applySync(undefined,[x, maybeUnwrap(y)])),
            negated: () => bigNumberWrapper(sscglobal_bn_negated.applySync(undefined,[x])),
            abs: () => bigNumberWrapper(sscglobal_bn_abs.applySync(undefined,[x])),
            lt: (y) => sscglobal_bn_lt.applySync(undefined, [x, maybeUnwrap(y)]),
            lte: (y) => sscglobal_bn_lte.applySync(undefined, [x, maybeUnwrap(y)]),
            eq: (y) => sscglobal_bn_eq.applySync(undefined, [x, maybeUnwrap(y)]),
            gt: (y) => sscglobal_bn_gt.applySync(undefined, [x, maybeUnwrap(y)]),
            gte: (y) => sscglobal_bn_gte.applySync(undefined, [x, maybeUnwrap(y)]),
            dp: (y, z) => { const ret = sscglobal_bn_dp.applySync(undefined, [x, y, z]);
              return typeof y === 'number' ? bigNumberWrapper(ret) : ret;
            },
            decimalPlaces: (y, z) => { const ret = sscglobal_bn_decimalPlaces.applySync(undefined, [x, y, z]);
              return typeof y === 'number' ? bigNumberWrapper(ret) : ret;
            },
            isNaN: () => sscglobal_bn_isNaN.applySync(undefined, [x]),
            isFinite: () => sscglobal_bn_isFinite.applySync(undefined, [x]),
            isInteger: () => sscglobal_bn_isInteger.applySync(undefined, [x]),
            isPositive: () => sscglobal_bn_isPositive.applySync(undefined, [x]),
            toFixed: (y, z) => sscglobal_bn_toFixed.applySync(undefined, [x, y, z]),
            toNumber: () => sscglobal_bn_toNumber.applySync(undefined, [x]),
            toString: () => sscglobal_bn_toString.applySync(undefined, [x]),
            integerValue: (y) => bigNumberWrapper(sscglobal_bn_integerValue.applySync(undefined, [x, y])),
            unwrap: () => x,
            [Symbol.toPrimitive]: () => sscglobal_bn_toNumber.applySync(undefined, [x]),
          };
        }
        const api = {
          sender: typeof sscglobal_sender !== 'undefined' ? sscglobal_sender : null,
          owner: typeof sscglobal_owner !== 'undefined' ? sscglobal_owner : null,
          action: sscglobal_action,
          payload: typeof sscglobal_payload === 'object' && sscglobal_payload.copy ? sscglobal_payload.copy() : sscglobal_payload,
          transactionId: sscglobal_transactionId,
          blockNumber: sscglobal_blockNumber,
          refHiveBlockNumber: sscglobal_refHiveBlockNumber,
          hiveBlockTimestamp: sscglobal_hiveBlockTimestamp,
          contractVersion: sscglobal_contractVersion,
          db: {
            createTable: typeof sscglobal_createTable !== 'undefined' ? applyWrapper(sscglobal_createTable) : null,
            addIndexes: typeof sscglobal_addIndexes !== 'undefined' ? applyWrapper(sscglobal_addIndexes) : null,
            find: applyWrapper(sscglobal_find),
            findInTable: applyWrapper(sscglobal_findInTable),
            findOne: applyWrapper(sscglobal_findOne),
            findOneInTable: applyWrapper(sscglobal_findOneInTable),
            findContract: applyWrapper(sscglobal_findContract),
            insert: applyWrapper(sscglobal_insert),
            remove: applyWrapper(sscglobal_remove),
            update: applyWrapper(sscglobal_update),
            tableExists: applyWrapper(sscglobal_tableExists),
            getBlockInfo: typeof sscglobal_getBlockInfo !== 'undefined' ? applyWrapper(sscglobal_getBlockInfo) : null,
          },
          BigNumber: makeBigNumber,
          validator: {
            isAlpha: sscglobalv_isAlpha,
            isAlphanumeric: sscglobalv_isAlphanumeric,
            blacklist: sscglobalv_blacklist,
            isUppercase: sscglobalv_isUppercase,
            isIP: sscglobalv_isIP,
            isFQDN: sscglobalv_isFQDN,
          },
          logs: typeof sscglobal_logs !== 'undefined' ? applyWrapperSync(sscglobal_logs) : null,
          SHA256: applyWrapperSync(sscglobal_SHA256),
          checkSignature: applyWrapperSync(sscglobal_checkSignature),
          random: applyWrapperSync(sscglobal_random),
          debug: sscglobal_debug,
          executeSmartContract: applyWrapper(sscglobal_executeSmartContract),
          executeSmartContractAsOwner: typeof sscglobal_executeSmartContractAsOwner !== 'undefined' ? applyWrapper(sscglobal_executeSmartContractAsOwner) : null,
          transferTokens: typeof sscglobal_transferTokens !== 'undefined' ? applyWrapper(sscglobal_transferTokens) : null,
          transferTokensFromCallingContract: typeof sscglobal_transferTokensFromCallingContract !== 'undefined' ? applyWrapper(sscglobal_transferTokensFromCallingContract) : null,
          verifyBlock: typeof sscglobal_verifyBlock !== 'undefined' ? applyWrapper(sscglobal_verifyBlock) : null,
          emit: applyWrapper(sscglobal_emit),
          assert: (condition, message) => sscglobal_assert.applySync(undefined, [!!condition, message]).copy(),
          isValidAccountName: applyWrapperSync(sscglobal_isValidAccountName),
          };
          api.BigNumber.ROUND_UP = 0;
          api.BigNumber.ROUND_DOWN = 1;
          api.BigNumber.ROUND_CEIL = 2;
          api.BigNumber.ROUND_FLOOR = 3;
          api.BigNumber.ROUND_HALF_UP = 4;
          api.BigNumber.ROUND_HALF_DOWN = 5;
          api.BigNumber.ROUND_HALF_EVEN = 6;
          api.BigNumber.ROUND_HALF_CEIL = 7;
          api.BigNumber.ROUND_HALF_FLOOR = 8;
          api.BigNumber.min = (...args) => bigNumberWrapper(sscglobal_bn_min.applySync(undefined, args.map(maybeUnwrap)));
          api.BigNumber.max = (...args) => bigNumberWrapper(sscglobal_bn_max.applySync(undefined, args.map(maybeUnwrap)));
        ` + contractCode;
        const compiled = vm.isolate.compileScriptSync(wrappedCode);
        compiled.run(vm.context).then(() => vm.isolate.dispose());
      } else {
        resolve('no JS VM available');
      }
    });
  }

  static async executeSmartContractFromSmartContract(
    ipc, originalResults, sender, originalParameters,
    contract, action, parameters,
    blockNumber,
    timestamp,
    refHiveBlockNumber, refHiveBlockId, prevRefHiveBlockId,
    jsVMTimeout,
    callingContractName, callingContractAction, callingContractVersion,
  ) {
    if (typeof contract !== 'string' || typeof action !== 'string' || (parameters && typeof parameters !== 'string')) return null;
    if (refHiveBlockNumber >= 59377007 && contract === 'mining' && action === 'handleNftChange') return null;
    const sanitizedParams = parameters ? JSON.parse(parameters) : null;

    // check if a recipient or amountHIVEHBD
    //  or isSignedWithActiveKey  were passed initially
    if (originalParameters && originalParameters.amountHIVEHBD) {
      sanitizedParams.amountHIVEHBD = originalParameters.amountHIVEHBD;
    }

    if (originalParameters && originalParameters.recipient) {
      sanitizedParams.recipient = originalParameters.recipient;
    }

    if (originalParameters && originalParameters.isSignedWithActiveKey) {
      sanitizedParams.isSignedWithActiveKey = originalParameters.isSignedWithActiveKey;
    }

    // pass the calling contract name and calling contract version to the contract
    sanitizedParams.callingContractInfo = {
      name: callingContractName,
      action: callingContractAction,
      version: callingContractVersion,
    };

    const results = {};
    try {
      const res = await SmartContracts.executeSmartContract(
        ipc,
        {
          sender,
          contract,
          action,
          payload: JSON.stringify(sanitizedParams),
          refHiveBlockNumber,
        },
        blockNumber,
        timestamp,
        refHiveBlockId,
        prevRefHiveBlockId,
        jsVMTimeout,
      );

      if (res && res.logs && res.logs.errors !== undefined) {
        res.logs.errors.forEach((error) => {
          if (results.errors === undefined) {
            results.errors = [];
          }
          if (originalResults.logs.errors === undefined) {
            originalResults.logs.errors = []; // eslint-disable-line no-param-reassign
          }

          originalResults.logs.errors.push(error);
          results.errors.push(error);
        });
      }

      if (res && res.logs && res.logs.events !== undefined) {
        res.logs.events.forEach((event) => {
          if (results.events === undefined) {
            results.events = [];
          }
          if (originalResults.logs.events === undefined) {
            originalResults.logs.events = []; // eslint-disable-line no-param-reassign
          }

          originalResults.logs.events.push(event);
          results.events.push(event);
        });
      }

      if (res && res.executedCodeHash) {
        results.executedCodeHash = res.executedCodeHash;
        if (refHiveBlockNumber <= 83680408) {
          originalResults.executedCodeHash += res.executedCodeHash; // eslint-disable-line
        } else {
          originalResults.executedCodeHash = SHA256FN(originalResults.executedCodeHash + res.executedCodeHash).toString(enchex); // eslint-disable-line
        }
      }
    } catch (error) {
      log.warn(error);
      results.errors = [];
      results.errors.push(error);
    }
    return results;
  }

  static async verifyBlock(database, block) {
    await database.verifyBlock(block);
  }

  static isValidAccountName(value, refHiveBlockNumber) {
    if (!value) {
      // Account name should not be empty.
      return false;
    }

    if (typeof value !== 'string') {
      // Account name should be a string.
      return false;
    }

    let len = value.length;
    if (len < 3) {
      // Account name should be longer.
      return false;
    }
    if (len > 16) {
      // Account name should be shorter.
      return false;
    }

    const ref = value.split('.');
    len = ref.length;
    for (let i = 0; i < len; i += 1) {
      const label = ref[i];
      if (label.length < 3) {
        // Each account segment be longer
        return false;
      }

      if (!/^[a-z]/.test(label)) {
        // Each account segment should start with a letter.
        return false;
      }

      if (!/^[a-z0-9-]*$/.test(label)) {
        // Each account segment have only letters, digits, or dashes.
        return false;
      }

      // Hive block 74391382 is roughly Friday, April 28, 2023 early afternoon Japan time
      // Hive account names such as my--name are valid now, so need to drop
      // this validation.
      if (refHiveBlockNumber < 74391382 && /--/.test(label)) {
        // Each account segment have only one dash in a row.
        return false;
      }

      if (!/[a-z0-9]$/.test(label)) {
        // Each account segment end with a letter or digit.
        return false;
      }
    }

    return true;
  }

  static async createTable(database, tables, contractName, tableName, indexes = [], params = {}) {
    const result = await database.createTable({
      contractName,
      tableName,
      indexes,
      params,
    });

    if (result === true) {
      // add the table name to the list of table available for this contract
      const finalTableName = `${contractName}_${tableName}`;
      if (tables[finalTableName] === undefined) {
        tables[finalTableName] = { // eslint-disable-line
          size: 0,
          hash: '',
          nbIndexes: indexes.length,
          primaryKey: params.primaryKey,
        };
      }
    }
  }

  static async addIndexes(database, tables, contractName, tableName, indexes) {
    const result = await database.addIndexes({
      contractName,
      tableName,
      indexes,
    });

    if (result > 0) {
      // update the index count
      const finalTableName = `${contractName}_${tableName}`;
      if (tables[finalTableName] !== undefined) {
        // eslint-disable-next-line no-param-reassign
        tables[finalTableName].nbIndexes += result;
      }
    }
  }

  static async find(database, contractName, table, query, limit = 1000, offset = 0, indexes = []) {
    const result = await database.find({
      contract: contractName,
      table,
      query: deepDeref(query),
      limit,
      offset,
      indexes,
    });
    return typeof result === 'array' ? result.map(deepConvertDecimal128) : result;
  }

  static async findOne(database, contractName, table, query) {
    const result = await database.findOne({
      contract: contractName,
      table,
      query: deepDeref(query),
    });

    return deepConvertDecimal128(result);
  }

  static async findContract(database, contractName) {
    const contract = await database.findContract({
      name: contractName,
    });

    return contract;
  }

  static async insert(database, contractName, table, record) {
    const result = await database.insert({
      contract: contractName,
      table,
      record: deepDeref(record),
    });
    return deepConvertDecimal128(result);
  }

  static async dinsert(database, contractName, table, record) {
    const result = await database.dinsert({
      contract: contractName,
      table: `${contractName}_${table}`,
      record: deepDeref(record),
    });
    return deepConvertDecimal128(result);
  }

  static async remove(database, contractName, table, record) {
    const result = await database.remove({
      contract: contractName,
      table,
      record: deepDeref(record),
    });

    return result;
  }

  static async update(database, contractName, table, record, unsets) {
    const result = await database.update({
      contract: contractName,
      table,
      record: deepDeref(record),
      unsets,
    });

    return result;
  }

  static async tableExists(database, contractName, table) {
    const result = await database.tableExists({
      contract: contractName,
      table,
    });

    return result;
  }

  static async getBlockInfo(database, blockNumber) {
    const result = await database.getBlockInfo(blockNumber);

    return result;
  }
}

module.exports.SmartContracts = SmartContracts;
