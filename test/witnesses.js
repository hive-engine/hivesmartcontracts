/* eslint-disable */
const { fork } = require('child_process');
const assert = require('assert').strict;
const { MongoClient } = require('mongodb');
const dhive = require('@hiveio/dhive');
const SHA256 = require('crypto-js/sha256');
const enchex = require('crypto-js/enc-hex');

const { CONSTANTS } = require('../libs/Constants');
const { Database } = require('../libs/Database');
const blockchain = require('../plugins/Blockchain');
const { Transaction } = require('../libs/Transaction');
const { setupContractPayload } = require('../libs/util/contractUtil');
const { Fixture, conf } = require('../libs/util/testing/Fixture');
const { TableAsserts } = require('../libs/util/testing/TableAsserts');
const { assertError } = require('../libs/util/testing/Asserts');

const PERFORMANCE_CHECKS_ENABLED = false;

// Will replace contract locally.
const NB_WITNESSES = 5;

const signPayload = (signingKey, payload, isPayloadSHA256 = false) => {
  let payloadHash;
  if (isPayloadSHA256 === true) {
    payloadHash = payload;
  } else {
    payloadHash = typeof payload === 'string'
      ? SHA256(payload).toString(enchex)
      : SHA256(JSON.stringify(payload)).toString(enchex);
  }

  const buffer = Buffer.from(payloadHash, 'hex');

  return signingKey.sign(buffer).toString();
};

const tokensContractPayload = setupContractPayload('tokens', './contracts/tokens_minify.js');
const miningContractPayload = setupContractPayload('mining', './contracts/mining_minify.js');
const tokenfundsContractPayload = setupContractPayload('tokenfunds', './contracts/tokenfunds_minify.js');
const nftauctionContractPayload = setupContractPayload('nftauction', './contracts/nftauction_minify.js');
const inflationContractPayload = setupContractPayload('inflation', './contracts/inflation_minify.js');
const witnessesContractPayload = setupContractPayload('witnesses', './contracts/witnesses_minify.js',
  (contractCode) => contractCode.replace(/NB_TOP_WITNESSES[ ]?=[ ]?[0-9]+/, 'NB_TOP_WITNESSES = 4').replace(/MAX_ROUND_PROPOSITION_WAITING_PERIOD[ ]?=[ ]?[0-9]+/, 'MAX_ROUND_PROPOSITION_WAITING_PERIOD = 20').replace(/NB_WITNESSES_SIGNATURES_REQUIRED[ ]?=[ ]?[0-9]+/, 'NB_WITNESSES_SIGNATURES_REQUIRED = 3').replace(/WITNESS_APPROVE_EXPIRE_BLOCKS[ ]?=[ ]?[0-9e]+/, 'WITNESS_APPROVE_EXPIRE_BLOCKS = 50').replace(/numberOfTopWitnesses:[0-9]+/, 'numberOfTopWitnesses:4').replace(/numberOfWitnessSlots:[0-9]+/, 'numberOfWitnessSlots:5').replace(/maxRoundPropositionWaitingPeriod:[0-9]+/,'maxRoundPropositionWaitingPeriod:20').replace(/witnessSignaturesRequired:[0-9]+/,'witnessSignaturesRequired:3').replace(/witnessApproveExpireBlocks:[0-9e]+/,'witnessApproveExpireBlocks:50'));
const oldWitnessContractPayload = setupContractPayload('witnesses', './contracts/testing/witnesses_20240224.js',
  (contractCode) => contractCode.replace(/NB_TOP_WITNESSES = .*;/, 'NB_TOP_WITNESSES = 4;').replace(/MAX_ROUND_PROPOSITION_WAITING_PERIOD = .*;/, 'MAX_ROUND_PROPOSITION_WAITING_PERIOD = 20;').replace(/NB_WITNESSES_SIGNATURES_REQUIRED = .*;/, 'NB_WITNESSES_SIGNATURES_REQUIRED = 3;').replace(/WITNESS_APPROVE_EXPIRE_BLOCKS = .*;/, 'WITNESS_APPROVE_EXPIRE_BLOCKS = 50;'));

function addGovernanceTokenTransactions(fixture, transactions, blockNumber) {
  transactions.push(new Transaction(blockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', `{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "precision": 5, "maxSupply": "10000000", "isSignedWithActiveKey": true }`));
  transactions.push(new Transaction(blockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'enableStaking', `{ "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "unstakingCooldown": 40, "numberTransactions": 4, "isSignedWithActiveKey": true }`));
  transactions.push(new Transaction(blockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'enableDelegation', `{ "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "undelegationCooldown": 7, "isSignedWithActiveKey": true }`));
  transactions.push(new Transaction(blockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', `{ "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "quantity": "1500000", "isSignedWithActiveKey": true }`));
}

const fixture = new Fixture();
const tableAsserts = new TableAsserts(fixture);

describe('witnesses', function () {
  this.timeout(20000);

  before(async () => {
      client = await MongoClient.connect(conf.databaseURL, { useNewUrlParser: true, useUnifiedTopology: true });
      db = await client.db(conf.databaseName);
      await db.dropDatabase();
  });

  after(async () => {
      await client.close();
  });

  beforeEach(async () => {
      db = await client.db(conf.databaseName);
  });

  afterEach(async () => {
      fixture.tearDown();
      await db.dropDatabase()
  });

  it('successfully calculates witness\'s approval weight on first contract deployment', async () => {
      await fixture.setUp();

      let transactions = [];
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(oldWitnessContractPayload)));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(oldWitnessContractPayload)));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.234.123.234", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), 'vitalik', 'witnesses', 'register', `{ "IP": "123.234.123.233", "RPCPort": 7000, "P2PPort": 8000, "signingKey": "STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBabq", "enabled": false, "isSignedWithActiveKey": true }`));
      addGovernanceTokenTransactions(fixture, transactions, 32713425);
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "dan", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "vitalik", "isSignedWithActiveKey": true }`));

      let block = {
        refHiveBlockNumber: 32713425,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      assert.equal(res.totalEnabledApprovalWeight, undefined);

      // We are inputting 'NaN' into totalEnabledApprovalWeight as that's what happened when the contract was deployed on the mainnet
      res.totalEnabledApprovalWeight = 'NaN';
      await fixture.database.update({
        contract: 'witnesses',
        table: 'params',
        record : res
      });
      res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });
      assert.equal(res.totalEnabledApprovalWeight, 'NaN');


      transactions = [];
      transactions.push(new Transaction(32713426, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(32713426, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));

      block = {
        refHiveBlockNumber: 32713426,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      assert.equal(res.totalEnabledApprovalWeight, '100.00000');
  });

  it('registers witnesses', async () => {
      await fixture.setUp();

      let transactions = [];
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.255.123.254", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), 'vitalik', 'witnesses', 'register', `{ "IP": "123.255.123.253", "RPCPort": 7000, "P2PPort": 8000, "signingKey": "STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBabq", "enabled": false, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), 'bob', 'witnesses', 'register', `{ "domain": "example.com", "RPCPort": 7000, "P2PPort": 8000, "signingKey": "STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBark", "enabled": true, "isSignedWithActiveKey": true }`));

      let block = {
        refHiveBlockNumber: 37899120,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      let witnesses = res;

      assert.equal(witnesses[0].account, 'dan');
      assert.equal(witnesses[0].IP, "123.255.123.254");
      assert.equal(witnesses[0].domain, undefined);
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '0');
      assert.equal(witnesses[0].RPCPort, 5000);
      assert.equal(witnesses[0].P2PPort, 6000);
      assert.equal(witnesses[0].signingKey, 'STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR');
      assert.equal(witnesses[0].enabled, true);

      assert.equal(witnesses[1].account, 'vitalik');
      assert.equal(witnesses[1].IP, "123.255.123.253");
      assert.equal(witnesses[1].domain, undefined);
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, '0');
      assert.equal(witnesses[1].RPCPort, 7000);
      assert.equal(witnesses[1].P2PPort, 8000);
      assert.equal(witnesses[1].signingKey, 'STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBabq');
      assert.equal(witnesses[1].enabled, false);

      assert.equal(witnesses[2].account, 'bob');
      assert.equal(witnesses[2].IP, undefined);
      assert.equal(witnesses[2].domain, 'example.com');
      assert.equal(witnesses[2].approvalWeight.$numberDecimal, '0');
      assert.equal(witnesses[2].RPCPort, 7000);
      assert.equal(witnesses[2].P2PPort, 8000);
      assert.equal(witnesses[2].signingKey, 'STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBark');
      assert.equal(witnesses[2].enabled, true);

      transactions = [];

      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.255.123.123", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": false, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'vitalik', 'witnesses', 'register', `{ "domain": "example2.com", "RPCPort": 7000, "P2PPort": 8000, "signingKey": "STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBabq", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), 'bob', 'witnesses', 'register', `{ "IP": "2001:db8::1", "RPCPort": 7000, "P2PPort": 8000, "signingKey": "STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBark", "enabled": false, "isSignedWithActiveKey": true }`));

      block = {
        refHiveBlockNumber: 37899121,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      witnesses = res;

      assert.equal(witnesses[0].account, 'dan');
      assert.equal(witnesses[0].IP, "123.255.123.123");
      assert.equal(witnesses[0].domain, undefined);
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '0');
      assert.equal(witnesses[0].RPCPort, 5000);
      assert.equal(witnesses[0].P2PPort, 6000);
      assert.equal(witnesses[0].signingKey, 'STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR');
      assert.equal(witnesses[0].enabled, false);

      assert.equal(witnesses[1].account, 'vitalik');
      assert.equal(witnesses[1].IP, undefined);
      assert.equal(witnesses[1].domain, 'example2.com');
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, '0');
      assert.equal(witnesses[1].RPCPort, 7000);
      assert.equal(witnesses[1].P2PPort, 8000);
      assert.equal(witnesses[1].signingKey, 'STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBabq');
      assert.equal(witnesses[1].enabled, true);

      assert.equal(witnesses[2].account, 'bob');
      assert.equal(witnesses[2].IP, '2001:db8::1');
      assert.equal(witnesses[2].domain, undefined);
      assert.equal(witnesses[2].approvalWeight.$numberDecimal, '0');
      assert.equal(witnesses[2].RPCPort, 7000);
      assert.equal(witnesses[2].P2PPort, 8000);
      assert.equal(witnesses[2].signingKey, 'STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBark');
      assert.equal(witnesses[2].enabled, false);
  });

  it('should not register witnesses', async () => {
      await fixture.setUp();

      let transactions = [];
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), 'other', 'witnesses', 'register', `{ "IP": "2001:db8::1", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), 'otherOne', 'witnesses', 'register', `{ "domain": "example.com", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pS", "enabled": true, "isSignedWithActiveKey": true }`));

      let block = {
        refHiveBlockNumber: 37899120,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      transactions = [];
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.255.123.254", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": false }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "http://notip.com", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.255.123.254", "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.255.123.254", "RPCPort": 5000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.255.123.254", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.255.123.254", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.255.123.255", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "2001:db8::1", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pT", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.255.123.254", "domain" : "example.com", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsJbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pS", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "domain" : "example.com/", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rpmtk518dRzsR1f8Cgw52dQR1pS", "enabled": true, "isSignedWithActiveKey": true }`)); //non fqdn with trailing /
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "domain" : "https://example.com", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rpmtk518dRzsR1f8Cgw52dQR1pS", "enabled": true, "isSignedWithActiveKey": true }`)); //includes protocol
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "domain" : "example.com.", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rpmtk518dRzsR1f8Cgw52dQR1pS", "enabled": true, "isSignedWithActiveKey": true }`)); //trailing .
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "domain" : "example_", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rpmtk518dRzsR1f8Cgw52dQR1pS", "enabled": true, "isSignedWithActiveKey": true }`)); //just not a domain
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "domain" : "lol", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rpmtk518dRzsR1f8Cgw52dQR1pS", "enabled": true, "isSignedWithActiveKey": true }`)); //no tls
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "domain": "example.com", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfaMwt9rimtk518dRzsR1f8Cgw52dQR1pS", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfaMwt9rimtk518dRzsR1f8Cgw52dQR1pS", "enabled": true, "isSignedWithActiveKey": true }`));

      block = {
        refHiveBlockNumber: 37899121,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let res = await fixture.database.getLatestBlockInfo();
      let txs = res.transactions;

      TableAsserts.assertError(txs[0], 'active key required');
      TableAsserts.assertError(txs[1], 'IP is invalid');
      TableAsserts.assertError(txs[2], 'RPCPort must be an integer between 0 and 65535');
      TableAsserts.assertError(txs[3], 'P2PPort must be an integer between 0 and 65535');
      TableAsserts.assertError(txs[4], 'invalid signing key');
      TableAsserts.assertError(txs[5], 'enabled must be a boolean');
      TableAsserts.assertError(txs[6], 'a witness is already using this signing key');
      TableAsserts.assertError(txs[7], 'a witness is already using this IP/Port');
      TableAsserts.assertError(txs[8], 'both domain and ip provided');
      TableAsserts.assertError(txs[9], 'domain is invalid');
      TableAsserts.assertError(txs[10], 'domain is invalid');
      TableAsserts.assertError(txs[11], 'domain is invalid');
      TableAsserts.assertError(txs[12], 'domain is invalid');
      TableAsserts.assertError(txs[13], 'domain is invalid');
      TableAsserts.assertError(txs[14], 'a witness is already using this domain/Port');
      TableAsserts.assertError(txs[15], 'neither domain nor ip provided');

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });
      // Only the first two witness should exist.
      assert(res.length === 2);
  });

  it('approves witnesses', async () => {
      await fixture.setUp();

      let transactions = [];
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(37899125, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(37899125, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.234.123.234", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), 'vitalik', 'witnesses', 'register', `{ "IP": "123.234.123.233", "RPCPort": 7000, "P2PPort": 8000, "signingKey": "STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBabq", "enabled": false, "isSignedWithActiveKey": true }`));
      addGovernanceTokenTransactions(fixture, transactions, 32713425);
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "dan", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(32713425, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "vitalik", "isSignedWithActiveKey": true }`));

      let block = {
        refHiveBlockNumber: 32713425,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      let witnesses = res;

      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '100.00000');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "100.00000");

      res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'accounts',
        query: {
          account: CONSTANTS.HIVE_ENGINE_ACCOUNT
        }
      });

      let account = res;

      assert.equal(account.approvals, 2);
      assert.equal(account.approvalWeight, "100.00000");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'approvals',
        query: {
        }
      });

      let approvals = res;

      assert.equal(approvals[0].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[0].to, "dan");

      assert.equal(approvals[1].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[1].to, "vitalik");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      let params = res;

      assert.equal(params[0].numberOfApprovedWitnesses, 2);
      assert.equal(params[0].totalApprovalWeight, "200.00000");
      assert.equal(params[0].totalEnabledApprovalWeight, "100.00000");

      transactions = [];
      transactions.push(new Transaction(32713426, fixture.getNextTxId(), 'satoshi', 'witnesses', 'register', `{ "IP": "123.234.123.245", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pJ", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(32713426, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "ned", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "0.00001", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(32713426, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "satoshi", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(32713426, fixture.getNextTxId(), 'ned', 'witnesses', 'approve', `{ "witness": "dan", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(32713426, fixture.getNextTxId(), 'ned', 'witnesses', 'approve', `{ "witness": "satoshi", "isSignedWithActiveKey": true }`));

      block = {
        refHiveBlockNumber: 37899120,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      witnesses = res;

      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '100.00001');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "100.00000");

      assert.equal(witnesses[2].account, "satoshi");
      assert.equal(witnesses[2].approvalWeight.$numberDecimal, "100.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'accounts',
        query: {
        }
      });

      let accounts = res;

      assert.equal(accounts[0].account, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(accounts[0].approvals, 3);
      assert.equal(accounts[0].approvalWeight, "100.00000");

      assert.equal(accounts[1].account, "ned");
      assert.equal(accounts[1].approvals, 2);
      assert.equal(accounts[1].approvalWeight, "0.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'approvals',
        query: {
        }
      });

      approvals = res;

      assert.equal(approvals[0].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[0].to, "dan");

      assert.equal(approvals[1].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[1].to, "vitalik");

      assert.equal(approvals[2].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[2].to, "satoshi");

      assert.equal(approvals[3].from, "ned");
      assert.equal(approvals[3].to, "dan");

      assert.equal(approvals[4].from, "ned");
      assert.equal(approvals[4].to, "satoshi");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      params = res;

      assert.equal(params[0].numberOfApprovedWitnesses, 3);
      assert.equal(params[0].totalApprovalWeight, "300.00002");
      assert.equal(params[0].totalEnabledApprovalWeight, "200.00002");
  });

  it('disapproves witnesses', async () => {
      await fixture.setUp();

      let transactions = [];
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.234.123.233", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'vitalik', 'witnesses', 'register', `{ "IP": "123.234.123.232", "RPCPort": 7000, "P2PPort": 8000, "signingKey": "STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBabq", "enabled": false, "isSignedWithActiveKey": true }`));
      addGovernanceTokenTransactions(fixture, transactions, 37899121);
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "dan", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "vitalik", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'satoshi', 'witnesses', 'register', `{ "IP": "123.234.123.231", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pJ", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "ned", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "0.00001", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "satoshi", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'ned', 'witnesses', 'approve', `{ "witness": "dan", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899121, fixture.getNextTxId(), 'ned', 'witnesses', 'approve', `{ "witness": "satoshi", "isSignedWithActiveKey": true }`));

      let block = {
        refHiveBlockNumber: 37899121,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      transactions = [];
      transactions.push(new Transaction(37899122, fixture.getNextTxId(), 'ned', 'witnesses', 'disapprove', `{ "witness": "satoshi", "isSignedWithActiveKey": true }`));

      block = {
        refHiveBlockNumber: 37899122,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      witnesses = res;

      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '100.00001');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "100.00000");

      assert.equal(witnesses[2].account, "satoshi");
      assert.equal(witnesses[2].approvalWeight.$numberDecimal, "100.00000");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'accounts',
        query: {
        }
      });

      let accounts = res;

      assert.equal(accounts[0].account, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(accounts[0].approvals, 3);
      assert.equal(accounts[0].approvalWeight, "100.00000");

      assert.equal(accounts[1].account, "ned");
      assert.equal(accounts[1].approvals, 1);
      assert.equal(accounts[1].approvalWeight, "0.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'approvals',
        query: {
          to: "satoshi"
        }
      });

      approvals = res;

      assert.equal(approvals[0].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[0].to, "satoshi");
      assert.equal(approvals.length, 1);

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      params = res;

      assert.equal(params[0].numberOfApprovedWitnesses, 3);
      assert.equal(params[0].totalApprovalWeight, "300.00001");
      assert.equal(params[0].totalEnabledApprovalWeight, "200.00001")

      transactions = [];
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'disapprove', `{ "witness": "satoshi", "isSignedWithActiveKey": true }`));

      block = {
        refHiveBlockNumber: 37899123,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      witnesses = res;

      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '100.00001');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "100.00000");

      assert.equal(witnesses[2].account, "satoshi");
      assert.equal(witnesses[2].approvalWeight.$numberDecimal, "0.00000");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'accounts',
        query: {
        }
      });

      accounts = res;

      assert.equal(accounts[0].account, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(accounts[0].approvals, 2);
      assert.equal(accounts[0].approvalWeight, "100.00000");

      assert.equal(accounts[1].account, "ned");
      assert.equal(accounts[1].approvals, 1);
      assert.equal(accounts[1].approvalWeight, "0.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'approvals',
        query: {
          to: "satoshi"
        }
      });

      approvals = res;

      assert.equal(approvals.length, 0);

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      params = res;

      assert.equal(params[0].numberOfApprovedWitnesses, 2);
      assert.equal(params[0].totalApprovalWeight, "200.00001");
      assert.equal(params[0].totalEnabledApprovalWeight, "100.00001")
  });

  it('updates witnesses approvals when staking, unstaking, delegating and undelegating the utility token', async () => {
      await fixture.setUp();

      let transactions = [];
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), 'dan', 'witnesses', 'register', `{ "IP": "123.234.123.233", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "STM7sw22HqsXbz7D2CmJfmMwt9rimtk518dRzsR1f8Cgw52dQR1pR", "enabled": true, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), 'vitalik', 'witnesses', 'register', `{ "IP": "123.234.123.234", "RPCPort": 7000, "P2PPort": 8000, "signingKey": "STM8T4zKJuXgjLiKbp6fcsTTUtDY7afwc4XT9Xpf6uakYxwxfBabq", "enabled": false, "isSignedWithActiveKey": true }`));
      addGovernanceTokenTransactions(fixture, transactions, 37899123);
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "dan", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "vitalik", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), 'ned', 'witnesses', 'approve', `{ "witness": "dan", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899123, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "0.00001", "isSignedWithActiveKey": true }`));

      let block = {
        refHiveBlockNumber: 37899123,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      let witnesses = res;
      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '100.00001');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "100.00001");

      res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'accounts',
        query: {
          account: CONSTANTS.HIVE_ENGINE_ACCOUNT
        }
      });

      let account = res;

      assert.equal(account.approvals, 2);
      assert.equal(account.approvalWeight, "100.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'approvals',
        query: {
        }
      });

      let approvals = res;

      assert.equal(approvals[0].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[0].to, "dan");

      assert.equal(approvals[1].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[1].to, "vitalik");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      let params = res;

      assert.equal(params[0].numberOfApprovedWitnesses, 2);
      assert.equal(params[0].totalApprovalWeight, "200.00002");
      assert.equal(params[0].totalEnabledApprovalWeight, "100.00001")

      transactions = [];
      transactions.push(new Transaction(37899124, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "ned", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "1", "isSignedWithActiveKey": true }`));

      block = {
        refHiveBlockNumber: 37899124,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      witnesses = res;

      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '101.00001');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "100.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'accounts',
        query: {
        }
      });

      let accounts = res;

      assert.equal(accounts[0].account, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(accounts[0].approvals, 2);
      assert.equal(accounts[0].approvalWeight, "100.00001");

      assert.equal(accounts[1].account, "ned");
      assert.equal(accounts[1].approvals, 1);
      assert.equal(accounts[1].approvalWeight, "1.00000");

      transactions = [];
      transactions.push(new Transaction(37899125, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'delegate', `{ "to": "ned", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "2", "isSignedWithActiveKey": true }`));

      block = {
        refHiveBlockNumber: 37899125,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      witnesses = res;

      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '101.00001');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "98.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'accounts',
        query: {
        }
      });

      accounts = res;

      assert.equal(accounts[0].account, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(accounts[0].approvals, 2);
      assert.equal(accounts[0].approvalWeight, "98.00001");

      assert.equal(accounts[1].account, "ned");
      assert.equal(accounts[1].approvals, 1);
      assert.equal(accounts[1].approvalWeight, "3.00000");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'approvals',
        query: {
        }
      });

      approvals = res;

      assert.equal(approvals[0].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[0].to, "dan");

      assert.equal(approvals[1].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[1].to, "vitalik");

      assert.equal(approvals[2].from, "ned");
      assert.equal(approvals[2].to, "dan");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      params = res;

      assert.equal(params[0].numberOfApprovedWitnesses, 2);
      assert.equal(params[0].totalApprovalWeight, "199.00002");
      assert.equal(params[0].totalEnabledApprovalWeight, "101.00001");

      transactions = [];
      transactions.push(new Transaction(37899126, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'undelegate', `{ "from": "ned", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "2", "isSignedWithActiveKey": true }`));

      block = {
        refHiveBlockNumber: 37899126,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.find({
        contract: 'tokens',
        table: 'pendingUndelegations',
        query: {
        }
      });

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      witnesses = res;

      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '99.00001');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "98.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'accounts',
        query: {
        }
      });

      accounts = res;

      assert.equal(accounts[0].account, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(accounts[0].approvals, 2);
      assert.equal(accounts[0].approvalWeight, "98.00001");

      assert.equal(accounts[1].account, "ned");
      assert.equal(accounts[1].approvals, 1);
      assert.equal(accounts[1].approvalWeight, "1.00000");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'approvals',
        query: {
        }
      });

      approvals = res;

      assert.equal(approvals[0].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[0].to, "dan");

      assert.equal(approvals[1].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[1].to, "vitalik");

      assert.equal(approvals[2].from, "ned");
      assert.equal(approvals[2].to, "dan");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      params = res;

      assert.equal(params[0].numberOfApprovedWitnesses, 2);
      assert.equal(params[0].totalApprovalWeight, "197.00002");
      assert.equal(params[0].totalEnabledApprovalWeight, "99.00001");

      transactions = [];
      transactions.push(new Transaction(37899127, fixture.getNextTxId(), 'harpagon', 'whatever', 'whatever', ''));

      block = {
        refHiveBlockNumber: 37899127,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-08-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      witnesses = res;

      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '101.00001');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "100.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'accounts',
        query: {
        }
      });

      accounts = res;

      assert.equal(accounts[0].account, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(accounts[0].approvals, 2);
      assert.equal(accounts[0].approvalWeight, "100.00001");

      assert.equal(accounts[1].account, "ned");
      assert.equal(accounts[1].approvals, 1);
      assert.equal(accounts[1].approvalWeight, "1.00000");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'approvals',
        query: {
        }
      });

      approvals = res;

      assert.equal(approvals[0].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[0].to, "dan");

      assert.equal(approvals[1].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[1].to, "vitalik");

      assert.equal(approvals[2].from, "ned");
      assert.equal(approvals[2].to, "dan");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      params = res;

      assert.equal(params[0].numberOfApprovedWitnesses, 2);
      assert.equal(params[0].totalApprovalWeight, "201.00002");
      assert.equal(params[0].totalEnabledApprovalWeight, "101.00001");

      transactions = [];
      transactions.push(new Transaction(37899128, fixture.getNextTxId(), 'ned', 'tokens', 'unstake', `{ "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "1", "isSignedWithActiveKey": true }`));

      block = {
        refHiveBlockNumber: 37899128,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-08-02T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      witnesses = res;

      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '100.75001');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "100.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'accounts',
        query: {
        }
      });

      accounts = res;

      assert.equal(accounts[0].account, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(accounts[0].approvals, 2);
      assert.equal(accounts[0].approvalWeight, "100.00001");

      assert.equal(accounts[1].account, "ned");
      assert.equal(accounts[1].approvals, 1);
      assert.equal(accounts[1].approvalWeight, "0.75000");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'approvals',
        query: {
        }
      });

      approvals = res;

      assert.equal(approvals[0].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[0].to, "dan");

      assert.equal(approvals[1].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[1].to, "vitalik");

      assert.equal(approvals[2].from, "ned");
      assert.equal(approvals[2].to, "dan");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      params = res;

      assert.equal(params[0].numberOfApprovedWitnesses, 2);
      assert.equal(params[0].totalApprovalWeight, "200.75002");
      assert.equal(params[0].totalEnabledApprovalWeight, "100.75001");

      transactions = [];
      transactions.push(new Transaction(37899129, fixture.getNextTxId(), 'harpagon', 'whatever', 'whatever', ''));

      block = {
        refHiveBlockNumber: 37899129,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-10-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      witnesses = res;

      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '100.25001');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "100.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'accounts',
        query: {
        }
      });

      accounts = res;

      assert.equal(accounts[0].account, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(accounts[0].approvals, 2);
      assert.equal(accounts[0].approvalWeight, "100.00001");

      assert.equal(accounts[1].account, "ned");
      assert.equal(accounts[1].approvals, 1);
      assert.equal(accounts[1].approvalWeight, "0.25000");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'approvals',
        query: {
        }
      });

      approvals = res;

      assert.equal(approvals[0].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[0].to, "dan");

      assert.equal(approvals[1].from, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(approvals[1].to, "vitalik");

      assert.equal(approvals[2].from, "ned");
      assert.equal(approvals[2].to, "dan");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      params = res;

      assert.equal(params[0].numberOfApprovedWitnesses, 2);
      assert.equal(params[0].totalApprovalWeight, "200.25002");
      assert.equal(params[0].totalEnabledApprovalWeight, "100.25001");

      // test recalculate approvals, clear current weights
      let wit = await fixture.database.findOne({ contract: 'witnesses', table: 'witnesses', query: { 'account': 'dan' }});
      wit.approvalWeight.$numberDecimal = '0.01';
      await fixture.database.update({
        contract: 'witnesses',
        table: 'witnesses',
        record : wit
      });
      wit = await fixture.database.findOne({ contract: 'witnesses', table: 'witnesses', query: { 'account': 'vitalik' }});
      wit.approvalWeight.$numberDecimal = '0.02';
      await fixture.database.update({
        contract: 'witnesses',
        table: 'witnesses',
        record : wit
      });
      const param = await fixture.database.findOne({ contract: 'witnesses', table: 'params', query: {}});
      param.totalApprovalWeight = "0.03";
      param.totalEnabledApprovalWeight = "0.01";
      await fixture.database.update({ contract: 'witnesses', table: 'params', record: param});

      transactions = [];
      transactions.push(new Transaction(37899130, fixture.getNextTxId(), 'hive-engine', 'witnesses', 'recalculateApprovals', '{ "witness": "dan" }'));
      transactions.push(new Transaction(37899131, fixture.getNextTxId(), 'hive-engine', 'witnesses', 'recalculateApprovals', '{ "witness": "vitalik" }'));

      block = {
        refHiveBlockNumber: 37899130,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-10-01T00:00:03',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
        }
      });

      witnesses = res;

      assert.equal(witnesses[0].account, "dan");
      assert.equal(witnesses[0].approvalWeight.$numberDecimal, '100.25001');

      assert.equal(witnesses[1].account, "vitalik");
      assert.equal(witnesses[1].approvalWeight.$numberDecimal, "100.00001");

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'params',
        query: {
        }
      });

      params = res;

      assert.equal(params[0].numberOfApprovedWitnesses, 2);
      assert.equal(params[0].totalApprovalWeight, "200.25002");
      assert.equal(params[0].totalEnabledApprovalWeight, "100.25001");
  });

  it('schedules witnesses', async () => {
      await fixture.setUp();
      let transactions = [];
      transactions.push(new Transaction(37899128, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(37899128, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(37899128, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(37899128, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      addGovernanceTokenTransactions(fixture, transactions, 37899128);
      transactions.push(new Transaction(37899128, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));

      // register 100 witnesses
      for (let index = 0; index < 100; index++) {
        const witnessAccount = `witness${index}`;
        const wif = dhive.PrivateKey.fromLogin(witnessAccount, 'testnet', 'active');
        transactions.push(new Transaction(37899128, fixture.getNextTxId(), witnessAccount, 'witnesses', 'register', `{ "domain": "${witnessAccount}.com", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "${wif.createPublic('TST').toString()}", "enabled": true, "isSignedWithActiveKey": true }`));
      }

      let block = {
        refHiveBlockNumber: 37899128,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      transactions = [];
      for (let index = 0; index < 30; index++) {
        transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "witness${index + 5}", "isSignedWithActiveKey": true }`));
      }

      block = {
        refHiveBlockNumber: 99999999,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      await tableAsserts.assertNoErrorInLastBlock();

      let res = await fixture.database.find({
        contract: 'witnesses',
        table: 'schedules',
        query: {

        }
      });

      let schedule = res;
      assert.equal(schedule[0].witness, "witness5");
      assert.equal(schedule[0].blockNumber, 2 + fixture.startBlockOffset);
      assert.equal(schedule[0].round, 1);

      assert.equal(schedule[1].witness, "witness6");
      assert.equal(schedule[1].blockNumber, 3 + fixture.startBlockOffset);
      assert.equal(schedule[1].round, 1);

      assert.equal(schedule[2].witness, "witness12");
      assert.equal(schedule[2].blockNumber, 4 + fixture.startBlockOffset);
      assert.equal(schedule[2].round, 1);

      assert.equal(schedule[3].witness, "witness8");
      assert.equal(schedule[3].blockNumber, 5 + fixture.startBlockOffset);
      assert.equal(schedule[3].round, 1);

      assert.equal(schedule[4].witness, "witness7");
      assert.equal(schedule[4].blockNumber, 6 + fixture.startBlockOffset);
      assert.equal(schedule[4].round, 1);

      res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {

        }
      });

      let params = res;

console.log(res);
      assert.equal(params.totalApprovalWeight, '3000.00000');
      assert.equal(params.totalEnabledApprovalWeight, '3000.00000');
      assert.equal(params.numberOfApprovedWitnesses, 30);
      assert.equal(params.lastVerifiedBlockNumber, 1 + fixture.startBlockOffset);
      assert.equal(params.currentWitness, 'witness7');
      assert.equal(params.lastWitnesses.includes('witness7'), true);
      assert.equal(params.round, 1);
      assert.equal(params.lastBlockRound, 6 + fixture.startBlockOffset);
  });

  it('verifies a block with staked pay', async () => {
      await fixture.setUp();
      let transactions = [];
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(inflationContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      addGovernanceTokenTransactions(fixture, transactions, 37899120);
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), 'null', 'tokens', 'issueToContract', `{ "to": "witnesses", "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "1000", "isSignedWithActiveKey": true, "callingContractInfo": { "name": "mining" } }`));

      // register 100 witnesses
      for (let index = 0; index < 100; index++) {
        const witnessAccount = `witness${index}`;
        const wif = dhive.PrivateKey.fromLogin(witnessAccount, 'testnet', 'active');
        transactions.push(new Transaction(37899120, fixture.getNextTxId(), witnessAccount, 'witnesses', 'register', `{ "IP": "123.123.123.${index}", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "${wif.createPublic().toString()}", "enabled": true, "isSignedWithActiveKey": true }`));
      }

      let block = {
        refHiveBlockNumber: 37899120,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      transactions = [];
      for (let index = 0; index < 30; index++) {
        transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "witness${index + 5}", "isSignedWithActiveKey": true }`));
      }

      block = {
        refHiveBlockNumber: 99999999,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      for (let i = 1; i < NB_WITNESSES; i++) {
        transactions = [];
        // send whatever transaction;
        transactions.push(new Transaction(100000000 + i, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));
        block = {
          refHiveBlockNumber: 100000000 + i,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: `2018-06-01T00:00:0${i}`,
          transactions,
        };

        await fixture.sendBlock(block);
      }

      // Change witnesses number mid block, which will reset the schedule.
      transactions = [];
      transactions.push(new Transaction(100000005, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'updateParams', '{"numberOfTopWitnesses": 20, "numberOfWitnessSlots": 21, "witnessSignaturesRequired": 14}'));
      block = {
        refHiveBlockNumber: 100000005,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:05',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      let params = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {}
      });

      assert.equal(params.numberOfWitnessSlots, 21);
      assert.equal(params.witnessSignaturesRequired, 14);

      // generate enough blocks to get to 21
      for (let i = NB_WITNESSES + 1; i < 21; i++) {
        transactions = [];
        // send whatever transaction;
        transactions.push(new Transaction(100000000 + i, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));
        block = {
          refHiveBlockNumber: 100000000 + i,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: `2018-06-01T00:00:0${i}`,
          transactions,
        };

        await fixture.sendBlock(block);
      }

      let blockNum = params.lastVerifiedBlockNumber + 1;
      let endBlockRound = params.lastBlockRound;

      let calculatedRoundHash = '';
      // calculate round hash
      while (blockNum <= endBlockRound) {
        // get the block from the current node
        const queryRes = await fixture.database.getBlockInfo(blockNum);

        const blockFromNode = queryRes;
        if (blockFromNode !== null) {
          calculatedRoundHash = SHA256(`${calculatedRoundHash}${blockFromNode.hash}`).toString(enchex);
        }
        blockNum += 1;
      }

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'schedules',
        query: {

        }
      });

      let schedules = res;
      assert(schedules.length > 0);

      let signatures = [];
      schedules.forEach(schedule => {
        const wif = dhive.PrivateKey.fromLogin(schedule.witness, 'testnet', 'active');
        const sig = signPayload(wif, calculatedRoundHash, true)
        signatures.push([schedule.witness, sig])
      });

      let json = {
        round: 2,
        roundHash: calculatedRoundHash,
        signatures,
        isSignedWithActiveKey: true,
      };

      transactions = [];
      transactions.push(new Transaction(110000000, fixture.getNextTxId(), params.currentWitness, 'witnesses', 'proposeRound', JSON.stringify(json)));

      block = {
        refHiveBlockNumber: 110000000,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:11',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      blockNum = params.lastVerifiedBlockNumber + 1;

      // check if the blocks are now marked as verified
      let i = 0;
      while (blockNum <= endBlockRound) {
        // get the block from the current node
        const queryRes = await fixture.database.getBlockInfo(blockNum);

        const blockFromNode = queryRes;
        const wif = dhive.PrivateKey.fromLogin(blockFromNode.witness, 'testnet', 'active');
        assert.equal(blockFromNode.round, 2);
        assert.equal(blockFromNode.witness, schedules[schedules.length - 1].witness);
        assert.equal(blockFromNode.roundHash, calculatedRoundHash);
        assert.equal(blockFromNode.signingKey, wif.createPublic().toString());
        assert.equal(blockFromNode.roundSignature, signatures[signatures.length - 1][1]);
        blockNum += 1;
        i += 1;
      }

      // Ensure witness who sent round got paid (last witness)
      await tableAsserts.assertUserBalances({ account: schedules[schedules.length - 1].witness, symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL, balance: "0", stake: "0.39954306" });


      // Ensure all witnesses did not get paid
      for (i = 0; i < schedules.length - 1; i += 1) {
        await tableAsserts.assertUserBalances({ account: schedules[i].witness, symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL}); // Expecting no balance
      }
  });

  it('fails to propose round', async () => {
      await fixture.setUp();
      let transactions = [];
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(inflationContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      addGovernanceTokenTransactions(fixture, transactions, 37899120);
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), 'null', 'tokens', 'issueToContract', `{ "to": "witnesses", "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "1000", "isSignedWithActiveKey": true, "callingContractInfo": { "name": "mining" } }`));

      // register 100 witnesses
      for (let index = 0; index < 100; index++) {
        const witnessAccount = `witness${index}`;
        const wif = dhive.PrivateKey.fromLogin(witnessAccount, 'testnet', 'active');
        transactions.push(new Transaction(37899120, fixture.getNextTxId(), witnessAccount, 'witnesses', 'register', `{ "IP": "123.123.123.${index}", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "${wif.createPublic().toString()}", "enabled": true, "isSignedWithActiveKey": true }`));
      }

      let block = {
        refHiveBlockNumber: 37899120,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      transactions = [];
      for (let index = 0; index < 30; index++) {
        transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "witness${index + 5}", "isSignedWithActiveKey": true }`));
      }

      block = {
        refHiveBlockNumber: 99999999,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      for (let i = 1; i < NB_WITNESSES; i++) {
        transactions = [];
        // send whatever transaction;
        transactions.push(new Transaction(100000000 + i, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));
        block = {
          refHiveBlockNumber: 100000000 + i,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: `2018-06-01T00:00:0${i}`,
          transactions,
        };

        await fixture.sendBlock(block);
      }

      // Change witnesses number mid block, which will reset the schedule.
      transactions = [];
      transactions.push(new Transaction(100000005, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'updateParams', '{"numberOfTopWitnesses": 20, "numberOfWitnessSlots": 21, "witnessSignaturesRequired": 14}'));
      block = {
        refHiveBlockNumber: 100000005,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:05',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      let params = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {}
      });

      assert.equal(params.numberOfWitnessSlots, 21);
      assert.equal(params.witnessSignaturesRequired, 14);

      // generate enough blocks to get to 21
      for (let i = NB_WITNESSES + 1; i < 21; i++) {
        transactions = [];
        // send whatever transaction;
        transactions.push(new Transaction(100000000 + i, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));
        block = {
          refHiveBlockNumber: 100000000 + i,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: `2018-06-01T00:00:0${i}`,
          transactions,
        };

        await fixture.sendBlock(block);
      }

      let blockNum = params.lastVerifiedBlockNumber + 1;
      let endBlockRound = params.lastBlockRound;

      let calculatedRoundHash = '';
      // calculate round hash
      while (blockNum <= endBlockRound) {
        // get the block from the current node
        const queryRes = await fixture.database.getBlockInfo(blockNum);

        const blockFromNode = queryRes;
        if (blockFromNode !== null) {
          calculatedRoundHash = SHA256(`${calculatedRoundHash}${blockFromNode.hash}`).toString(enchex);
        }
        blockNum += 1;
      }

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'schedules',
        query: {

        }
      });

      let schedules = res;
      assert(schedules.length > 0);

      let signatures = [];
      schedules.forEach(schedule => {
        const wif = dhive.PrivateKey.fromLogin(schedule.witness, 'testnet', 'active');
        const sig = signPayload(wif, calculatedRoundHash, true)
        signatures.push([schedule.witness, sig])
      });

      transactions = [];
      transactions.push(new Transaction(110000001, fixture.getNextTxId(), params.currentWitness, 'witnesses', 'proposeRound', JSON.stringify({
        roundHash: calculatedRoundHash,
        signatures,
        isSignedWithActiveKey: false, // should be active
      })));
      transactions.push(new Transaction(110000002, fixture.getNextTxId(), params.currentWitness, 'witnesses', 'proposeRound', JSON.stringify({
        roundHash: 'invalid',
        signatures,
        isSignedWithActiveKey: true,
      })));
      transactions.push(new Transaction(110000003, fixture.getNextTxId(), params.currentWitness, 'witnesses', 'proposeRound', JSON.stringify({
        roundHash: calculatedRoundHash,
        signatures: 'invalid',
        isSignedWithActiveKey: true,
      })));
      transactions.push(new Transaction(110000004, fixture.getNextTxId(), params.currentWitness, 'witnesses', 'proposeRound', JSON.stringify({
        roundHash: calculatedRoundHash,
        signatures: [ ...signatures, ...signatures], // too many signatures
        isSignedWithActiveKey: true,
      })));
      transactions.push(new Transaction(110000005, fixture.getNextTxId(), 'wrongWitness', 'witnesses', 'proposeRound', JSON.stringify({
        roundHash: calculatedRoundHash,
        signatures,
        isSignedWithActiveKey: true,
      })));
      transactions.push(new Transaction(110000006, fixture.getNextTxId(), params.currentWitness, 'witnesses', 'proposeRound', JSON.stringify({
        roundHash: SHA256('wronghashdata').toString(enchex),
        signatures,
        isSignedWithActiveKey: true,
      })));

      block = {
        refHiveBlockNumber: 110000000,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:11',
        transactions,
      };

      await fixture.sendBlock(block);
 
      res = await fixture.database.getLatestBlockInfo();
      console.log(res);
      let txs = res.transactions;
      
      assertError(txs[0], 'you must use a transaction signed with your active key');
      assertError(txs[1], 'invalid round hash');
      assertError(txs[2], 'invalid signatures');
      assertError(txs[3], 'invalid signatures');
      assertError(txs[4], 'must be current witness');
      assertError(txs[5], 'round hash mismatch');
  });

  it('pays correct amount with reduced top witnesses', async () => {
      await fixture.setUp();
      let transactions = [];
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(inflationContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      addGovernanceTokenTransactions(fixture, transactions, 37899120);
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), 'null', 'tokens', 'issueToContract', `{ "to": "witnesses", "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "1000", "isSignedWithActiveKey": true, "callingContractInfo": { "name": "mining" } }`));

      // register 100 witnesses
      for (let index = 0; index < 100; index++) {
        const witnessAccount = `witness${index}`;
        const wif = dhive.PrivateKey.fromLogin(witnessAccount, 'testnet', 'active');
        transactions.push(new Transaction(37899120, fixture.getNextTxId(), witnessAccount, 'witnesses', 'register', `{ "IP": "123.123.123.${index}", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "${wif.createPublic().toString()}", "enabled": true, "isSignedWithActiveKey": true }`));
      }

      let block = {
        refHiveBlockNumber: 37899120,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      transactions = [];
      for (let index = 0; index < 30; index++) {
        transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "witness${index + 5}", "isSignedWithActiveKey": true }`));
      }

      block = {
        refHiveBlockNumber: 99999999,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      for (let i = 1; i < NB_WITNESSES; i++) {
        transactions = [];
        // send whatever transaction;
        transactions.push(new Transaction(100000000 + i, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));
        block = {
          refHiveBlockNumber: 100000000 + i,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: `2018-06-01T00:00:0${i}`,
          transactions,
        };

        await fixture.sendBlock(block);
      }

      // Change witnesses number mid block, which will reset the schedule.
      transactions = [];
      transactions.push(new Transaction(100000005, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'updateParams', '{"numberOfTopWitnesses": 19, "numberOfWitnessSlots": 20, "witnessSignaturesRequired": 12}'));
      block = {
        refHiveBlockNumber: 100000005,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:05',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      let params = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {}
      });

      assert.equal(params.numberOfWitnessSlots, 20);
      assert.equal(params.witnessSignaturesRequired, 12);

      // generate enough blocks to get to 20
      for (let i = NB_WITNESSES + 1; i < 20; i++) {
        transactions = [];
        // send whatever transaction;
        transactions.push(new Transaction(100000000 + i, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));
        block = {
          refHiveBlockNumber: 100000000 + i,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: `2018-06-01T00:00:0${i}`,
          transactions,
        };

        await fixture.sendBlock(block);
      }

      let blockNum = params.lastVerifiedBlockNumber + 1;
      let endBlockRound = params.lastBlockRound;

      let calculatedRoundHash = '';
      // calculate round hash
      while (blockNum <= endBlockRound) {
        // get the block from the current node
        const queryRes = await fixture.database.getBlockInfo(blockNum);

        const blockFromNode = queryRes;
        if (blockFromNode !== null) {
          calculatedRoundHash = SHA256(`${calculatedRoundHash}${blockFromNode.hash}`).toString(enchex);
        }
        blockNum += 1;
      }

      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'schedules',
        query: {

        }
      });

      let schedules = res;
      assert(schedules.length > 0);

      let signatures = [];
      schedules.forEach(schedule => {
        const wif = dhive.PrivateKey.fromLogin(schedule.witness, 'testnet', 'active');
        const sig = signPayload(wif, calculatedRoundHash, true)
        signatures.push([schedule.witness, sig])
      });

      let json = {
        round: 2,
        roundHash: calculatedRoundHash,
        signatures,
        isSignedWithActiveKey: true,
      };

      transactions = [];
      transactions.push(new Transaction(110000000, fixture.getNextTxId(), params.currentWitness, 'witnesses', 'proposeRound', JSON.stringify(json)));

      block = {
        refHiveBlockNumber: 110000000,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:11',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      blockNum = params.lastVerifiedBlockNumber + 1;

      // check if the blocks are now marked as verified
      let i = 0;
      while (blockNum <= endBlockRound) {
        // get the block from the current node
        const queryRes = await fixture.database.getBlockInfo(blockNum);

        const blockFromNode = queryRes;
        const wif = dhive.PrivateKey.fromLogin(blockFromNode.witness, 'testnet', 'active');
        assert.equal(blockFromNode.round, 2);
        assert.equal(blockFromNode.witness, schedules[schedules.length - 1].witness);
        assert.equal(blockFromNode.roundHash, calculatedRoundHash);
        assert.equal(blockFromNode.signingKey, wif.createPublic().toString());
        assert.equal(blockFromNode.roundSignature, signatures[signatures.length - 1][1]);
        blockNum += 1;
        i += 1;
      }

      // Ensure witness who sent round got paid (last witness)
      await tableAsserts.assertUserBalances({ account: schedules[schedules.length - 1].witness, symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL, balance: "0", stake: "0.38051720" });


      // Ensure all witnesses did not get paid
      for (i = 0; i < schedules.length - 1; i += 1) {
        await tableAsserts.assertUserBalances({ account: schedules[i].witness, symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL}); // Expecting no balance
      }
  });

  it('generates a new schedule once the current one is completed', async () => {
      await fixture.setUp();
      let transactions = [];
      let refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      addGovernanceTokenTransactions(fixture, transactions, refBlockNumber);
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));

      // register 100 witnesses
      for (let index = 0; index < 100; index++) {
        const witnessAccount = `witness${index}`;
        const wif = dhive.PrivateKey.fromLogin(witnessAccount, 'testnet', 'active');
        transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), witnessAccount, 'witnesses', 'register', `{ "IP": "123.123.123.${index}", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "${wif.createPublic().toString()}", "enabled": true, "isSignedWithActiveKey": true }`));
      }

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      for (let index = 0; index < 30; index++) {
        transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "witness${index + 5}", "isSignedWithActiveKey": true }`));
      }

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      await tableAsserts.assertNoErrorInLastBlock();

      for (let i = 1; i < NB_WITNESSES; i++) {
        transactions = [];
        // send whatever transaction;
        refBlockNumber = fixture.getNextRefBlockNumber();
        transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));
        block = {
          refHiveBlockNumber: refBlockNumber,
          refHiveBlockId: `ABCD1234`,
          prevRefHiveBlockId: `ABCD1233`,
          timestamp: `2018-06-01T00:00:0${i}`,
          transactions,
        };

        await fixture.sendBlock(block);
      }

      let params = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {}
      });

      let blockNum = params.lastVerifiedBlockNumber + 1;
      const endBlockRound = params.lastBlockRound;

      let calculatedRoundHash = '';
      // calculate round hash
      while (blockNum <= endBlockRound) {
        // get the block from the current node
        const queryRes = await fixture.database.getBlockInfo(blockNum);

        const blockFromNode = queryRes;
        if (blockFromNode !== null) {
          calculatedRoundHash = SHA256(`${calculatedRoundHash}${blockFromNode.hash}`).toString(enchex);
        }
        blockNum += 1;
      }

      const schedule = await fixture.database.find({
        contract: 'witnesses',
        table: 'schedules',
        query: {}
      });

      const signatures = [];
      schedule.forEach(scheduleItem => {
        const wif = dhive.PrivateKey.fromLogin(scheduleItem.witness, 'testnet', 'active');
        const sig = signPayload(wif, calculatedRoundHash, true)
        signatures.push([scheduleItem.witness, sig])
      });

      const json = {
        round: 1,
        roundHash: calculatedRoundHash,
        signatures,
        isSignedWithActiveKey: true,
      };

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), params.currentWitness, 'witnesses', 'proposeRound', JSON.stringify(json)));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-02T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      const newSchedule = await fixture.database.find({
        contract: 'witnesses',
        table: 'schedules',
        query: {}
      });


      assert.equal(newSchedule.length, schedule.length);
      for (let i = 0; i < newSchedule.length; i += 1) {
        assert.equal(newSchedule[i].blockNumber, schedule.length + 2 + i + fixture.startBlockOffset);
        assert.equal(newSchedule[i].round, 2);
      }
      assert(newSchedule[0].witness !== schedule[schedule.length - 1].witness);

      params = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {}
      });
console.log(params);
      assert.equal(params.totalApprovalWeight, '3000.00000');
      assert.equal(params.totalEnabledApprovalWeight, '3000.00000');
      assert.equal(params.numberOfApprovedWitnesses, 30);
      assert.equal(params.lastVerifiedBlockNumber, 6 + fixture.startBlockOffset);
      assert.equal(params.currentWitness, newSchedule[newSchedule.length - 1].witness);
      assert(params.lastWitnesses.includes(newSchedule[newSchedule.length - 1].witness));
      assert.equal(params.round, 2);
      assert.equal(params.lastBlockRound, 11 + fixture.startBlockOffset);
  });

  it('changes the current witness if it has not validated a round in time', async () => {
      await fixture.setUp();
      let transactions = [];
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      addGovernanceTokenTransactions(fixture, transactions, 37899120);
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));

      // register 100 witnesses
      for (let index = 0; index < 100; index++) {
        const witnessAccount = `witness${index}`;
        const wif = dhive.PrivateKey.fromLogin(witnessAccount, 'testnet', 'active');
        transactions.push(new Transaction(99999999, fixture.getNextTxId(), witnessAccount, 'witnesses', 'register', `{ "IP": "123.123.123.${index}", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "${wif.createPublic('TST').toString()}", "enabled": true, "isSignedWithActiveKey": true }`));
      }

      let block = {
        refHiveBlockNumber: 99999999,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      transactions = [];
      for (let index = 0; index < 30; index++) {
        transactions.push(new Transaction(100000000, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "witness${index + 5}", "isSignedWithActiveKey": true }`));
      }

      block = {
        refHiveBlockNumber: 100000000,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {

        }
      });

      let params = res;
      assert.equal(params.totalApprovalWeight, '3000.00000');
      assert.equal(params.totalEnabledApprovalWeight, '3000.00000');
      assert.equal(params.numberOfApprovedWitnesses, 30);
      assert.equal(params.lastVerifiedBlockNumber, 1 + fixture.startBlockOffset);
      assert.equal(params.currentWitness, 'witness6');
      assert.equal(params.lastWitnesses.includes('witness6'), true);
      assert.equal(params.round, 1);
      assert.equal(params.lastBlockRound, 6 + fixture.startBlockOffset);

      // generate 20 blocks
      for (let index = 30; index < 51; index++) {
        transactions = [];
        transactions.push(new Transaction(100000001 + index, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));

        block = {
          refHiveBlockNumber: 100000001 + index,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: '2018-07-14T00:02:00',
          transactions,
        };

        await fixture.sendBlock(block);
      }
 
      const changeBlock = await fixture.database.getBlockInfo(22 + fixture.startBlockOffset); // Witness changed on round 22
console.log(changeBlock);
      const vopLogs = JSON.parse(changeBlock.virtualTransactions[0].logs);
      assert.equal(JSON.stringify(vopLogs.events[1]), '{"contract":"witnesses","event":"witnessMissedRound","data":{"witness":"witness6"}}');

      res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {

        }
      });

      params = res;
      assert.equal(JSON.stringify(params), '{"_id":1,"totalApprovalWeight":"3000.00000","totalEnabledApprovalWeight":"3000.00000","numberOfApprovedWitnesses":30,"lastVerifiedBlockNumber":2,"round":1,"lastBlockRound":7,"currentWitness":"witness5","blockNumberWitnessChange":43,"lastWitnesses":["witness6","witness5"],"numberOfApprovalsPerAccount":30,"numberOfTopWitnesses":4,"numberOfWitnessSlots":5,"witnessSignaturesRequired":3,"maxRoundsMissedInARow":3,"maxRoundPropositionWaitingPeriod":20,"witnessApproveExpireBlocks":50}');

      let schedule = await fixture.database.find({
        contract: 'witnesses',
        table: 'schedules',
        query: {}
      });
      assert.equal(JSON.stringify(schedule), '[{"_id":6,"witness":"witness10","blockNumber":3,"round":1},{"_id":7,"witness":"witness8","blockNumber":4,"round":1},{"_id":8,"witness":"witness7","blockNumber":5,"round":1},{"_id":9,"witness":"witness9","blockNumber":6,"round":1},{"_id":10,"witness":"witness5","blockNumber":7,"round":1}]');
  });

  it('changes a non validating witness if round has not been validated in time and current witness has valid hash', async () => {
      await fixture.setUp();
      let transactions = [];
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      addGovernanceTokenTransactions(fixture, transactions, 37899120);
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));

      // register 100 witnesses
      for (let index = 0; index < 100; index++) {
        const witnessAccount = `witness${index}`;
        const wif = dhive.PrivateKey.fromLogin(witnessAccount, 'testnet', 'active');
        transactions.push(new Transaction(99999999, fixture.getNextTxId(), witnessAccount, 'witnesses', 'register', `{ "IP": "123.123.123.${index}", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "${wif.createPublic('TST').toString()}", "enabled": true, "isSignedWithActiveKey": true }`));
      }

      let block = {
        refHiveBlockNumber: 99999999,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      transactions = [];
      for (let index = 0; index < 30; index++) {
        transactions.push(new Transaction(100000000, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "witness${index + 5}", "isSignedWithActiveKey": true }`));
      }

      block = {
        refHiveBlockNumber: 100000000,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {

        }
      });

      let params = res;
      assert.equal(params.totalApprovalWeight, '3000.00000');
      assert.equal(params.totalEnabledApprovalWeight, '3000.00000');
      assert.equal(params.numberOfApprovedWitnesses, 30);
      assert.equal(params.lastVerifiedBlockNumber, 1 + fixture.startBlockOffset);
      assert.equal(params.currentWitness, 'witness6');
      assert.equal(params.lastWitnesses.includes('witness6'), true);
      assert.equal(params.round, 1);
      assert.equal(params.lastBlockRound, 6 + fixture.startBlockOffset);

      // generate 15 blocks
      for (let index = 30; index < 45; index++) {
        transactions = [];
        transactions.push(new Transaction(100000001 + index, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));

        block = {
          refHiveBlockNumber: 100000001 + index,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: '2018-07-14T00:02:00',
          transactions,
        };

        await fixture.sendBlock(block);
      }

      let blockNum = params.lastVerifiedBlockNumber + 1;
      let endBlockRound = params.lastBlockRound;

      let calculatedRoundHash = '';
      // calculate round hash
      while (blockNum <= endBlockRound) {
        // get the block from the current node
        const queryRes = await fixture.database.getBlockInfo(blockNum);

        const blockFromNode = queryRes;
        if (blockFromNode !== null) {
          calculatedRoundHash = SHA256(`${calculatedRoundHash}${blockFromNode.hash}`).toString(enchex);
        }
        blockNum += 1;
      }

      // current witness submits valid hash, and nobody else.
      const wif = dhive.PrivateKey.fromLogin('witness6', 'testnet', 'active');
      const sig = signPayload(wif, calculatedRoundHash, true)
      const signatures = [['witness6', sig]];

      let json = {
        round: 2,
        roundHash: calculatedRoundHash,
        signatures,
        isSignedWithActiveKey: true,
      };

      transactions = [];
      transactions.push(new Transaction(100000046, fixture.getNextTxId(), params.currentWitness, 'witnesses', 'proposeRound', JSON.stringify(json)));

      block = {
        refHiveBlockNumber: 100000046,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-07-14T00:02:03',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      let txs = res.transactions;
      assertError(txs[0], 'valid round hash but not enough signatures');

      // Generate three more blocks to change witness
      for (let index = 46; index < 50; index++) {
        transactions = [];
        transactions.push(new Transaction(100000001 + index, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));

        block = {
          refHiveBlockNumber: 100000001 + index,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: '2018-07-14T00:02:06',
          transactions,
        };

        await fixture.sendBlock(block);
      }

      const changeBlock = await fixture.database.getLatestBlockInfo();
console.log(changeBlock);
      const vopLogs = JSON.parse(changeBlock.virtualTransactions[0].logs);
      assert.equal(JSON.stringify(vopLogs.events[0]), '{"contract":"witnesses","event":"witnessChanged","data":{"removed":"witness5","added":"witness10"}}');

      res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {

        }
      });

      params = res;
      assert.equal(JSON.stringify(params), '{"_id":1,"totalApprovalWeight":"3000.00000","totalEnabledApprovalWeight":"3000.00000","numberOfApprovedWitnesses":30,"lastVerifiedBlockNumber":2,"round":1,"lastBlockRound":7,"currentWitness":"witness6","blockNumberWitnessChange":43,"lastWitnesses":["witness6"],"numberOfApprovalsPerAccount":30,"numberOfTopWitnesses":4,"numberOfWitnessSlots":5,"witnessSignaturesRequired":3,"maxRoundsMissedInARow":3,"maxRoundPropositionWaitingPeriod":20,"witnessApproveExpireBlocks":50}');

      let schedule = await fixture.database.find({
        contract: 'witnesses',
        table: 'schedules',
        query: {}
      });
      assert.equal(JSON.stringify(schedule), '[{"_id":6,"witness":"witness10","blockNumber":3,"round":1},{"_id":7,"witness":"witness8","blockNumber":4,"round":1},{"_id":8,"witness":"witness7","blockNumber":5,"round":1},{"_id":9,"witness":"witness9","blockNumber":6,"round":1},{"_id":10,"witness":"witness6","blockNumber":7,"round":1}]');
  });

  it('disables witnesses missing more than maxRoundsMissedInARow', async () => {
      await fixture.setUp();
      let transactions = [];
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      addGovernanceTokenTransactions(fixture, transactions, 37899120);
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'updateParams', '{"maxRoundsMissedInARow": 1}')); // Change max miss in a row to just 1 so we don't have to generate a ton of fake blocks

      // register 100 witnesses
      for (let index = 0; index < 100; index++) {
        const witnessAccount = `witness${index}`;
        const wif = dhive.PrivateKey.fromLogin(witnessAccount, 'testnet', 'active');
        transactions.push(new Transaction(99999999, fixture.getNextTxId(), witnessAccount, 'witnesses', 'register', `{ "IP": "123.123.123.${index}", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "${wif.createPublic('TST').toString()}", "enabled": true, "isSignedWithActiveKey": true }`));
      }

      let block = {
        refHiveBlockNumber: 99999999,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      transactions = [];
      for (let index = 0; index < 30; index++) {
        transactions.push(new Transaction(100000000, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "witness${index + 5}", "isSignedWithActiveKey": true }`));
      }

      block = {
        refHiveBlockNumber: 100000000,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {

        }
      });

      let params = res;
      assert.equal(params.totalApprovalWeight, '3000.00000');
      assert.equal(params.totalEnabledApprovalWeight, '3000.00000');
      assert.equal(params.numberOfApprovedWitnesses, 30);
      assert.equal(params.lastVerifiedBlockNumber, 1 + fixture.startBlockOffset);
      assert.equal(params.currentWitness, 'witness6');
      assert.equal(params.lastWitnesses.includes('witness6'), true);
      assert.equal(params.round, 1);
      assert.equal(params.lastBlockRound, 6 + fixture.startBlockOffset);
      assert.equal(params.maxRoundsMissedInARow, 1);

      // generate 20 blocks
      for (let index = 30; index < 51; index++) {
        transactions = [];
        transactions.push(new Transaction(100000001 + index, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));

        block = {
          refHiveBlockNumber: 100000001 + index,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: '2018-07-14T00:02:00',
          transactions,
        };

        await fixture.sendBlock(block);
      }
  
      const changeBlock = await fixture.database.getBlockInfo(22 + fixture.startBlockOffset); // Witness changed on round 22
      const vopLogs = JSON.parse(changeBlock.virtualTransactions[0].logs);
      assert.equal(JSON.stringify(vopLogs.events[1]), '{"contract":"witnesses","event":"witnessMissedRound","data":{"witness":"witness6"}}');
      assert.equal(JSON.stringify(vopLogs.events[2]), '{"contract":"witnesses","event":"witnessDisabledForMissingTooManyRoundsInARow","data":{"witness":"witness6"}}'); // Check for witness disabled log event

      // Ensure witness got disabled
      const witnessWhoShouldBeDisabled = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'witnesses',
        query: {
          account : 'witness6'
        }
      });
      assert.equal(false, witnessWhoShouldBeDisabled.enabled);

      res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {

        }
      });

      params = res;
      assert.equal(JSON.stringify(params), '{"_id":1,"totalApprovalWeight":"3000.00000","totalEnabledApprovalWeight":"2900.00000","numberOfApprovedWitnesses":30,"lastVerifiedBlockNumber":2,"round":1,"lastBlockRound":7,"currentWitness":"witness5","blockNumberWitnessChange":43,"lastWitnesses":["witness6","witness5"],"numberOfApprovalsPerAccount":30,"numberOfTopWitnesses":4,"numberOfWitnessSlots":5,"witnessSignaturesRequired":3,"maxRoundsMissedInARow":1,"maxRoundPropositionWaitingPeriod":20,"witnessApproveExpireBlocks":50}');


      let schedule = await fixture.database.find({
        contract: 'witnesses',
        table: 'schedules',
        query: {}
      });

      assert.equal(JSON.stringify(schedule), '[{"_id":6,"witness":"witness10","blockNumber":3,"round":1},{"_id":7,"witness":"witness8","blockNumber":4,"round":1},{"_id":8,"witness":"witness7","blockNumber":5,"round":1},{"_id":9,"witness":"witness9","blockNumber":6,"round":1},{"_id":10,"witness":"witness5","blockNumber":7,"round":1}]');
  });

  it('update params', async () => {
      await fixture.setUp();
      let transactions = [];
      let refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      addGovernanceTokenTransactions(fixture, transactions, refBlockNumber);
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      let params = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {}
      });

      assert.equal(JSON.stringify(params), '{"_id":1,"totalApprovalWeight":"0","totalEnabledApprovalWeight":"0","numberOfApprovedWitnesses":0,"lastVerifiedBlockNumber":0,"round":0,"lastBlockRound":0,"currentWitness":null,"blockNumberWitnessChange":0,"lastWitnesses":[],"numberOfApprovalsPerAccount":30,"numberOfTopWitnesses":4,"numberOfWitnessSlots":5,"witnessSignaturesRequired":3,"maxRoundsMissedInARow":3,"maxRoundPropositionWaitingPeriod":20,"witnessApproveExpireBlocks":50}');

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'updateParams', '{"totalApprovalWeight":"1","totalEnabledApprovalWeight":"1","numberOfApprovedWitnesses":1,"lastVerifiedBlockNumber":1,"round":1,"lastBlockRound":1,"currentWitness":"ignore","blockNumberWitnessChange":1,"lastWitnesses":["ignore"],"maxRoundPropositionWaitingPeriod":21,"maxRoundsMissedInARow":4,"numberOfApprovalsPerAccount":31,"numberOfTopWitnesses":5,"numberOfWitnessSlots":6,"witnessSignaturesRequired":16,"witnessApproveExpireBlocks":100}'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      params = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {}
      });

      const paramsString = '{"_id":1,"totalApprovalWeight":"0","totalEnabledApprovalWeight":"0","numberOfApprovedWitnesses":0,"lastVerifiedBlockNumber":0,"round":0,"lastBlockRound":0,"currentWitness":null,"blockNumberWitnessChange":0,"lastWitnesses":[],"numberOfApprovalsPerAccount":31,"numberOfTopWitnesses":5,"numberOfWitnessSlots":6,"witnessSignaturesRequired":16,"maxRoundsMissedInARow":4,"maxRoundPropositionWaitingPeriod":21,"witnessApproveExpireBlocks":100}';
      assert.equal(JSON.stringify(params), paramsString);

      // Verify 1 backup witness condition in setting
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'updateParams', '{"totalApprovalWeight":"2","totalEnabledApprovalWeight":"2","numberOfApprovedWitnesses":2,"lastVerifiedBlockNumber":2,"round":2,"lastBlockRound":2,"currentWitness":"ignore","blockNumberWitnessChange":2,"lastWitnesses":["ignore"],"maxRoundPropositionWaitingPeriod":22,"maxRoundsMissedInARow":5,"numberOfApprovalsPerAccount":32,"numberOfTopWitnesses":6,"numberOfWitnessSlots":6,"witnessSignaturesRequired":17}'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let res = await fixture.database.getLatestBlockInfo();
      let txs = res.transactions;
      assertError(txs[0], 'only 1 backup allowed');

      params = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {}
      });

      // unchanged from above
      assert.equal(JSON.stringify(params), paramsString);


      // Verify witnessApproveExpireBlocks > numberOfWitnessSlots
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'updateParams', '{"totalApprovalWeight":"1","totalEnabledApprovalWeight":"1","numberOfApprovedWitnesses":1,"lastVerifiedBlockNumber":1,"round":1,"lastBlockRound":1,"currentWitness":"ignore","blockNumberWitnessChange":1,"lastWitnesses":["ignore"],"maxRoundPropositionWaitingPeriod":21,"maxRoundsMissedInARow":4,"numberOfApprovalsPerAccount":31,"numberOfTopWitnesses":5,"numberOfWitnessSlots":6,"witnessSignaturesRequired":16,"witnessApproveExpireBlocks":1}'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      res = await fixture.database.getLatestBlockInfo();
      txs = res.transactions;
      assertError(txs[0], 'witnessApproveExpireBlocks should be greater than numberOfWitnessSlots');

      params = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {}
      });

      // unchanged from above
      assert.equal(JSON.stringify(params), paramsString);
  });

  it('expires votes', async () => {
      await fixture.setUp();
      let transactions = [];
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      addGovernanceTokenTransactions(fixture, transactions, 37899120);
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "100", "isSignedWithActiveKey": true }`));

      // register 100 witnesses
      for (let index = 0; index < 100; index++) {
        const witnessAccount = `witness${index}`;
        const wif = dhive.PrivateKey.fromLogin(witnessAccount, 'testnet', 'active');
        transactions.push(new Transaction(99999999, fixture.getNextTxId(), witnessAccount, 'witnesses', 'register', `{ "IP": "123.123.123.${index}", "RPCPort": 5000, "P2PPort": 6000, "signingKey": "${wif.createPublic('TST').toString()}", "enabled": true, "isSignedWithActiveKey": true }`));
      }

      let block = {
        refHiveBlockNumber: 99999999,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      transactions = [];
      for (let index = 0; index < 30; index++) {
        transactions.push(new Transaction(100000000, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'witnesses', 'approve', `{ "witness": "witness${index + 5}", "isSignedWithActiveKey": true }`));
      }

      block = {
        refHiveBlockNumber: 100000000,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {

        }
      });

      let params = res;
console.log(params);
      assert.equal(params.totalApprovalWeight, '3000.00000');
      assert.equal(params.totalEnabledApprovalWeight, '3000.00000');
      assert.equal(params.numberOfApprovedWitnesses, 30);
      assert.equal(params.lastVerifiedBlockNumber, 1 + fixture.startBlockOffset);
      assert.equal(params.currentWitness, 'witness6');
      assert.equal(params.lastWitnesses.includes('witness6'), true);
      assert.equal(params.round, 1);
      assert.equal(params.lastBlockRound, 6 + fixture.startBlockOffset);

      // generate 71 blocks
      for (let index = 30; index < 102; index++) {
        transactions = [];
        transactions.push(new Transaction(100000001 + index, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));

        block = {
          refHiveBlockNumber: 100000001 + index,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: '2018-07-14T00:02:00',
          transactions,
        };

        await fixture.sendBlock(block);
      }

      const expiringBlock = await fixture.database.getBlockInfo(53 + fixture.startBlockOffset); // The block with the expiring actions
      assert.equal(JSON.stringify(JSON.parse(expiringBlock.virtualTransactions[0].logs).events[30].data), '{"account":"hive-engine"}')

      let accounts = await fixture.database.find({
        contract: 'witnesses',
        table: 'accounts',
        query: {

        }
      });

      for (const approver of accounts) {
        assert.equal(approver.approvals, 0);
      }


      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {

        }
      });
      for (const witness of res) {
        assert.match(witness.approvalWeight["$numberDecimal"], /(0.0000|0)/) //Ensure all votes are gone
      }

      res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {

        }
      });
      params = res;
      assert.equal(params.totalApprovalWeight, '0.00000');
      assert.equal(params.totalEnabledApprovalWeight, '0.00000');
  });

  it('expires many votes', async () => {
      this.timeout(10000);
      await fixture.setUp();
      if (PERFORMANCE_CHECKS_ENABLED !== true) {
        console.log("Performace checks disabled; skipping");
        return;
      }
      let transactions = [];
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(37899120, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftauctionContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(witnessesContractPayload)));
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessesContractPayload)));
      addGovernanceTokenTransactions(fixture, transactions, 37899120);
      transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "10000", "isSignedWithActiveKey": true }`));

      // stake to 3000 witnesses
      for (let index = 0; index < 3000; index++) {
        const witnessAccount = `witness${index}`;
        transactions.push(new Transaction(99999999, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'stake', `{ "to": "${witnessAccount}", "symbol": "${CONSTANTS.GOVERNANCE_TOKEN_SYMBOL}", "quantity": "0.1", "isSignedWithActiveKey": true }`));
      }

      let block = {
        refHiveBlockNumber: 99999999,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      transactions = [];

       // register 3000 witnesses
       for (let index = 0; index < 3000; index++) {
        const witnessAccount = `witness${index}`;
        const wif = dhive.PrivateKey.fromLogin(witnessAccount, 'testnet', 'active');
        transactions.push(new Transaction(99999999, fixture.getNextTxId(), witnessAccount, 'witnesses', 'register', `{ "IP": "${index % 32}.${index % 64}.${index % 128}.${index % 256}", "RPCPort": ${index}, "P2PPort": ${index}, "signingKey": "${wif.createPublic('TST').toString()}", "enabled": true, "isSignedWithActiveKey": true }`));
      }
      

      block = {
        refHiveBlockNumber: 100000000,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      transactions = [];
      // approve 2999 witnesses
      for (let index = 1; index < 3000; index++) {
        transactions.push(new Transaction(100000000, fixture.getNextTxId(), `witness${index-1}`, 'witnesses', 'approve', `{ "witness": "witness${index}", "isSignedWithActiveKey": true }`));
      }

      block = {
        refHiveBlockNumber: 100000001,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {

        }
      });

      let params = res;

      assert.equal(params.totalApprovalWeight, '299.90000');
      assert.equal(params.totalEnabledApprovalWeight, '299.90000');
      assert.equal(params.numberOfApprovedWitnesses, 2999);
      assert.equal(params.lastVerifiedBlockNumber, 2 + fixture.startBlockOffset);
      assert.equal(params.currentWitness, 'witness2');
      assert.equal(params.lastWitnesses.includes('witness2'), true);
      assert.equal(params.round, 1);
      assert.equal(params.lastBlockRound, 7);

      // generate 401 blocks
      for (let index = 30; index < 432; index++) {
        transactions = [];
        transactions.push(new Transaction(100000001 + index, fixture.getNextTxId(), 'satoshi', 'whatever', 'whatever', ''));

        block = {
          refHiveBlockNumber: 100000001 + index,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: '2018-07-14T00:02:00',
          transactions,
        };

        await fixture.sendBlock(block);
      }

      const witnessChangeBlocks = [63,83,103,123,143,163,183,203,223,243,263,283,303,323,343]; //We have an extra action in these blocks for witness change
      // We should see expirations in multiple blocks
      for (let i = 54; i < 353; i++){
        let expiringBlock = await fixture.database.getBlockInfo(i + fixture.startBlockOffset);
        assert.equal(JSON.parse(expiringBlock.virtualTransactions[0].logs).events.length, witnessChangeBlocks.includes(i + fixtureStartBlockOffset) ? 21 : 20);
      }
      let expiringBlock = await fixture.database.getBlockInfo(353 + fixture.startBlockOffset);
      assert.equal(JSON.parse(expiringBlock.virtualTransactions[0].logs).events.length, 18);

      let accounts = await fixture.database.find({
        contract: 'witnesses',
        table: 'accounts',
        query: {

        }
      });

      for (const approver of accounts) {
        assert.equal(approver.approvals, 0);
      }


      res = await fixture.database.find({
        contract: 'witnesses',
        table: 'witnesses',
        query: {

        }
      });

      for (const witness of res) {
        assert.match(witness.approvalWeight["$numberDecimal"], /(0.0000|0)/) //Ensure all votes are gone
      }
      res = await fixture.database.findOne({
        contract: 'witnesses',
        table: 'params',
        query: {

        }
      });

      params = res;
      assert.equal(params.totalApprovalWeight, '0.00000');
      assert.equal(params.totalEnabledApprovalWeight, '0.00000');
  });
});
