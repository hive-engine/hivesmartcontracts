/* eslint-disable */
const assert = require('assert').strict;
const { MongoClient } = require('mongodb');
const dhive = require('@hiveio/dhive');
const enchex = require('crypto-js/enc-hex');
const BigNumber = require('bignumber.js');

const { CONSTANTS } = require('../libs/Constants');
const { Database } = require('../libs/Database');
const blockchain = require('../plugins/Blockchain');
const { Transaction } = require('../libs/Transaction');
const { setupContractPayload } = require('../libs/util/contractUtil');
const { Fixture, conf } = require('../libs/util/testing/Fixture');
const { TableAsserts } = require('../libs/util/testing/TableAsserts');
const { assertError } = require('../libs/util/testing/Asserts');

const tokensContractPayload = setupContractPayload('tokens', './contracts/tokens_minify.js');
const tokenfundsContractPayload = setupContractPayload('tokenfunds', './contracts/tokenfunds_minify.js');
const miningContractPayload = setupContractPayload('mining', './contracts/mining_minify.js');
const witnessContractPayload = setupContractPayload('witnesses', './contracts/witnesses_minify.js');
const commentsContractPayload = setupContractPayload('comments', './contracts/comments_minify.js', (contractCode) => contractCode.replace(/POST_QUERY_LIMIT = .*;/, 'POST_QUERY_LIMIT = 1;'));

const fixture = new Fixture();
const tableAsserts = new TableAsserts(fixture);

async function setUpRewardPool(configOverride = {}) {
      let transactions = [];
      let refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(witnessContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(commentsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(commentsContractPayload)));
      
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
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "harpagon", "quantity": "4000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "TKN", "precision": 8, "maxSupply": "1000000000" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'enableStaking', '{ "symbol": "TKN", "unstakingCooldown": 7, "numberTransactions": 1, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'enableDelegation', '{ "symbol": "TKN", "undelegationCooldown": 7, "isSignedWithActiveKey": true }'));
      const config = { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 14, "downvoteRegenerationDays": 14, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": ["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, ...configOverride };
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', `{ "symbol": "TKN", "config": ${JSON.stringify(config)}, "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'issue', '{ "symbol": "TKN", "quantity": "1000", "to": "harpagon", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'stake', '{ "symbol": "TKN", "quantity": "10", "to": "voter1", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'stake', '{ "symbol": "TKN", "quantity": "10", "to": "voter2", "isSignedWithActiveKey": true }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
}

function maintenanceOp(refBlockNumber) {
    return new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "null", "author": "null", "permlink": "test", "weight": 10000 }');
}

async function forwardPostMaintenanceAndAssertIssue(timestamp, tokens) {
  let transactions, refBlockNumber, block, res, rewardPool;
  let tokensIssued = BigNumber(0);
  let verifyNumBlocks = 10;
  const initialRewardPool = await fixture.database.findOne({ contract: 'comments', table: 'rewardPools', query: { _id: 1}});
  let simulatedPendingClaims = initialRewardPool.pendingClaims;
  const timestampMillis = new Date(`${timestamp}.000Z`).getTime();
  const initialTokensContractBalance = await fixture.database.findOne({ contract: 'tokens', table: 'contractsBalances', query: { account: 'comments', symbol: 'TKN'}});
  for (let i = 0; i < verifyNumBlocks; i += 1) {
    transactions = [];
    refBlockNumber = fixture.getNextRefBlockNumber();
    transactions.push(maintenanceOp(refBlockNumber));
    block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp,
      transactions,
    };

    await fixture.sendBlock(block);
    res = await fixture.database.getLatestBlockInfo();
    await tableAsserts.assertNoErrorInLastBlock();
    if (res.transactions) {
      res.transactions.forEach(t => {
        const logs = JSON.parse(t.logs);
        if (logs) {
          const events = logs.events;
          if (events) {
            const issueContractEvent = events.find(ev => ev.event === 'issueToContract');
            if (issueContractEvent) {
              tokensIssued = tokensIssued.plus(issueContractEvent.data.quantity);
            }
          }
        }
      });
    }

    simulatedPendingClaims = BigNumber(simulatedPendingClaims).multipliedBy(1 - 3.0 / (15*24*3600)).toFixed(10, BigNumber.ROUND_DOWN);

    rewardPool = await fixture.database.findOne({ contract: 'comments', table: 'rewardPools', query: { _id: 1}});
    if (rewardPool.lastClaimDecayTimestamp >= timestampMillis) {
      break;
    }
  }

  const totalAdded = BigNumber(rewardPool.config.rewardPerInterval).times(10);
  assert.equal(tokensIssued.toFixed(), totalAdded.toFixed());
  assert.equal(rewardPool.rewardPool, totalAdded.plus(initialRewardPool.rewardPool).toFixed(8));
  assert.equal(rewardPool.pendingClaims, simulatedPendingClaims);
  const tokensContractBalance = await fixture.database.findOne({ contract: 'tokens', table: 'contractsBalances', query: { account: 'comments', symbol: 'TKN'}});
  assert.equal(tokensContractBalance.balance, totalAdded.plus(initialTokensContractBalance ? initialTokensContractBalance.balance : 0).toFixed(8));

  // fast forward chain (make sure contract has enough also)
  rewardPool.lastClaimDecayTimestamp = timestampMillis;
  rewardPool.lastRewardTimestamp = timestampMillis;
  rewardPool.rewardPool = tokens;
  await fixture.database.update({ contract: 'comments', table: 'rewardPools', record: rewardPool });
  tokensContractBalance.balance = tokens;
  await fixture.database.update({ contract: 'tokens', table: 'contractsBalances', record: tokensContractBalance });
}

async function assertPool(pool) {
  const { _id } = pool;
  const res = await fixture.database.findOne({
      contract: 'comments',
      table: 'rewardPools',
      query: {
        _id,
      }
    });
  assert.ok(res, `Pool ${_id} not found.`);

  let error = false;
  Object.keys(pool).forEach(k => {
    if (k !== 'config' && res[k] !== pool[k]) {
      error = true;
      console.log(`Pool ${_id} has ${k} ${res[k]}, expected ${pool[k]}`);
    }
  });
  Object.keys(pool.config).forEach(k => {
    if (k !== 'config' && JSON.stringify(res.config[k]) !== JSON.stringify(pool.config[k])) {
      error = true;
      console.log(`Pool ${_id} has config ${k} ${res.config[k]}, expected ${pool.config[k]}`);
    }
  });

  assert(!error, 'Mismatch fields in pool');
}

async function runBeneficiaryTest(options) {
  await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "1", appTaxConfig: options.appTaxConfig});

  let transactions;
  let refBlockNumber;
  let block;

  transactions = [];
  refBlockNumber = fixture.getNextRefBlockNumber();
  transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', JSON.stringify({ "author": "author1", "permlink": "test1", "jsonMetadata": { "tags": ["scottest"], "app": (options.appTaxExempt ? "neoxiancity/v1.1" : "hive.blog/v1.0") }})));
  transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'commentOptions', '{ "author": "author1", "permlink": "test1", "maxAcceptedPayout": "1000000.000 HBD", "beneficiaries": [{"account": "bene1", "weight": 5000}, {"account": "bene2", "weight": 1}]}'));
  transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));
  if (options.muteAll) {
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setMute', '{ "rewardPoolId": 1, "account": "author1", "mute": true, "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setMute', '{ "rewardPoolId": 1, "account": "voter1", "mute": true, "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setMute', '{ "rewardPoolId": 1, "account": "bene1", "mute": true, "isSignedWithActiveKey": true }'));
  }
  transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setMute', '{ "rewardPoolId": 1, "account": "voter2", "mute": true, "isSignedWithActiveKey": true }'));
  transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter2", "author": "author1", "permlink": "test1", "weight": 10000 }'));

  block = {
    refHiveBlockNumber: refBlockNumber,
    refHiveBlockId: 'ABCD1',
    prevRefHiveBlockId: 'ABCD2',
    timestamp: '2018-06-01T00:00:00',
    transactions,
  };

  await fixture.sendBlock(block);
  await tableAsserts.assertNoErrorInLastBlock();
  let res = await fixture.database.getLatestBlockInfo();
  assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
  assert.equal(JSON.stringify(JSON.parse(res.transactions.find(t => JSON.parse(t.payload).voter === 'voter2').logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"0","mute":true}}');
  const mutedVote = await fixture.database.findOne({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: '@author1/test1', voter: 'voter2' }});
  assert.equal(JSON.stringify(mutedVote), '{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter2"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":10000,"rshares":"0","curationWeight":"0","timestamp":1527811200000,"voter":"voter2"}');

  let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
  assert.equal(JSON.stringify(post), JSON.stringify({"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"10.0000000000","app":(options.appTaxExempt ? "neoxiancity" : "hive.blog"),"beneficiaries":[{"account":"bene1","weight":5000},{"account":"bene2","weight":1}],"declinePayout":false}));

  // catch up post maintenance
  await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");
  await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302398.50000000","lastRewardTimestamp":1528415997000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"9.9997685205","active":true,"intervalPendingClaims":"9.9997685205","intervalRewardPool":"15.00000000"});

  // forward clock past payout time
  transactions = [];
  refBlockNumber = fixture.getNextRefBlockNumber();
  // this transaction pays out with maintenance op
  transactions.push(maintenanceOp(refBlockNumber));

  block = {
    refHiveBlockNumber: refBlockNumber,
    refHiveBlockId: 'ABCD1',
    prevRefHiveBlockId: 'ABCD2',
    timestamp: '2018-06-08T00:00:00',
    transactions,
  };

  await fixture.sendBlock(block);
  res = await fixture.database.getLatestBlockInfo();
  await tableAsserts.assertNoErrorInLastBlock();

  addMute = (rewardLog) => {
      if (options.muteAll) {
          rewardLog.data.mute = true;
      }
      return JSON.stringify(rewardLog);
  };
  const hasAppTax = options.appTaxConfig && !options.appTaxExempt;
  let expectedReward = {
    "author1": "37792.92115529",
    "bene1": "37800.48125153",
    "bene2": "7.56009625",
    "voter1": "75600.96250306",
  };
  if (hasAppTax && options.appTaxConfig.percent === 50) {
    expectedReward = {
      "author1": "18896.46057765",
      "bene1": "18900.24062577",
      "bene2": "3.78004812",
      "appTax": "37800.48125153",
    };
  } else if (hasAppTax && options.appTaxConfig.percent === 100) {
    expectedReward = {
      "author1": "0.00000000",
      "bene1": "0.00000000",
      "bene2": "0.00000000",
      "appTax": "75600.96250307",
    };
  }
  assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1')), addMute({"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":expectedReward["author1"]}}));
  assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'beneficiaryReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'bene1')), addMute({"contract":"comments","event":"beneficiaryReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"bene1","quantity":expectedReward["bene1"]}}));
  assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'beneficiaryReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'bene2')), JSON.stringify({"contract":"comments","event":"beneficiaryReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"bene2","quantity":expectedReward["bene2"]}}));
  assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter1')), addMute({"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"voter1","quantity":"75600.96250306"}}));
  assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter2'), undefined);
  if (hasAppTax) {
    assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'appTax' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'neoxianburn')), JSON.stringify({"contract":"comments","event":"appTax","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"neoxianburn","quantity": expectedReward["appTax"]}}));
  }

  post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
  assert.equal(post, null);

  const balanceForOptions = (bal) => {
      if (hasAppTax && options.appTaxConfig.percent === 50) {
          if (bal.account === 'author1') {
              bal.balance = "9448.23028883";
              bal.stake = "9448.23028882";
          } else if (bal.account === 'bene1') {
              bal.balance = "9450.12031289";
              bal.stake = "9450.12031288";
          } else if (bal.account === 'bene2') {
              bal.balance = "1.89002406";
              bal.stake = "1.89002406";
          } else if (bal.account === 'neoxianburn') {
              bal.balance = "37800.48125153";
              bal.stake = 0;
          }
      } else if (hasAppTax && options.appTaxConfig.percent === 100) {
          if (bal.account === 'author1') {
              bal.balance = null;
              bal.stake = null;
          } else if (bal.account === 'bene1') {
              bal.balance = null;
              bal.stake = null;
          } else if (bal.account === 'bene2') {
              bal.balance = null;
              bal.stake = null;
          } else if (bal.account === 'neoxianburn') {
              bal.balance = "75600.96250307";
              bal.stake = 0;
          }
      }
      if (options.muteAll) {
          if (bal.account === 'voter1') {
              bal.balance = '0';
              bal.stake = '10.00000000';
          } else if (bal.account !== 'bene2') {
              bal.balance = null;
              bal.stake = null;
          }
      }

      return bal;
  }
  await tableAsserts.assertUserBalances(balanceForOptions({account: "author1", symbol: "TKN", balance: "18896.46057765", stake: "18896.46057764"}));
  await tableAsserts.assertUserBalances(balanceForOptions({account: "bene1", symbol: "TKN", balance: "18900.24062577", stake: "18900.24062576"}));
  await tableAsserts.assertUserBalances(balanceForOptions({account: "bene2", symbol: "TKN", balance: "3.78004813", stake: "3.78004812"}));
  await tableAsserts.assertUserBalances(balanceForOptions({account: "voter1", symbol: "TKN", balance: "37800.48125153", stake: "37810.48125153"}));
  await tableAsserts.assertUserBalances({account: "voter2", symbol: "TKN", balance: '0', stake: '10.00000000'});
  if (hasAppTax) {
    await tableAsserts.assertUserBalances(balanceForOptions({account: "neoxianburn", symbol: "TKN", balance: "37800.48125153", stake: 0}));
  }
}

describe('comments', function () {
  this.timeout(10000);

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

  it('should create reward pool', async () => {
      await fixture.setUp();

      let transactions = [];
      let refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(commentsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "harpagon", "quantity": "3000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "TKN", "precision": 8, "maxSupply": "1000000000" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'enableStaking', '{ "symbol": "TKN", "unstakingCooldown": 7, "numberTransactions": 1, "isSignedWithActiveKey": true }'));


      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      
      await tableAsserts.assertUserBalances({account: "harpagon", symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL, balance: "1900.00000000", stake: "0"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false}, "isSignedWithActiveKey": true }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      // fee paid
      await tableAsserts.assertUserBalances({account: "harpagon", symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL, balance: "900.00000000", stake: "0"});

      const hiveEngineBeeBalance = await fixture.database.findOne({
        contract: 'tokens',
        table: 'balances',
        query: {
          account: CONSTANTS.HIVE_ENGINE_ACCOUNT,
          symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL,
        },
      });

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'comments', 'createRewardPool', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false}, "isSignedWithActiveKey": true }`));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      // fee not paid
      await tableAsserts.assertUserBalances({account: CONSTANTS.HIVE_ENGINE_ACCOUNT, symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL, balance: hiveEngineBeeBalance.balance, stake: "0"});
  });

  it('should not create reward pool', async () => {
      await fixture.setUp();

      let transactions = [];
      let refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(commentsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "harpagon", "quantity": "4000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "TKN", "precision": 8, "maxSupply": "1000000000" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'enableStaking', '{ "symbol": "TKN", "unstakingCooldown": 7, "numberTransactions": 1, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "NOSTAKE", "precision": 8, "maxSupply": "1000000000" }'));


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
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "NOTKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": "badconfig", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "none", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "0", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "2.1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1.001", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": 1.01, "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "none", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.4", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "1.1", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.602", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": 0.6, "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": "7", "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 0, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 31, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": 1.5, "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "0.000000001", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "0", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": "5", "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 0, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 31, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": "5", "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 0, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 31, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": "50", "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": -1, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 101, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": "200", "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 0, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 10001, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": "2000","tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 0,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 10001,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'satoshi', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "satoshi", "quantity": "1000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'satoshi', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "NOSTAKE", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": "invalid", "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [1], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["1", "2", "3", "4", "5", "6"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": "3", "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 2, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 100000, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": 0, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": 1 }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "appTaxConfig": "invalid" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "appTaxConfig": { "app": "", "percent": 50, "beneficiary": "neoxianburn" } }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "appTaxConfig": { "app": "neoxiancity", "percent": -1, "beneficiary": "neoxianburn" } }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "appTaxConfig": { "app": "neoxiancity", "percent": 50, "beneficiary": "" } }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "excludeTags": "invalid" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "excludeTags": [] }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "excludeTags": [1, 2] }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "excludeTags": ["a", "b", "c", "d", "e", "f"] }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": "bad", "rewardReductionPercentage": "0.5" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": 2, "rewardReductionPercentage": "0.5" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": 3, "rewardReductionPercentage": 5 }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": 3, "rewardReductionPercentage": "-1" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": 3, "rewardReductionPercentage": "101" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": 3, "rewardReductionPercentage": "0.55" }, "isSignedWithActiveKey": true }'));
      // This one should succeed, triggering double reward pool creation issue
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "TKN", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));

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
      assertError(txs[0], 'operation must be signed with your active key');
      assertError(txs[1], 'token not found');
      assertError(txs[2], 'config invalid');
      assertError(txs[3], 'postRewardCurve should be one of: [power]');
      assertError(txs[4], 'postRewardCurveParameter should be between "1" and "2" with precision at most 2');
      assertError(txs[5], 'postRewardCurveParameter should be between "1" and "2" with precision at most 2');
      assertError(txs[6], 'postRewardCurveParameter should be between "1" and "2" with precision at most 2');
      assertError(txs[7], 'postRewardCurveParameter should be between "1" and "2" with precision at most 2');
      assertError(txs[8], 'curationRewardCurve should be one of: [power]');
      assertError(txs[9], 'curationRewardCurveParameter can only be between "0.5" and "1" with precision at most 2');
      assertError(txs[10], 'curationRewardCurveParameter can only be between "0.5" and "1" with precision at most 2');
      assertError(txs[11], 'curationRewardCurveParameter can only be between "0.5" and "1" with precision at most 2');
      assertError(txs[12], 'curationRewardCurveParameter can only be between "0.5" and "1" with precision at most 2');
      assertError(txs[13], 'cashoutWindowDays should be an integer between 1 and 30');
      assertError(txs[14], 'cashoutWindowDays should be an integer between 1 and 30');
      assertError(txs[15], 'cashoutWindowDays should be an integer between 1 and 30');
      assertError(txs[16], 'rewardPerInterval invalid');
      assertError(txs[17], 'token precision mismatch for rewardPerInterval');
      assertError(txs[18], 'rewardPerInterval invalid');
      assertError(txs[19], 'voteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[20], 'voteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[21], 'voteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[22], 'downvoteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[23], 'downvoteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[24], 'downvoteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[25], 'stakedRewardPercentage should be an integer between 0 and 100');
      assertError(txs[26], 'stakedRewardPercentage should be an integer between 0 and 100');
      assertError(txs[27], 'stakedRewardPercentage should be an integer between 0 and 100');
      assertError(txs[28], 'votePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[29], 'votePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[30], 'votePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[31], 'downvotePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[32], 'downvotePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[33], 'downvotePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[34], 'you must have enough tokens to cover the creation fee');
      // 35 issues BEE to cover fee
      assertError(txs[36], 'must be issuer of token');
      assertError(txs[37], 'token must have staking enabled');
      assertError(txs[38], 'tags should be a non-empty array of strings of length at most 5');
      assertError(txs[39], 'tags should be a non-empty array of strings of length at most 5');
      assertError(txs[40], 'tags should be a non-empty array of strings of length at most 5');
      assertError(txs[41], 'tags should be a non-empty array of strings of length at most 5');
      assertError(txs[42], 'rewardIntervalSeconds should be an integer between 3 and 86400, and divisible by 3');
      assertError(txs[43], 'rewardIntervalSeconds should be an integer between 3 and 86400, and divisible by 3');
      assertError(txs[44], 'rewardIntervalSeconds should be an integer between 3 and 86400, and divisible by 3');
      assertError(txs[45], 'disableDownvote should be boolean');
      assertError(txs[46], 'ignoreDeclinePayout should be boolean');
      assertError(txs[47], 'appTaxConfig invalid');
      assertError(txs[48], 'appTaxConfig app invalid');
      assertError(txs[49], 'appTaxConfig percent should be an integer between 1 and 100');
      assertError(txs[50], 'appTaxConfig beneficiary invalid');
      assertError(txs[51], 'excludeTags should be a non-empty array of strings of length at most 5');
      assertError(txs[52], 'excludeTags should be a non-empty array of strings of length at most 5');
      assertError(txs[53], 'excludeTags should be a non-empty array of strings of length at most 5');
      assertError(txs[54], 'excludeTags should be a non-empty array of strings of length at most 5');
      assertError(txs[55], 'rewardReductionIntervalSeconds should be an integer greater or equal to rewardIntervalSeconds');
      assertError(txs[56], 'rewardReductionIntervalSeconds should be an integer greater or equal to rewardIntervalSeconds');
      assertError(txs[57], 'rewardReductionPercentage should be between "0" and "100" with precision at most 1');
      assertError(txs[58], 'rewardReductionPercentage should be between "0" and "100" with precision at most 1');
      assertError(txs[59], 'rewardReductionPercentage should be between "0" and "100" with precision at most 1');
      assertError(txs[60], 'rewardReductionPercentage should be between "0" and "100" with precision at most 1');
      // 61 successfully creates token, testing for token dupe pools
      assertError(txs[62], 'cannot create multiple reward pools per token');
  });

  it('should update reward pool', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      await tableAsserts.assertUserBalances({account: "harpagon", symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL, balance: "900.00000000", stake: "0"});

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'comments', 'createRewardPool', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false}, "isSignedWithActiveKey": true }`));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();


      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'comments', 'updateParams', '{ "updateFee": "100" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1.01", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.51", "curationRewardPercentage": 51, "cashoutWindowDays": 8, "rewardPerInterval": "1.6", "rewardIntervalSeconds": 3, "voteRegenerationDays": 6, "downvoteRegenerationDays": 6, "stakedRewardPercentage": 51, "votePowerConsumption": 201, "downvotePowerConsumption": 2001, "tags": ["scottest2"], "disableDownvote": true, "ignoreDeclinePayout": true, "appTaxConfig": {"app": "neoxian", "percent": 50, "beneficiary": "neoxianburn"}, "excludeTags": ["exclude"], "rewardReductionIntervalSeconds": 6, "rewardReductionPercentage": "0.5"}, "isSignedWithActiveKey": true }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:03',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"lastRewardReductionTimestamp":1527811203000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.01","curationRewardCurve":"power","curationRewardCurveParameter":"0.51","curationRewardPercentage":51,"cashoutWindowDays":8,"rewardPerInterval":"1.6","rewardIntervalSeconds":3,"voteRegenerationDays":6,"downvoteRegenerationDays":6,"stakedRewardPercentage":51,"votePowerConsumption":201,"downvotePowerConsumption":2001,"tags":["scottest2"], "disableDownvote": true, "ignoreDeclinePayout": true, "appTaxConfig": {"app": "neoxian", "percent": 50, "beneficiary": "neoxianburn"}, "excludeTags":["exclude"], "rewardReductionIntervalSeconds": 6, "rewardReductionPercentage": "0.5"},"pendingClaims":"0","active":true});

      // check fee
      await tableAsserts.assertUserBalances({account: "harpagon", symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL, balance: "800.00000000", stake: "0"});

      const hiveEngineBeeBalance = await fixture.database.findOne({
        contract: 'tokens',
        table: 'balances',
        query: {
          account: CONSTANTS.HIVE_ENGINE_ACCOUNT,
          symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL,
        },
      });

      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'comments', 'updateRewardPool', '{ "rewardPoolId": 2, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1.01", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.51", "curationRewardPercentage": 51, "cashoutWindowDays": 8, "rewardPerInterval": "1.6", "rewardIntervalSeconds": 3, "voteRegenerationDays": 6, "downvoteRegenerationDays": 6, "stakedRewardPercentage": 51, "votePowerConsumption": 201, "downvotePowerConsumption": 2001, "tags": ["scottest2"], "disableDownvote": false, "ignoreDeclinePayout": false, "appTaxConfig": null, "excludeTags": null}, "isSignedWithActiveKey": true }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      await assertPool({"_id":2,"symbol":"BEE","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.01","curationRewardCurve":"power","curationRewardCurveParameter":"0.51","curationRewardPercentage":51,"cashoutWindowDays":8,"rewardPerInterval":"1.6","rewardIntervalSeconds":3,"voteRegenerationDays":6,"downvoteRegenerationDays":6,"stakedRewardPercentage":51,"votePowerConsumption":201,"downvotePowerConsumption":2001,"tags":["scottest2"],"disableDownvote":false,"ignoreDeclinePayout":false,"appTaxConfig":null,"excludeTags":null},"pendingClaims":"0","active":true});

      // check no fee
      await tableAsserts.assertUserBalances({account: CONSTANTS.HIVE_ENGINE_ACCOUNT, symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL, balance: hiveEngineBeeBalance.balance, stake: "0"});
  });

  it('should not update reward pool', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": "badconfig", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "none", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "0", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "2.1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1.001", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": 1.01, "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "none", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.4", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "1.1", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.602", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": 0.6, "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": "7", "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 0, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 31, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": 1.5, "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "0.000000001", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "0", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": "5", "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 0, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 31, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": "5", "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 0, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 31, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": "50", "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": -1, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 101, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": "200", "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 0, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 10001, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": "2000", "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 0, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 10001, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": "invalid", "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ 1 ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "1", "2", "3", "4", "5", "6" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": "3", "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "1" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 2, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "1" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 100000, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "1" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'satoshi', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "satoshi", "quantity": "100", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'satoshi', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 2, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": 0, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": 1 }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false, "appTaxConfig": "invalid" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false, "appTaxConfig": {"app": "", "percent": 50, "beneficiary": "neoxianburn" } }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false, "appTaxConfig": {"app": "neoxiancity", "percent": 0, "beneficiary": "neoxianburn" } }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false, "appTaxConfig": {"app": "neoxiancity", "percent": 50, "beneficiary": "" } }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false, "excludeTags": "invalid" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false, "excludeTags": [] }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false, "excludeTags": [1, 2] }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000, "tags": [ "scottest" ], "disableDownvote": false, "ignoreDeclinePayout": false, "excludeTags": ["a", "b", "c", "d", "e", "f"] }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": "bad", "rewardReductionPercentage": "0.5" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": 2, "rewardReductionPercentage": "0.5" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": 3, "rewardReductionPercentage": 5 }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": 3, "rewardReductionPercentage": "-1" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": 3, "rewardReductionPercentage": "101" }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'updateRewardPool', '{ "rewardPoolId": 1, "config": { "postRewardCurve": "power", "postRewardCurveParameter": "1", "curationRewardCurve": "power", "curationRewardCurveParameter": "0.5", "curationRewardPercentage": 50, "cashoutWindowDays": 7, "rewardPerInterval": "1.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 200, "downvotePowerConsumption": 2000,"tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false, "rewardReductionIntervalSeconds": 3, "rewardReductionPercentage": "0.55" }, "isSignedWithActiveKey": true }'));


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
      assertError(txs[0], 'operation must be signed with your active key');
      assertError(txs[1], 'config invalid');
      assertError(txs[2], 'postRewardCurve should be one of: [power]');
      assertError(txs[3], 'postRewardCurveParameter should be between "1" and "2" with precision at most 2');
      assertError(txs[4], 'postRewardCurveParameter should be between "1" and "2" with precision at most 2');
      assertError(txs[5], 'postRewardCurveParameter should be between "1" and "2" with precision at most 2');
      assertError(txs[6], 'postRewardCurveParameter should be between "1" and "2" with precision at most 2');
      assertError(txs[7], 'curationRewardCurve should be one of: [power]');
      assertError(txs[8], 'curationRewardCurveParameter can only be between "0.5" and "1" with precision at most 2');
      assertError(txs[9], 'curationRewardCurveParameter can only be between "0.5" and "1" with precision at most 2');
      assertError(txs[10], 'curationRewardCurveParameter can only be between "0.5" and "1" with precision at most 2');
      assertError(txs[11], 'curationRewardCurveParameter can only be between "0.5" and "1" with precision at most 2');
      assertError(txs[12], 'cashoutWindowDays should be an integer between 1 and 30');
      assertError(txs[13], 'cashoutWindowDays should be an integer between 1 and 30');
      assertError(txs[14], 'cashoutWindowDays should be an integer between 1 and 30');
      assertError(txs[15], 'rewardPerInterval invalid');
      assertError(txs[16], 'token precision mismatch for rewardPerInterval');
      assertError(txs[17], 'rewardPerInterval invalid');
      assertError(txs[18], 'voteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[19], 'voteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[20], 'voteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[21], 'downvoteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[22], 'downvoteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[23], 'downvoteRegenerationDays should be an integer between 1 and 30');
      assertError(txs[24], 'stakedRewardPercentage should be an integer between 0 and 100');
      assertError(txs[25], 'stakedRewardPercentage should be an integer between 0 and 100');
      assertError(txs[26], 'stakedRewardPercentage should be an integer between 0 and 100');
      assertError(txs[27], 'votePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[28], 'votePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[29], 'votePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[30], 'downvotePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[31], 'downvotePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[32], 'downvotePowerConsumption should be an integer between 1 and 10000');
      assertError(txs[33], 'tags should be a non-empty array of strings of length at most 5');
      assertError(txs[34], 'tags should be a non-empty array of strings of length at most 5');
      assertError(txs[35], 'tags should be a non-empty array of strings of length at most 5');
      assertError(txs[36], 'tags should be a non-empty array of strings of length at most 5');
      assertError(txs[37], 'rewardIntervalSeconds should be an integer between 3 and 86400, and divisible by 3');
      assertError(txs[38], 'rewardIntervalSeconds should be an integer between 3 and 86400, and divisible by 3');
      assertError(txs[39], 'rewardIntervalSeconds should be an integer between 3 and 86400, and divisible by 3');
      assertError(txs[40], 'you must have enough tokens to cover the update fee');
      // 41 issues tokens to cover update fee
      assertError(txs[42], 'must be issuer of token');
      assertError(txs[43], 'reward pool not found');
      assertError(txs[44], 'disableDownvote should be boolean');
      assertError(txs[45], 'ignoreDeclinePayout should be boolean');
      assertError(txs[46], 'appTaxConfig invalid');
      assertError(txs[47], 'appTaxConfig app invalid');
      assertError(txs[48], 'appTaxConfig percent should be an integer between 1 and 100');
      assertError(txs[49], 'appTaxConfig beneficiary invalid');
      assertError(txs[50], 'excludeTags should be a non-empty array of strings of length at most 5');
      assertError(txs[51], 'excludeTags should be a non-empty array of strings of length at most 5');
      assertError(txs[52], 'excludeTags should be a non-empty array of strings of length at most 5');
      assertError(txs[53], 'excludeTags should be a non-empty array of strings of length at most 5');
      assertError(txs[54], 'rewardReductionIntervalSeconds should be an integer greater or equal to rewardIntervalSeconds');
      assertError(txs[55], 'rewardReductionIntervalSeconds should be an integer greater or equal to rewardIntervalSeconds');
      assertError(txs[56], 'rewardReductionPercentage should be between "0" and "100" with precision at most 1');
      assertError(txs[57], 'rewardReductionPercentage should be between "0" and "100" with precision at most 1');
      assertError(txs[58], 'rewardReductionPercentage should be between "0" and "100" with precision at most 1');
      assertError(txs[59], 'rewardReductionPercentage should be between "0" and "100" with precision at most 1');

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"],"disableDownvote":false,"ignoreDeclinePayout":false},"pendingClaims":"0","active":true});
  });

  it('should not setMute', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setMute', '{ "rewardPoolId": 2, "account": "author", "mute": true, "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setMute', '{ "rewardPoolId": 1, "account": "-invalid", "mute": true, "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setMute', '{ "rewardPoolId": 1, "account": "author", "mute": "invalid", "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setMute', '{ "rewardPoolId": 1, "account": "author", "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'nobody', 'comments', 'setMute', '{ "rewardPoolId": 1, "account": "author", "mute": "true", "isSignedWithActiveKey": false }'));

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
      assertError(txs[0], 'reward pool not found');
      assertError(txs[1], 'invalid account');
      assertError(txs[2], 'mute must be a boolean');
      assertError(txs[3], 'mute must be a boolean');
      assertError(txs[4], 'must be issuer of token');
  });

  it('should setMute', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setMute', '{ "rewardPoolId": 1, "account": "author", "mute": true, "isSignedWithActiveKey": false }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      const vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'author', rewardPoolId: 1}});
      assert(vp.mute);
  });

  it('should not setPostMute', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setPostMute', '{ "rewardPoolId": 2, "authorperm": "@author/test", "mute": true, "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setPostMute', '{ "rewardPoolId": 1, "authorperm": {}, "mute": true, "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setPostMute', '{ "rewardPoolId": 1, "authorperm": "@author/test", "mute": true, "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author", "permlink": "test", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setPostMute', '{ "rewardPoolId": 1, "authorperm": "@author/test", "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setPostMute', '{ "rewardPoolId": 1, "authorperm": "@author/test", "mute": "true", "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'nobody', 'comments', 'setPostMute', '{ "rewardPoolId": 1, "authorperm": "@author/test", "mute": true, "isSignedWithActiveKey": false }'));

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
      assertError(txs[0], 'reward pool not found');
      assertError(txs[1], 'authorperm must be a string');
      assertError(txs[2], 'post not found');
      // tx 3 adds post
      assertError(txs[4], 'mute must be a boolean');
      assertError(txs[5], 'mute must be a boolean');
      assertError(txs[6], 'must be issuer of token');
  });

  it('does not pay for muted post', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "1"});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setPostMute', '{ "rewardPoolId": 1, "authorperm": "@author1/test1", "mute": true, "isSignedWithActiveKey": false }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"10.0000000000","mute":true}');

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302398.50000000","lastRewardTimestamp":1528415997000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"9.9997685205","active":true,"intervalPendingClaims":"9.9997685205","intervalRewardPool":"15.00000000"});

      // forward clock past payout time
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // this transaction pays out with maintenance op
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":"0"}}');
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'beneficiaryReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'bene1'), undefined);
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'beneficiaryReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'bene2'), undefined);
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter1'), undefined);

      await tableAsserts.assertUserBalances({account: "author1", symbol: "TKN", balance: 0, stake: 0});
      await tableAsserts.assertUserBalances({account: "bene1", symbol: "TKN", balance: 0, stake: 0});
      await tableAsserts.assertUserBalances({account: "bene2", symbol: "TKN", balance: 0, stake: 0});
      await tableAsserts.assertUserBalances({account: "voter1", symbol: "TKN", balance: "0", stake: "10.00000000"});

      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(post, null);

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302400.00000000","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528416000000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"19.9997453728","active":true,"intervalPendingClaims":"19.9997453728","intervalRewardPool":"302400.00000000"});
  });

  it('should not resetPool', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'resetPool', '{ "rewardPoolId": 1, "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'resetPool', '{ "rewardPoolId": 2, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'nobody', 'comments', 'resetPool', '{ "rewardPoolId": 1, "isSignedWithActiveKey": true }'));

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
      assertError(txs[0], 'operation must be signed with your active key');
      assertError(txs[1], 'reward pool not found');
      assertError(txs[2], 'must be issuer of token');
  });

  it('should resetPool', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author", "permlink": "test", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");

      const expectedRewardPool = { _id: 1, rewardPool: '302398.50000000', pendingClaims: '9.9997685205', lastClaimDecayTimestamp: 1528415997000, lastRewardTimestamp: 1528415997000, createdTimestamp: 1527811200000, config: {} };
      await assertPool(expectedRewardPool);

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'resetPool', '{ "rewardPoolId": 1, "isSignedWithActiveKey": true }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      rewardPool = await fixture.database.findOne({ contract: 'comments', table: 'rewardPools', query: { _id: 1}});
      expectedRewardPool.rewardPool = '0';
      expectedRewardPool.pendingClaims = '0';
      expectedRewardPool.lastClaimDecayTimestamp = 1528416000000;
      expectedRewardPool.lastRewardTimestamp = 1528416000000;
      expectedRewardPool.createdTimestamp = 1528416000000;
      await assertPool(expectedRewardPool);
  });

  it('should deactivate and reactivate reward pool', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setActive', '{ "rewardPoolId": 1, "active": false, "isSignedWithActiveKey": true }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"0","active":false});

      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setActive', '{ "rewardPoolId": 1, "active": true, "isSignedWithActiveKey": true }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"0","active":true});
  });

  it('should not deactivate reward pool', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setActive', '{ "rewardPoolId": 2, "active": false, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setActive', '{ "rewardPoolId": 1, "active": false, "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'satoshi', 'comments', 'setActive', '{ "rewardPoolId": 1, "active": false, "isSignedWithActiveKey": true }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      let res = await fixture.database.getLatestBlockInfo();
      let txs = res.transactions;
      assertError(txs[0], 'reward pool not found');
      assertError(txs[1], 'operation must be signed with your active key')
      assertError(txs[2], 'must be issuer of token')

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"0","active":true});
  });

  it('should not process reward pool when inactive', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setActive', '{ "rewardPoolId": 1, "active": false, "isSignedWithActiveKey": true }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"0","active":false});

      // forward clock, but should not process token
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'setActive', '{ "rewardPoolId": 1, "active": false, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test2", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-02T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      // no issue event
      assert.equal(res.transactions[0].logs, "{}");
      // no newComment event
      assert.equal(res.transactions[1].logs, "{}");
      // no newVote event
      assert.equal(res.transactions[2].logs, "{}");

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"0","active":false});
  });

  it('should not create comment', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'author1', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));

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
      assertError(txs[0], 'action must use comment operation');

      const posts = await fixture.database.find({ contract: 'comments', table: 'posts', query: {}});
      assert.equal(posts.length, 0);
  });

  it('should not reactivate comment after payout', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      let posts = await fixture.database.find({ contract: 'comments', table: 'posts', query: {}});
      assert.equal(JSON.stringify(posts), '[{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"0","voteRshareSum":"0"}]');
      let postMetadata = await fixture.database.findOne({ contract: 'comments', table: 'postMetadata', query: { authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(postMetadata), '{"_id":{"authorperm":"@author1/test1"},"authorperm":"@author1/test1","rewardPoolIds":[1]}');

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");

      // forward clock and then pay out post
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      posts = await fixture.database.find({ contract: 'comments', table: 'posts', query: {}});
      assert.equal(JSON.stringify(posts), '[]');

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:03',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      posts = await fixture.database.find({ contract: 'comments', table: 'posts', query: {}});
      assert.equal(JSON.stringify(posts), '[]');
  });

  it('should fall back to post if metadata not present', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      let transactions;
      let refBlockNumber;
      let block;

      await fixture.database.insert({ contract: 'comments', table: 'posts', record: { authorperm: '@author1/test1', rewardPoolId: 1 }});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "re-test1", "parentAuthor": "author1", "parentPermlink": "test1" }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      let posts = await fixture.database.find({ contract: 'comments', table: 'posts', query: {}});
      assert.equal(JSON.stringify(posts), '[{"_id":{"authorperm":"@author1/re-test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/re-test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"0","voteRshareSum":"0"},{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"authorperm":"@author1/test1","rewardPoolId":1}]');
      let postMetadata = await fixture.database.findOne({ contract: 'comments', table: 'postMetadata', query: { authorperm: "@author1/test1" }});
      assert.equal(postMetadata, null);
      postMetadata = await fixture.database.findOne({ contract: 'comments', table: 'postMetadata', query: { authorperm: "@author1/re-test1" }});
      assert.equal(JSON.stringify(postMetadata), '{"_id":{"authorperm":"@author1/re-test1"},"authorperm":"@author1/re-test1","rewardPoolIds":[1]}');
  });

  it('should not vote', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // allow comment to succeed
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'voter1', 'comments', 'vote', '{ "author": "author1", "permlink": "test1", "voter": "voter1", "weight": 10000 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "author": "author1", "permlink": "test1", "voter": "voter1", "weight": "10" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "author": "author1", "permlink": "test1", "voter": "voter1", "weight": -10001 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "author": "author1", "permlink": "test1", "voter": "voter1", "weight": 10001 }'));

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
      // 0 is comment op
      assertError(txs[1], 'can only vote with voting op');
      assertError(txs[2], 'weight must be an integer from -10000 to 10000');
      assertError(txs[3], 'weight must be an integer from -10000 to 10000');
      assertError(txs[4], 'weight must be an integer from -10000 to 10000');

      let votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1"}});
      assert.equal(votes.length, 0);
  });

  it('pays out voted post n^1, curation n^0.5', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "0.5"});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "author1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"10.0000000000"}}');
      let vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9800,"downvotingPower":10000}');
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"10.0000000000","active":true});

      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"10.0000000000"}');

      let votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"author1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":10000,"rshares":"0.0000000000","curationWeight":"0.0000000000","timestamp":1527811200000,"voter":"author1"},{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":10000,"rshares":"10.0000000000","curationWeight":"3.1622776601","timestamp":1527811200000,"voter":"voter1"}]');

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test2", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test2", "weight": 10000 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter2", "author": "author1", "permlink": "test2", "weight": 8000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract'), undefined);
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'newComment')), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"9.8000000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[2].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"8.0000000000"}}');
      vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9604,"downvotingPower":10000}');
      let vp2 = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter2', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp2), '{"_id":{"rewardPoolId":1,"account":"voter2"},"rewardPoolId":1,"account":"voter2","lastVoteTimestamp":1527811200000,"votingPower":9840,"downvotingPower":10000}');
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"27.8000000000","active":true});

      let post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test2","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"17.8000000000","voteRshareSum":"17.8000000000"}');
      let votes2 = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      // weights are 9.8^b vs 17.8^b - 9.8^b
      assert.equal(JSON.stringify(votes2), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":10000,"rshares":"9.8000000000","curationWeight":"3.1304951684","timestamp":1527811200000,"voter":"voter1"},{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter2"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":8000,"rshares":"8.0000000000","curationWeight":"1.0885094535","timestamp":1527811200000,"voter":"voter2"}]');

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302398.50000000","lastRewardTimestamp":1528415997000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"27.7993564875","active":true,"intervalPendingClaims":"27.7993564875","intervalRewardPool":"15.00000000"});

      // forward clock and then pay out both posts
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"1.50000000"}}');
      // ratio between author rewards should satisfy rshares1^a / rshares2^a ~ payout1 / payout2
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":"27194.59082809"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test2')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"author1","quantity":"48406.37167400"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter1')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"voter1","quantity":"27194.59082809"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'author1')), undefined);
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter1')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"voter1","quantity":"35917.45594651"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter2')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"voter2","quantity":"12488.91572748"}}');

      await tableAsserts.assertUserBalances({account: "author1", symbol: "TKN", balance: "37800.48125105", stake: "37800.48125104"});
      await tableAsserts.assertUserBalances({account: "voter1", symbol: "TKN", balance: "31556.02338731", stake: "31566.02338729"});
      await tableAsserts.assertUserBalances({account: "voter2", symbol: "TKN", balance: "6244.45786374", stake: "6254.45786374"});

      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(post, null);
      post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(post2, null);

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"151198.07499582","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528416000000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"55.5992921371","active":true,"intervalPendingClaims":"55.5992921371","intervalRewardPool":"302400.00000000"});
  });

  it('pays out voted post n^1.03, curation n^0.7', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1.03", curationRewardCurveParameter: "0.7"});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "author1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"10.0000000000"}}');
      let vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9800,"downvotingPower":10000}');
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"10.7151930523","active":true});

      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"10.0000000000"}');

      let votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"author1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":10000,"rshares":"0.0000000000","curationWeight":"0.0000000000","timestamp":1527811200000,"voter":"author1"},{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":10000,"rshares":"10.0000000000","curationWeight":"5.0118723362","timestamp":1527811200000,"voter":"voter1"}]');

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test2", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test2", "weight": 10000 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter2", "author": "author1", "permlink": "test2", "weight": 8000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract'), undefined);
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'newComment')), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"9.8000000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[2].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"8.0000000000"}}');
      vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9604,"downvotingPower":10000}');
      let vp2 = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter2', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp2), '{"_id":{"rewardPoolId":1,"account":"voter2"},"rewardPoolId":1,"account":"voter2","lastVoteTimestamp":1527811200000,"votingPower":9840,"downvotingPower":10000}');
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"30.1210400252","active":true});

      let post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test2","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"17.8000000000","voteRshareSum":"17.8000000000"}');
      let votes2 = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      // weights are 9.8^0.7 vs 17.8^0.7 - 9.8^0.7
      assert.equal(JSON.stringify(votes2), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":10000,"rshares":"9.8000000000","curationWeight":"4.9414937793","timestamp":1527811200000,"voter":"voter1"},{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter2"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":8000,"rshares":"8.0000000000","curationWeight":"2.5625265445","timestamp":1527811200000,"voter":"voter2"}]');

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302398.50000000","lastRewardTimestamp":1528415997000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"30.1203427857","active":true,"intervalPendingClaims":"30.1203427857","intervalRewardPool":"15.00000000"});

      // forward clock and then pay out both posts
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"1.50000000"}}');
      // ratio between author rewards should satisfy rshares1^a / rshares2^a ~ payout1 / payout2
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":"26894.12143368"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test2')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"author1","quantity":"48706.84106812"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter1')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"voter1","quantity":"26894.12143368"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'author1')), undefined);
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter1')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"voter1","quantity":"32074.08052775"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter2')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"voter2","quantity":"16632.76054036"}}');

      await tableAsserts.assertUserBalances({account: "author1", symbol: "TKN", balance: "37800.48125090", stake: "37800.48125090"});
      await tableAsserts.assertUserBalances({account: "voter1", symbol: "TKN", balance: "29484.10098072", stake: "29494.10098071"});
      await tableAsserts.assertUserBalances({account: "voter2", symbol: "TKN", balance: "8316.38027018", stake: "8326.38027018"});

      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(post, null);
      post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(post2, null);

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"151198.07499640","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528416000000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"60.2413130878","active":true,"intervalPendingClaims":"60.2413130878","intervalRewardPool":"302400.00000000"});
  });

  it('vote past payout is ignored', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "1"});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302398.50000000","lastRewardTimestamp":1528415997000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"0.0000000000","active":true,"intervalPendingClaims":"0.0000000000","intervalRewardPool":"15.00000000"});

      // forward clock past payout time
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // this transaction pays out with maintenance op
      transactions.push(maintenanceOp(refBlockNumber));
      // this vote should be ignored.
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":"0.00000000"}}');
      // no record for late vote
      assert.equal(res.transactions[1].logs, "{}");
      let vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert(vp == null);
  });

  it('second vote ignores curation', async () => {
      await fixture.setUp();
      await setUpRewardPool({ postRewardCurveParameter: "1.03", curationRewardCurveParameter: "0.5"});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"10.0000000000"}}');
      let vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9800,"downvotingPower":10000}');
      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"10.0000000000"}');
      let votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":10000,"rshares":"10.0000000000","curationWeight":"3.1622776601","timestamp":1527811200000,"voter":"voter1"}]');

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // update vote with lower value
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 1000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"updateVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"0.9800000000"}}');
      vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9780,"downvotingPower":10000}');
      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"0.9800000000"}');
      votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":1000,"rshares":"0.9800000000","curationWeight":"0","timestamp":1527811200000,"voter":"voter1"}]');

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302398.50000000","lastRewardTimestamp":1528415997000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"10.7149450175","active":true,"intervalPendingClaims":"10.7149450175","intervalRewardPool":"15.00000000"});

      // pay out post
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"1.50000000"}}');
      // ratio between author rewards should satisfy rshares1^a / rshares2^a ~ payout1 / payout2
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":"12663.08250736"}}');
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter1'), undefined);

      await tableAsserts.assertUserBalances({account: "author1", symbol: "TKN", balance: "6331.54125368", stake: "6331.54125368"});
      await tableAsserts.assertUserBalances({account: "voter1", symbol: "TKN", balance: "0", stake: "10.00000000"});

      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(post, null);

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"277073.83498528","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528416000000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"11.6943264346","active":true,"intervalPendingClaims":"11.6943264346","intervalRewardPool":"302400.00000000"});
  });

 it('successfully downvotes', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1.03", curationRewardCurveParameter: "0.7"});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test2", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 1000 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test2", "weight": 2000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[2].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"1.0000000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[3].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"1.9960000000"}}');
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"3.0378178077","active":true});

      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"1.0000000000","voteRshareSum":"1.0000000000"}');
      let votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":1000,"rshares":"1.0000000000","curationWeight":"1.0000000000","timestamp":1527811200000,"voter":"voter1"}]');
      let post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test2","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"1.9960000000","voteRshareSum":"1.9960000000"}');
      let votes2 = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(JSON.stringify(votes2), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":2000,"rshares":"1.9960000000","curationWeight":"1.6222298031","timestamp":1527811200000,"voter":"voter1"}]');

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter2", "author": "author1", "permlink": "test1", "weight": -1000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'newVote')), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"-1.0000000000"}}');
      let vp2 = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter2', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp2), '{"_id":{"rewardPoolId":1,"account":"voter2"},"rewardPoolId":1,"account":"voter2","lastVoteTimestamp":1527811200000,"votingPower":10000,"downvotingPower":9800}');
      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"1.0000000000","voteRshareSum":"0.0000000000"}');
      votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":1000,"rshares":"1.0000000000","curationWeight":"1.0000000000","timestamp":1527811200000,"voter":"voter1"},{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter2"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":-1000,"rshares":"-1.0000000000","curationWeight":"0","timestamp":1527811200000,"voter":"voter2"}]');
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"3.0378178077","active":true});

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-01T23:59:57', "43198.5");

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"43198.5","lastRewardTimestamp":1527897597000,"lastClaimDecayTimestamp":1527897597000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"3.0377474881","active":true,"intervalPendingClaims":"3.0377474881","intervalRewardPool":"15.00000000"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter2", "author": "author1", "permlink": "test2", "weight": -10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-02T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"1.50000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'newVote')), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"-10.0000000000"}}');
      vp2 = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter2', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp2), '{"_id":{"rewardPoolId":1,"account":"voter2"},"rewardPoolId":1,"account":"voter2","lastVoteTimestamp":1527897600000,"votingPower":10000,"downvotingPower":8000}');
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"43200.00000000","lastRewardTimestamp":1527897600000,"lastClaimDecayTimestamp":1527897600000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"3.0377404562","active":true,"intervalPendingClaims":"3.0377404562","intervalRewardPool":"43200.00000000"});

      post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test2","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"1.9960000000","voteRshareSum":"-8.0040000000"}');
      votes2 = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      // weights are 9.8^0.7 vs 17.8^0.7 - 9.8^0.7
      assert.equal(JSON.stringify(votes2), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":2000,"rshares":"1.9960000000","curationWeight":"1.6222298031","timestamp":1527811200000,"voter":"voter1"},{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter2"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":-10000,"rshares":"-10.0000000000","curationWeight":"0","timestamp":1527897600000,"voter":"voter2"}]');

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302398.50000000","lastRewardTimestamp":1528415997000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"3.0376701384","active":true,"intervalPendingClaims":"3.0376701384","intervalRewardPool":"43215.00000000"});

      // forward clock and then pay out both posts
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-09T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"1.50000000"}}');
      // ratio between author rewards should satisfy rshares1^a / rshares2^a ~ payout1 / payout2
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":"0.00000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test2')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"author1","quantity":"0.00000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter1')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"voter1","quantity":"0.00000000"}}');
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter2'), undefined);
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter1')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"voter1","quantity":"0.00000000"}}');
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter2'), undefined);

      assert(null === await fixture.database.findOne({ contract: 'tokens', table: 'balances', query: { account: "author1", symbol: "TKN" }}));
      await tableAsserts.assertUserBalances({account: "voter1", symbol: "TKN", balance: "0", stake: "10.00000000"});
      await tableAsserts.assertUserBalances({account: "voter2", symbol: "TKN", balance: "0", stake: "10.00000000"});

      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(post, null);
      post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(post2, null);

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302400.00000000","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528416000000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"3.0376631067","active":true,"intervalPendingClaims":"3.0376631067","intervalRewardPool":"302400.00000000"});
  });

  it('applies disableDownvote', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1.03", curationRewardCurveParameter: "0.7", disableDownvote: true});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test2", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 1000 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test2", "weight": 2000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[2].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"1.0000000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[3].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"1.9960000000"}}');
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"],"disableDownvote":true,"ignoreDeclinePayout":false},"pendingClaims":"3.0378178077","active":true});

      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"1.0000000000","voteRshareSum":"1.0000000000"}');
      let votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":1000,"rshares":"1.0000000000","curationWeight":"1.0000000000","timestamp":1527811200000,"voter":"voter1"}]');
      let post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test2","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"1.9960000000","voteRshareSum":"1.9960000000"}');
      let votes2 = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(JSON.stringify(votes2), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":2000,"rshares":"1.9960000000","curationWeight":"1.6222298031","timestamp":1527811200000,"voter":"voter1"}]');

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter2", "author": "author1", "permlink": "test1", "weight": -1000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'newVote')), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"0"}}');
      let vp2 = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter2', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp2), '{"_id":{"rewardPoolId":1,"account":"voter2"},"rewardPoolId":1,"account":"voter2","lastVoteTimestamp":1527811200000,"votingPower":10000,"downvotingPower":10000}');
      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"1.0000000000","voteRshareSum":"1.0000000000"}');
      votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":1000,"rshares":"1.0000000000","curationWeight":"1.0000000000","timestamp":1527811200000,"voter":"voter1"},{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter2"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":-1000,"rshares":"0","curationWeight":"0","timestamp":1527811200000,"voter":"voter2"}]');
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"],"disableDownvote":true,"ignoreDeclinePayout":false},"pendingClaims":"3.0378178077","active":true});

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-01T23:59:57', "43198.5");

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"43198.5","lastRewardTimestamp":1527897597000,"lastClaimDecayTimestamp":1527897597000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"],"disableDownvote":true,"ignoreDeclinePayout":false},"pendingClaims":"3.0377474881","active":true,"intervalPendingClaims":"3.0377474881","intervalRewardPool":"15.00000000"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter2", "author": "author1", "permlink": "test2", "weight": -10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-02T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"1.50000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'newVote')), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"0"}}');
      vp2 = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter2', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp2), '{"_id":{"rewardPoolId":1,"account":"voter2"},"rewardPoolId":1,"account":"voter2","lastVoteTimestamp":1527897600000,"votingPower":10000,"downvotingPower":10000}');
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"43200.00000000","lastRewardTimestamp":1527897600000,"lastClaimDecayTimestamp":1527897600000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"3.0377404562","active":true,"intervalPendingClaims":"3.0377404562","intervalRewardPool":"43200.00000000"});

      post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test2","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"1.9960000000","voteRshareSum":"1.9960000000"}');
      votes2 = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      // weights are 9.8^0.7 vs 17.8^0.7 - 9.8^0.7
      assert.equal(JSON.stringify(votes2), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":2000,"rshares":"1.9960000000","curationWeight":"1.6222298031","timestamp":1527811200000,"voter":"voter1"},{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter2"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":-10000,"rshares":"0","curationWeight":"0","timestamp":1527897600000,"voter":"voter2"}]');

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302398.50000000","lastRewardTimestamp":1528415997000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"3.0376701384","active":true,"intervalPendingClaims":"3.0376701384","intervalRewardPool":"43215.00000000"});

      // forward clock and then pay out both posts
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-09T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"1.50000000"}}');
      // ratio between author rewards should satisfy rshares1^a / rshares2^a ~ payout1 / payout2
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":"24886.91876912"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test2')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"author1","quantity":"50715.00624649"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter1')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"voter1","quantity":"24886.91876911"}}');
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter2'), undefined);
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter1')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"voter1","quantity":"50715.00624649"}}');
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter2'), undefined);

      await tableAsserts.assertUserBalances({account: "author1", symbol: "TKN", balance: "37800.96250781", stake: "37800.96250780"});
      await tableAsserts.assertUserBalances({account: "voter1", symbol: "TKN", balance: "37800.96250781", stake: "37810.96250779"});
      await tableAsserts.assertUserBalances({account: "voter2", symbol: "TKN", balance: "0", stake: "10.00000000"});

      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(post, null);
      post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(post2, null);

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"151196.14996879","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528416000000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"6.0754809144","active":true,"intervalPendingClaims":"6.0754809144","intervalRewardPool":"302400.00000000"});
  });

  it('voting repeatedly decays as expected', async () => {
      await fixture.setUp();
      await setUpRewardPool({ postRewardCurveParameter: "1.03", curationRewardCurveParameter: "0.5", voteRegenerationDays: 5, downvoteRegenerationDays: 10, cashoutWindowDays: 14});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test2", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');

      let vp;
      let vote;
      let downvote;

      vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      vp.votingPower = 10;
      vp.downvotingPower = 100;
      await fixture.database.update({ contract: 'comments', table: 'votingPower', record: vp });

      const votingPowerTable = [];
      const votingRsharesTable = [];
      const downvotingPowerTable = [];
      const downvotingRsharesTable = [];
      for (let i = 0; i < 300; i += 1) {
        transactions = [];
        refBlockNumber = fixture.getNextRefBlockNumber();
        transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));
        transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test2", "weight": -10000 }'));
          block = {
          refHiveBlockNumber: refBlockNumber,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: '2018-06-01T00:00:00',
          transactions,
        };

        await fixture.sendBlock(block);
        await tableAsserts.assertNoErrorInLastBlock();
        vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
        votingPowerTable.push(vp.votingPower);
        downvotingPowerTable.push(vp.downvotingPower);

        vote = await fixture.database.findOne({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: '@author1/test1', voter: 'voter1' }});
        downvote = await fixture.database.findOne({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: '@author1/test2', voter: 'voter1' }});

        const voteRshares = vote.rshares;
        const downvoteRshares = downvote.rshares;
        votingRsharesTable.push(voteRshares);
        downvotingRsharesTable.push(downvoteRshares);
        if (vp.votingPower === 0 && vp.downvotingPower === 0 && voteRshares === "0.0000000000" && downvoteRshares === "0.0000000000") {
            break;
        }
      }
      assert.equal(votingPowerTable[votingPowerTable.length-1], 0);
      assert.equal(downvotingPowerTable[downvotingPowerTable.length-1], 0);
      assert.equal(votingRsharesTable[votingRsharesTable.length-1], "0.0000000000");
      assert.equal(downvotingRsharesTable[downvotingRsharesTable.length-1], "0.0000000000");

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 1 }'));
        block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-06T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});

      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1528243200000,"votingPower":9999,"downvotingPower":5000}');

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 1 }'));
        block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-11T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});

      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1528675200000,"votingPower":9999,"downvotingPower":10000}');
  });

  it('create comment with two reward pools', async () => {
      await fixture.setUp();
      let transactions = [];
      let refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(commentsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "harpagon", "quantity": "3000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "ABC", "precision": 8, "maxSupply": "1000000000" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'enableStaking', '{ "symbol": "ABC", "unstakingCooldown": 7, "numberTransactions": 1, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "ABC", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "2", "curationRewardCurve": "power", "curationRewardCurveParameter": "1", "curationRewardPercentage": 75, "cashoutWindowDays": 7, "rewardPerInterval": "0.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 300, "downvotePowerConsumption": 1000, "tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'issue', '{ "symbol": "ABC", "quantity": "1000", "to": "harpagon", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'stake', '{ "symbol": "ABC", "quantity": "50", "to": "voter1", "isSignedWithActiveKey": true }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      await setUpRewardPool({ postRewardCurveParameter: "1.03", curationRewardCurveParameter: "0.5"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(evt => evt.data.symbol === "TKN")), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":2,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(evt => evt.data.symbol === "ABC")), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"ABC"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events.find(evt => evt.data.symbol === "TKN")), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":2,"symbol":"TKN","rshares":"10.0000000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events.find(evt => evt.data.symbol === "ABC")), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"ABC","rshares":"50.0000000000"}}');

      let vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9700,"downvotingPower":10000}');
      let vp2 = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 2}});
      assert.equal(JSON.stringify(vp2), '{"_id":{"rewardPoolId":2,"account":"voter1"},"rewardPoolId":2,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9800,"downvotingPower":10000}');
      await assertPool({"_id":1,"symbol":"ABC","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"2","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":75,"cashoutWindowDays":7,"rewardPerInterval":"0.5","rewardIntervalSeconds":3,"voteRegenerationDays":5,"downvoteRegenerationDays":5,"stakedRewardPercentage":50,"votePowerConsumption":300,"downvotePowerConsumption":1000,"tags":["scottest"]},"pendingClaims":"2500.0000000000","active":true});
      await assertPool({"_id":2,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"10.7151930523","active":true});

      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"ABC","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"50.0000000000","voteRshareSum":"50.0000000000"}');
      let post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 2, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":2},"rewardPoolId":2,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"10.0000000000"}');

      let votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"ABC","authorperm":"@author1/test1","weight":10000,"rshares":"50.0000000000","curationWeight":"50.0000000000","timestamp":1527811200000,"voter":"voter1"}]');
      let votes2 = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 2, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes2), '[{"_id":{"rewardPoolId":2,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":2,"symbol":"TKN","authorperm":"@author1/test1","weight":10000,"rshares":"10.0000000000","curationWeight":"3.1622776601","timestamp":1527811200000,"voter":"voter1"}]');
  });

  it('create comment and reply with two reward pools using tags', async () => {
      await fixture.setUp();
      let transactions = [];
      let refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(commentsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "harpagon", "quantity": "3000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "ABC", "precision": 8, "maxSupply": "1000000000" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'enableStaking', '{ "symbol": "ABC", "unstakingCooldown": 7, "numberTransactions": 1, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "ABC", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "2", "curationRewardCurve": "power", "curationRewardCurveParameter": "1", "curationRewardPercentage": 75, "cashoutWindowDays": 7, "rewardPerInterval": "0.5", "rewardIntervalSeconds": 3, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 300, "downvotePowerConsumption": 1000, "tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'issue', '{ "symbol": "ABC", "quantity": "1000", "to": "harpagon", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'stake', '{ "symbol": "ABC", "quantity": "50", "to": "voter1", "isSignedWithActiveKey": true }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      await setUpRewardPool({ postRewardCurveParameter: '1.03', curationRewardCurveParameter: '0.5', tags: ['test', 'tag2'], excludeTags: ['spam', 'banned']});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["a", "b", "scottest", "c", "tag2", "d"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author2", "permlink": "re-test1", "parentAuthor": "author1", "parentPermlink": "test1"}'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author2", "permlink": "nopools", "parentAuthor": "other", "parentPermlink": "nonindexed"}'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author3", "permlink": "test3", "parentPermlink": "scottest", "jsonMetadata": {"tags": []} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author4", "permlink": "excluded", "parentPermlink": "pop", "jsonMetadata": {"tags": ["spam", "test"]} }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();

      let vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9700,"downvotingPower":10000}');
      let vp2 = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 2}});
      assert.equal(JSON.stringify(vp2), '{"_id":{"rewardPoolId":2,"account":"voter1"},"rewardPoolId":2,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9800,"downvotingPower":10000}');
      await assertPool({"_id":1,"symbol":"ABC","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"2","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":75,"cashoutWindowDays":7,"rewardPerInterval":"0.5","rewardIntervalSeconds":3,"voteRegenerationDays":5,"downvoteRegenerationDays":5,"stakedRewardPercentage":50,"votePowerConsumption":300,"downvotePowerConsumption":1000,"tags":["scottest"]},"pendingClaims":"2500.0000000000","active":true});
      await assertPool({"_id":2,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["test","tag2"]},"pendingClaims":"10.7151930523","active":true});

      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"ABC","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"50.0000000000","voteRshareSum":"50.0000000000"}');
      let post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 2, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":2},"rewardPoolId":2,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"10.0000000000"}');

      let post3 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author3/test3" }});
      assert.equal(JSON.stringify(post3), '{"_id":{"authorperm":"@author3/test3","rewardPoolId":1},"rewardPoolId":1,"symbol":"ABC","authorperm":"@author3/test3","author":"author3","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"0","voteRshareSum":"0"}');

      let votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"ABC","authorperm":"@author1/test1","weight":10000,"rshares":"50.0000000000","curationWeight":"50.0000000000","timestamp":1527811200000,"voter":"voter1"}]');
      let votes2 = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 2, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes2), '[{"_id":{"rewardPoolId":2,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":2,"symbol":"TKN","authorperm":"@author1/test1","weight":10000,"rshares":"10.0000000000","curationWeight":"3.1622776601","timestamp":1527811200000,"voter":"voter1"}]');
      
      let reply = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author2/re-test1" }});
      assert.equal(JSON.stringify(reply), '{"_id":{"authorperm":"@author2/re-test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"ABC","authorperm":"@author2/re-test1","author":"author2","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"0","voteRshareSum":"0"}');
      let reply2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 2, authorperm: "@author2/re-test1" }});
      assert.equal(JSON.stringify(reply2), '{"_id":{"authorperm":"@author2/re-test1","rewardPoolId":2},"rewardPoolId":2,"symbol":"TKN","authorperm":"@author2/re-test1","author":"author2","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"0","voteRshareSum":"0"}');

      reply = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author2/nopools" }});
      assert.equal(reply, null);
      reply2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 2, authorperm: "@author2/nopools" }});
      assert.equal(reply2, null);

      reply = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author4/excluded" }});
      assert.equal(reply, null);
      reply2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 2, authorperm: "@author4/excluded" }});
      assert.equal(reply2, null);
  });

  it('voting power reflects delegations', async () => {
      await fixture.setUp();
      await setUpRewardPool({ postRewardCurveParameter: "1.03", curationRewardCurveParameter: "0.5"});

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'stake', '{ "symbol": "TKN", "quantity": "50", "to": "harpagon", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'delegate', '{ "symbol": "TKN", "quantity": "50", "to": "voter1", "isSignedWithActiveKey": true }'));
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
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(evt => evt.data.symbol === "TKN")), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events.find(evt => evt.data.symbol === "TKN")), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"60.0000000000"}}');

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"67.8415540697","active":true});
      
      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"60.0000000000","voteRshareSum":"60.0000000000"}');

      let votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":10000,"rshares":"60.0000000000","curationWeight":"7.7459666924","timestamp":1527811200000,"voter":"voter1"}]');
  });

  it('pays out maxPostsProcessedPerRound and respects voteQueryLimit', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1.03", curationRewardCurveParameter: "0.7"});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'comments', 'updateParams', '{ "maxPostsProcessedPerRound": 1, "maxVotesProcessedPerRound": 2, "voteQueryLimit": 2 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let params = await fixture.database.findOne({ contract: 'comments', table: 'params', query: {}});
      assert.equal(params.maxPostsProcessedPerRound, 1);
      assert.equal(params.maxVotesProcessedPerRound, 2);
      assert.equal(params.voteQueryLimit, 2);

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"10.0000000000"}}');
      let vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9800,"downvotingPower":10000}');
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"10.7151930523","active":true});

      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"10.0000000000"}');

      let votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","weight":10000,"rshares":"10.0000000000","curationWeight":"5.0118723362","timestamp":1527811200000,"voter":"voter1"}]');

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test2", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'commentOptions', '{ "author": "author1", "permlink": "test2", "maxAcceptedPayout": "1000000.000 HBD", "beneficiaries": [{"account": "bene1", "weight": 5000}, {"account": "bene2", "weight": 1}]}'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test2", "weight": 10000 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter2", "author": "author1", "permlink": "test2", "weight": 8000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'newComment')), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[2].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"9.8000000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[3].logs).events[0]), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"TKN","rshares":"8.0000000000"}}');
      vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9604,"downvotingPower":10000}');
      let vp2 = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter2', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp2), '{"_id":{"rewardPoolId":1,"account":"voter2"},"rewardPoolId":1,"account":"voter2","lastVoteTimestamp":1527811200000,"votingPower":9840,"downvotingPower":10000}');

      let post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test2","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"17.8000000000","voteRshareSum":"17.8000000000","beneficiaries":[{"account":"bene1","weight":5000},{"account":"bene2","weight":1}],"declinePayout":false}');
      let votes2 = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      // weights are 9.8^0.7 vs 17.8^0.7 - 9.8^0.7
      assert.equal(JSON.stringify(votes2), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter1"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":10000,"rshares":"9.8000000000","curationWeight":"4.9414937793","timestamp":1527811200000,"voter":"voter1"},{"_id":{"rewardPoolId":1,"authorperm":"@author1/test2","voter":"voter2"},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","weight":8000,"rshares":"8.0000000000","curationWeight":"2.5625265445","timestamp":1527811200000,"voter":"voter2"}]');

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"30.1210400252","active":true});

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302398.50000000","lastRewardTimestamp":1528415997000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"30.1203427857","active":true,"intervalPendingClaims":"30.1203427857","intervalRewardPool":"15.00000000"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"1.50000000"}}');
      // reward pool should be 302400, calc will be ~ 10^1.03  / (30.1203427857*(1 - 3/(15*24*3600)) + 10^1.03 + 17.8^1.03) * 302400 * 0.5
      // ~26894.12143379302 (rounding affects result)
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":"26894.12143368"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter1')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"voter1","quantity":"26894.12143368"}}');
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test2'), undefined);
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter1'), undefined);
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter2'), undefined);

      await tableAsserts.assertUserBalances({account: "author1", symbol: "TKN", balance: "13447.06071684", stake: "13447.06071684"});
      await tableAsserts.assertUserBalances({account: "voter1", symbol: "TKN", balance: "13447.06071684", stake: "13457.06071684"});
      await tableAsserts.assertUserBalances({account: "voter2", symbol: "TKN", balance: "0", stake: "10.00000000"});

      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(post, null);
      post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      // not paid out yet
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test2","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"17.8000000000","voteRshareSum":"17.8000000000","beneficiaries":[{"account":"bene1","weight":5000},{"account":"bene2","weight":1}],"declinePayout":false}');

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"248611.75713264","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"60.2413130878","active":true,"intervalPendingClaims":"60.2413130878","intervalRewardPool":"302400.00000000"});

      // forward clock and then pay out second post (3 seconds min gap time)
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:03',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      // reward pool waits for last interval to finish processing
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract'), undefined);
      // ratio between author rewards should satisfy rshares1^a / rshares2^a ~ payout1 / payout2
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1'), undefined);
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter1'), undefined);
      // Votes have finished processing, but post has not paid out yet (vote limit matched exactly votes remaining)
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test2'), undefined);
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter1')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"voter1","quantity":"32074.08052775"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter2')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"voter2","quantity":"16632.76054036"}}');

      await tableAsserts.assertUserBalances({account: "author1", symbol: "TKN", balance: "13447.06071684", stake: "13447.06071684"});
      await tableAsserts.assertUserBalances({account: "voter1", symbol: "TKN", balance: "29484.10098072", stake: "29494.10098071"});
      await tableAsserts.assertUserBalances({account: "voter2", symbol: "TKN", balance: "8316.38027018", stake: "8326.38027018"});

      post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test2","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test2","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"17.8000000000","voteRshareSum":"17.8000000000","beneficiaries":[{"account":"bene1","weight":5000},{"account":"bene2","weight":1}],"declinePayout":false}');

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"248611.75713264","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"60.2413130878","active":true,"intervalPendingClaims":"60.2413130878","intervalRewardPool":"302400.00000000"});

      // forward clock and then finish paying out second post (3 seconds min gap time)
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:06',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      // reward pool waits for last interval to finish processing
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract'), undefined);
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test2')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test2","symbol":"TKN","account":"author1","quantity":"24348.54984996"}}');
      // curation reward in last block
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter1'), undefined);
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test2' && ev.data.account === 'voter2'), undefined);

      await tableAsserts.assertUserBalances({account: "author1", symbol: "TKN", balance: "25621.33564182", stake: "25621.33564182"});
      await tableAsserts.assertUserBalances({account: "bene1", symbol: "TKN", balance: "12176.71026703", stake: "12176.71026703"});
      await tableAsserts.assertUserBalances({account: "bene2", symbol: "TKN", balance: "2.43534210", stake: "2.43534200"});
      await tableAsserts.assertUserBalances({account: "voter1", symbol: "TKN", balance: "29484.10098072", stake: "29494.10098071"});
      await tableAsserts.assertUserBalances({account: "voter2", symbol: "TKN", balance: "8316.38027018", stake: "8326.38027018"});

      post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test2" }});
      assert.equal(post2, null);

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"151198.07499640","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"60.2413130878","active":true,"intervalPendingClaims":"60.2413130878","intervalRewardPool":"302400.00000000"});

      // forward clock and then finalize reward interval (3 seconds min gap time)
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:09',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      // check that lastClaimDecayTimestamp has advanced
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"151198.07499640","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528416000000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.7","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"60.2413130878","active":true,"intervalPendingClaims":"60.2413130878","intervalRewardPool":"302400.00000000"});
  });

  it('processes maintenanceTokensPerBlock per block', async () => {
      await fixture.setUp();
      let transactions = [];
      let refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokensContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(miningContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tokenfundsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(commentsContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "harpagon", "quantity": "3000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "ABC", "precision": 4, "maxSupply": "1000000000" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'enableStaking', '{ "symbol": "ABC", "unstakingCooldown": 7, "numberTransactions": 1, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'comments', 'createRewardPool', '{ "symbol": "ABC", "config": { "postRewardCurve": "power", "postRewardCurveParameter": "2", "curationRewardCurve": "power", "curationRewardCurveParameter": "1", "curationRewardPercentage": 75, "cashoutWindowDays": 7, "rewardPerInterval": "0.5", "rewardIntervalSeconds": 6, "voteRegenerationDays": 5, "downvoteRegenerationDays": 5, "stakedRewardPercentage": 50, "votePowerConsumption": 300, "downvotePowerConsumption": 1000, "tags":["scottest"], "disableDownvote": false, "ignoreDeclinePayout": false }, "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'issue', '{ "symbol": "ABC", "quantity": "1000", "to": "harpagon", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'stake', '{ "symbol": "ABC", "quantity": "50", "to": "voter1", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'comments', 'updateParams', '{ "maintenanceTokensPerBlock": 1 }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      let params = await fixture.database.findOne({ contract: 'comments', table: 'params', query: {}});
      assert.equal(params.maintenanceTokensPerBlock, 1);

      await setUpRewardPool({ postRewardCurveParameter: "1.03", curationRewardCurveParameter: "0.5"});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(evt => evt.data.symbol === "TKN")), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":2,"symbol":"TKN"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(evt => evt.data.symbol === "ABC")), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"ABC"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events.find(evt => evt.data.symbol === "TKN")), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":2,"symbol":"TKN","rshares":"10.0000000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[1].logs).events.find(evt => evt.data.symbol === "ABC")), '{"contract":"comments","event":"newVote","data":{"rewardPoolId":1,"symbol":"ABC","rshares":"50.0000000000"}}');

      let vp = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 1}});
      assert.equal(JSON.stringify(vp), '{"_id":{"rewardPoolId":1,"account":"voter1"},"rewardPoolId":1,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9700,"downvotingPower":10000}');
      let vp2 = await fixture.database.findOne({ contract: 'comments', table: 'votingPower', query: { account: 'voter1', rewardPoolId: 2}});
      assert.equal(JSON.stringify(vp2), '{"_id":{"rewardPoolId":2,"account":"voter1"},"rewardPoolId":2,"account":"voter1","lastVoteTimestamp":1527811200000,"votingPower":9800,"downvotingPower":10000}');
      await assertPool({"_id":1,"symbol":"ABC","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"2","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":75,"cashoutWindowDays":7,"rewardPerInterval":"0.5","rewardIntervalSeconds":6,"voteRegenerationDays":5,"downvoteRegenerationDays":5,"stakedRewardPercentage":50,"votePowerConsumption":300,"downvotePowerConsumption":1000,"tags":["scottest"]},"pendingClaims":"2500.0000000000","active":true});
      await assertPool({"_id":2,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"10.7151930523","active":true});

      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"ABC","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"50.0000000000","voteRshareSum":"50.0000000000"}');
      let post2 = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 2, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post2), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":2},"rewardPoolId":2,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"10.0000000000"}');

      let votes = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes), '[{"_id":{"rewardPoolId":1,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":1,"symbol":"ABC","authorperm":"@author1/test1","weight":10000,"rshares":"50.0000000000","curationWeight":"50.0000000000","timestamp":1527811200000,"voter":"voter1"}]');
      let votes2 = await fixture.database.find({ contract: 'comments', table: 'votes', query: { rewardPoolId: 2, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(votes2), '[{"_id":{"rewardPoolId":2,"authorperm":"@author1/test1","voter":"voter1"},"rewardPoolId":2,"symbol":"TKN","authorperm":"@author1/test1","weight":10000,"rshares":"10.0000000000","curationWeight":"3.1622776601","timestamp":1527811200000,"voter":"voter1"}]');

      // forward 11 blocks and verify maintenance
      // because it just did one round above, it will start with TKN (id=2)
      const tokensIssued = {
          'TKN': BigNumber(0),
          'ABC': BigNumber(0),
      };
      for (let i = 0; i < 11; i += 1) {
        transactions = [];
        refBlockNumber = fixture.getNextRefBlockNumber();
        transactions.push(maintenanceOp(refBlockNumber));
        block = {
          refHiveBlockNumber: refBlockNumber,
          refHiveBlockId: 'ABCD1',
          prevRefHiveBlockId: 'ABCD2',
          timestamp: new Date(new Date('2018-06-01T00:00:00.000Z').getTime() + ((i + 1) * 3000)).toISOString().replace('.000Z',''),
          transactions,
        };

        await fixture.sendBlock(block);
        res = await fixture.database.getLatestBlockInfo();
        await tableAsserts.assertNoErrorInLastBlock();
        if (res.transactions) {
          res.transactions.forEach(t => {
            const logs = JSON.parse(t.logs);
            if (logs) {
              const events = logs.events;
              if (events) {
                const issueContractEvent = events.find(ev => ev.event === 'issueToContract');
                if (issueContractEvent) {
                  tokensIssued[issueContractEvent.data.symbol] = tokensIssued[issueContractEvent.data.symbol].plus(issueContractEvent.data.quantity);
                }
              }
            }
          });
        }
      }
      assert.equal(tokensIssued['ABC'].toFixed(), '2.5');  // 5*0.5
      assert.equal(tokensIssued['TKN'].toFixed(), '9');  // 6*1.5

      await assertPool({"_id":1,"symbol":"ABC","rewardPool":"2.5000","lastRewardTimestamp":1527811230000,"lastClaimDecayTimestamp":1527811230000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"2","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":75,"cashoutWindowDays":7,"rewardPerInterval":"0.5","rewardIntervalSeconds":6,"voteRegenerationDays":5,"downvoteRegenerationDays":5,"stakedRewardPercentage":50,"votePowerConsumption":300,"downvotePowerConsumption":1000,"tags":["scottest"]},"pendingClaims":"2499.9421301652","active":true,"intervalPendingClaims":"2499.9421301652","intervalRewardPool":"2.5000"});
      await assertPool({"_id":2,"symbol":"TKN","rewardPool":"9.00000000","lastRewardTimestamp":1527811218000,"lastClaimDecayTimestamp":1527811218000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"10.7150442307","active":true,"intervalPendingClaims":"10.7150442307","intervalRewardPool":"9.00000000"});

      // forward clock and mock state. Since it processes 1 token per block,
      // it will not have caught up with maintenance, but let's pretend it has
      rewardPool = await fixture.database.findOne({ contract: 'comments', table: 'rewardPools', query: { _id: 1}});
      rewardPool.lastClaimDecayTimestamp = new Date('2018-06-07T23:59:54.000Z').getTime();
      rewardPool.lastRewardTimestamp = new Date('2018-06-07T23:59:54.000Z').getTime();
      rewardPool.rewardPool = '50399.50000000';
      await fixture.database.update({ contract: 'comments', table: 'rewardPools', record: rewardPool });

      let tokensContractBalance = await fixture.database.findOne({ contract: 'tokens', table: 'contractsBalances', query: { account: 'comments', symbol: 'ABC'}});
      tokensContractBalance.balance = '50399.50000000';
      await fixture.database.update({ contract: 'tokens', table: 'contractsBalances', record: tokensContractBalance });

      rewardPool2 = await fixture.database.findOne({ contract: 'comments', table: 'rewardPools', query: { _id: 2}});
      rewardPool2.lastClaimDecayTimestamp = new Date('2018-06-07T23:59:57.000Z').getTime();
      rewardPool2.lastRewardTimestamp = new Date('2018-06-07T23:59:57.000Z').getTime();
      rewardPool2.rewardPool = '302398.50000000';
      await fixture.database.update({ contract: 'comments', table: 'rewardPools', record: rewardPool2 });

      tokensContractBalance = await fixture.database.findOne({ contract: 'tokens', table: 'contractsBalances', query: { account: 'comments', symbol: 'TKN'}});
      tokensContractBalance.balance = '302398.50000000';
      await fixture.database.update({ contract: 'tokens', table: 'contractsBalances', record: tokensContractBalance });

      // forward clock and process one token (two comment actions, but should only process once)
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract' && ev.data.symbol === 'ABC')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"ABC","quantity":"0.5000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1' && ev.data.symbol === 'ABC')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"ABC","account":"author1","quantity":"6300.0875"}}');
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract' && ev.data.symbol === 'TKN'), undefined);
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1' && ev.data.symbol === 'TKN'), undefined);
      assert.equal(JSON.parse(res.transactions[1].logs).events, undefined);

      // forward clock and process one token (two comment actions, but should only process once)
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(maintenanceOp(refBlockNumber));
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:03',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract' && ev.data.symbol === 'ABC'), undefined);
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1' && ev.data.symbol === 'ABC'), undefined);
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract' && ev.data.symbol === 'TKN')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"1.50000000"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1' && ev.data.symbol === 'TKN')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":2,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":"75600.61250209"}}');
      assert.equal(JSON.parse(res.transactions[1].logs).events, undefined);

      await assertPool({"_id":1,"symbol":"ABC","rewardPool":"25199.6500","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528416000000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"2","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":75,"cashoutWindowDays":7,"rewardPerInterval":"0.5","rewardIntervalSeconds":6,"voteRegenerationDays":5,"downvoteRegenerationDays":5,"stakedRewardPercentage":50,"votePowerConsumption":300,"downvotePowerConsumption":1000,"tags":["scottest"]},"pendingClaims":"4999.9305563590","active":true,"intervalPendingClaims":"4999.9305563590","intervalRewardPool":"50400.0000"});
      await assertPool({"_id":2,"symbol":"TKN","rewardPool":"151198.77499582","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528416000000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1.03","curationRewardCurve":"power","curationRewardCurveParameter":"0.5","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"21.4302124796","active":true,"intervalPendingClaims":"21.4302124796","intervalRewardPool":"302400.00000000"});
  });

  it('pays beneficiary', async () => {
      await fixture.setUp();
      await runBeneficiaryTest({});
  });

  it('pays beneficiary with all muted users', async () => {
      await fixture.setUp();
      await runBeneficiaryTest({ muteAll: true });
  });

  it('pays beneficiary with app tax', async () => {
      await fixture.setUp();

      await runBeneficiaryTest({ appTaxConfig: {
          app: "neoxiancity",
          percent: 50,
          beneficiary: "neoxianburn",
      }});
  });

  it('pays beneficiary with 100% app tax', async () => {
      await fixture.setUp();

      await runBeneficiaryTest({ appTaxConfig: {
          app: "neoxiancity",
          percent: 100,
          beneficiary: "neoxianburn",
      }});
  });

  it('pays beneficiary with exempt app tax', async () => {
      await fixture.setUp();

      await runBeneficiaryTest({ appTaxConfig: {
          app: "neoxiancity",
          percent: 50,
          beneficiary: "neoxianburn",
      }});
  });

  it('does not pay for post declined payout', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "1"});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'commentOptions', '{ "author": "author1", "permlink": "test1", "maxAcceptedPayout": "0.000 HBD", "beneficiaries": [{"account": "bene1", "weight": 5000}, {"account": "bene2", "weight": 1}]}'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"10.0000000000","beneficiaries":[{"account":"bene1","weight":5000},{"account":"bene2","weight":1}],"declinePayout":true}');

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302398.50000000","lastRewardTimestamp":1528415997000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"9.9997685205","active":true,"intervalPendingClaims":"9.9997685205","intervalRewardPool":"15.00000000"});

      // forward clock past payout time
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // this transaction pays out with maintenance op
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":"0"}}');
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'beneficiaryReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'bene1'), undefined);
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'beneficiaryReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'bene2'), undefined);
      assert.equal(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter1'), undefined);

      await tableAsserts.assertUserBalances({account: "author1", symbol: "TKN", balance: 0, stake: 0});
      await tableAsserts.assertUserBalances({account: "bene1", symbol: "TKN", balance: 0, stake: 0});
      await tableAsserts.assertUserBalances({account: "bene2", symbol: "TKN", balance: 0, stake: 0});
      await tableAsserts.assertUserBalances({account: "voter1", symbol: "TKN", balance: "0", stake: "10.00000000"});

      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(post, null);

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302400.00000000","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528416000000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"19.9997453728","active":true,"intervalPendingClaims":"19.9997453728","intervalRewardPool":"302400.00000000"});
  });

  it('ignores declined payout with ignoreDeclinePayout', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "1", ignoreDeclinePayout: true});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'comment', '{ "author": "author1", "permlink": "test1", "jsonMetadata": {"tags": ["scottest"]} }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'commentOptions', '{ "author": "author1", "permlink": "test1", "maxAcceptedPayout": "0.000 HBD", "beneficiaries": [{"account": "bene1", "weight": 5000}, {"account": "bene2", "weight": 1}]}'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'comments', 'vote', '{ "voter": "voter1", "author": "author1", "permlink": "test1", "weight": 10000 }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events[0]), '{"contract":"comments","event":"newComment","data":{"rewardPoolId":1,"symbol":"TKN"}}');
      let post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(JSON.stringify(post), '{"_id":{"authorperm":"@author1/test1","rewardPoolId":1},"rewardPoolId":1,"symbol":"TKN","authorperm":"@author1/test1","author":"author1","created":1527811200000,"cashoutTime":1528416000000,"votePositiveRshareSum":"10.0000000000","voteRshareSum":"10.0000000000","beneficiaries":[{"account":"bene1","weight":5000},{"account":"bene2","weight":1}]}');

      // catch up post maintenance
      await forwardPostMaintenanceAndAssertIssue('2018-06-07T23:59:57', "302398.50000000");
      let rewardPool = await fixture.database.findOne({ contract: 'comments', table: 'rewardPools', query: { _id: 1}});
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"302398.50000000","lastRewardTimestamp":1528415997000,"lastClaimDecayTimestamp":1528415997000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"], "ignoreDeclinePayout": true},"pendingClaims":"9.9997685205","active":true,"intervalPendingClaims":"9.9997685205","intervalRewardPool":"15.00000000"});

      // forward clock past payout time
      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // this transaction pays out with maintenance op
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-08T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'authorReward' && ev.data.authorperm === '@author1/test1')), '{"contract":"comments","event":"authorReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"author1","quantity":"37792.92115529"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'beneficiaryReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'bene1')), '{"contract":"comments","event":"beneficiaryReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"bene1","quantity":"37800.48125153"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'beneficiaryReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'bene2')), '{"contract":"comments","event":"beneficiaryReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"bene2","quantity":"7.56009625"}}');
      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'curationReward' && ev.data.authorperm === '@author1/test1' && ev.data.account === 'voter1')), '{"contract":"comments","event":"curationReward","data":{"rewardPoolId":1,"authorperm":"@author1/test1","symbol":"TKN","account":"voter1","quantity":"75600.96250306"}}');

      await tableAsserts.assertUserBalances({account: "author1", symbol: "TKN", balance: "18896.46057765", stake: "18896.46057764"});
      await tableAsserts.assertUserBalances({account: "bene1", symbol: "TKN", balance: "18900.24062577", stake: "18900.24062576"});
      await tableAsserts.assertUserBalances({account: "bene2", symbol: "TKN", balance: "3.78004813", stake: "3.78004812"});
      await tableAsserts.assertUserBalances({account: "voter1", symbol: "TKN", balance: "37800.48125153", stake: "37810.48125153"});

      post = await fixture.database.findOne({ contract: 'comments', table: 'posts', query: { rewardPoolId: 1, authorperm: "@author1/test1" }});
      assert.equal(post, null);

      rewardPool = await fixture.database.findOne({ contract: 'comments', table: 'rewardPools', query: { _id: 1}});
      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"151198.07499387","lastRewardTimestamp":1528416000000,"lastClaimDecayTimestamp":1528416000000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"1.5","rewardIntervalSeconds":3,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"19.9997453728","active":true,"intervalPendingClaims":"19.9997453728","intervalRewardPool":"302400.00000000"});
  });

  it('inserts correct amount to reward pool', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "1", "rewardPerInterval": "0.01", "rewardIntervalSeconds": 6});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // this transaction will trigger maintenance op
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:03',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();

      let contractBalance = await fixture.database.findOne({ contract: 'tokens', table: 'contractsBalances', query: { "account": "comments", "symbol": "TKN" }});
      assert.equal(null, contractBalance);

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"0.01","rewardIntervalSeconds":6,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"0","active":true});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // this transaction will trigger maintenance op
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:06',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract' && ev.data.symbol === 'TKN')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"0.01000000"}}');

      contractBalance = await fixture.database.findOne({ contract: 'tokens', table: 'contractsBalances', query: { "account": "comments", "symbol": "TKN" }});
      assert.equal(JSON.stringify(contractBalance), '{"_id":1,"account":"comments","symbol":"TKN","balance":"0.01000000","stake":"0","pendingUnstake":"0","delegationsIn":"0","delegationsOut":"0","pendingUndelegations":"0"}');

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0.01000000","lastRewardTimestamp":1527811206000,"lastClaimDecayTimestamp":1527811206000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"0.01","rewardIntervalSeconds":6,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"]},"pendingClaims":"0.0000000000","active":true,"intervalPendingClaims":"0.0000000000","intervalRewardPool":"0.01000000"});
  });

it('inserts correct amount to reward pool with reduction', async () => {
      await fixture.setUp();

      await setUpRewardPool({ postRewardCurveParameter: "1", curationRewardCurveParameter: "1", "rewardPerInterval": "0.01", "rewardIntervalSeconds": 6, "rewardReductionPercentage": "0.5", "rewardReductionIntervalSeconds": 12});

      let transactions;
      let refBlockNumber;
      let block;

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // this transaction will trigger maintenance op
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:03',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();
      let res = await fixture.database.getLatestBlockInfo();

      let contractBalance = await fixture.database.findOne({ contract: 'tokens', table: 'contractsBalances', query: { "account": "comments", "symbol": "TKN" }});
      assert.equal(null, contractBalance);

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0","lastRewardTimestamp":1527811200000,"lastClaimDecayTimestamp":1527811200000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"0.01","rewardIntervalSeconds":6,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"],"rewardReductionPercentage":"0.5","rewardReductionIntervalSeconds":12},"pendingClaims":"0","active":true,"lastRewardReductionTimestamp":1527811200000});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // this transaction will trigger maintenance op
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:06',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract' && ev.data.symbol === 'TKN')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"0.01000000"}}');

      contractBalance = await fixture.database.findOne({ contract: 'tokens', table: 'contractsBalances', query: { "account": "comments", "symbol": "TKN" }});
      assert.equal(JSON.stringify(contractBalance), '{"_id":1,"account":"comments","symbol":"TKN","balance":"0.01000000","stake":"0","pendingUnstake":"0","delegationsIn":"0","delegationsOut":"0","pendingUndelegations":"0"}');

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0.01000000","lastRewardTimestamp":1527811206000,"lastClaimDecayTimestamp":1527811206000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"0.01","rewardIntervalSeconds":6,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"],"rewardReductionPercentage":"0.5","rewardReductionIntervalSeconds":12},"pendingClaims":"0.0000000000","active":true,"intervalPendingClaims":"0.0000000000","intervalRewardPool":"0.01000000","lastRewardReductionTimestamp":1527811200000});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // this transaction will trigger maintenance op
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:12',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract' && ev.data.symbol === 'TKN')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"0.00995000"}}');

      contractBalance = await fixture.database.findOne({ contract: 'tokens', table: 'contractsBalances', query: { "account": "comments", "symbol": "TKN" }});
      assert.equal(JSON.stringify(contractBalance), '{"_id":1,"account":"comments","symbol":"TKN","balance":"0.01995000","stake":"0","pendingUnstake":"0","delegationsIn":"0","delegationsOut":"0","pendingUndelegations":"0"}');

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0.01995000","lastRewardTimestamp":1527811212000,"lastClaimDecayTimestamp":1527811212000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"0.00995000","rewardIntervalSeconds":6,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"],"rewardReductionPercentage":"0.5","rewardReductionIntervalSeconds":12},"pendingClaims":"0.0000000000","active":true,"intervalPendingClaims":"0.0000000000","intervalRewardPool":"0.01995000","lastRewardReductionTimestamp":1527811212000});

      transactions = [];
      refBlockNumber = fixture.getNextRefBlockNumber();
      // this transaction will trigger maintenance op
      transactions.push(maintenanceOp(refBlockNumber));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:18',
        transactions,
      };

      await fixture.sendBlock(block);
      res = await fixture.database.getLatestBlockInfo();
      await tableAsserts.assertNoErrorInLastBlock();

      assert.equal(JSON.stringify(JSON.parse(res.transactions[0].logs).events.find(ev => ev.event === 'issueToContract' && ev.data.symbol === 'TKN')), '{"contract":"tokens","event":"issueToContract","data":{"from":"tokens","to":"comments","symbol":"TKN","quantity":"0.00995000"}}');

      contractBalance = await fixture.database.findOne({ contract: 'tokens', table: 'contractsBalances', query: { "account": "comments", "symbol": "TKN" }});
      assert.equal(JSON.stringify(contractBalance), '{"_id":1,"account":"comments","symbol":"TKN","balance":"0.02990000","stake":"0","pendingUnstake":"0","delegationsIn":"0","delegationsOut":"0","pendingUndelegations":"0"}');

      await assertPool({"_id":1,"symbol":"TKN","rewardPool":"0.02990000","lastRewardTimestamp":1527811218000,"lastClaimDecayTimestamp":1527811218000,"createdTimestamp":1527811200000,"config":{"postRewardCurve":"power","postRewardCurveParameter":"1","curationRewardCurve":"power","curationRewardCurveParameter":"1","curationRewardPercentage":50,"cashoutWindowDays":7,"rewardPerInterval":"0.00995000","rewardIntervalSeconds":6,"voteRegenerationDays":14,"downvoteRegenerationDays":14,"stakedRewardPercentage":50,"votePowerConsumption":200,"downvotePowerConsumption":2000,"tags":["scottest"],"rewardReductionPercentage":"0.5","rewardReductionIntervalSeconds":12},"pendingClaims":"0.0000000000","active":true,"intervalPendingClaims":"0.0000000000","intervalRewardPool":"0.02990000","lastRewardReductionTimestamp":1527811212000});
  });
});
