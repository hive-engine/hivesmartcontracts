/* eslint-disable */
const assert = require('assert').strict;
const { MongoClient } = require('mongodb');

const { CONSTANTS } = require('../libs/Constants');
const { Database } = require('../libs/Database');
const blockchain = require('../plugins/Blockchain');
const { Transaction } = require('../libs/Transaction');
const { setupContractPayload } = require('../libs/util/contractUtil');
const { Fixture, conf } = require('../libs/util/testing/Fixture');
const { TableAsserts } = require('../libs/util/testing/TableAsserts');
const { assertError } = require('../libs/util/testing/Asserts');


const tknContractPayload = setupContractPayload('tokens', './contracts/tokens.js');
const ContractPayload = setupContractPayload('stopspam', './contracts/stopspam.js');
const mpContractPayload = setupContractPayload('marketpools', './contracts/marketpools.js');

const fixture = new Fixture();
const tableAsserts = new TableAsserts(fixture);

// test cases for stopspam smart contract
describe('stopspam', function () {
  this.timeout(4000);

  before((done) => {
    new Promise(async (resolve) => {
      client = await MongoClient.connect(conf.databaseURL, { useNewUrlParser: true, useUnifiedTopology: true });
      db = await client.db(conf.databaseName);
      await db.dropDatabase();
      resolve();
    })
      .then(() => {
        done()
      })
  });
  
  after((done) => {
    new Promise(async (resolve) => {
      await client.close();
      resolve();
    })
      .then(() => {
        done()
      })
  });

  beforeEach((done) => {
    new Promise(async (resolve) => {
      db = await client.db(conf.databaseName);
      resolve();
    })
      .then(() => {
        done()
      })
  });

  afterEach((done) => {
    // runs after each test in this block
    new Promise(async (resolve) => {
      fixture.tearDown();
      await db.dropDatabase()
      resolve();
    })
      .then(() => {
        done()
      })
  });

  it('updates parameters', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(ContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(ContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'stopspam', 'updateParams', '{ "numberOfFreeTx": "4"}'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'stopspam', 'addAccount', '{ "allowList": ["drew","tim"] , "denyList": ["god0","god1"] }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'stopspam', 'addAccount', '{ "allowList": ["gus","todd"] , "denyList": ["god2","god3"] }'))

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const res = await fixture.database.getBlockInfo(1);

      const block1 = res;
      const transactionsBlock1 = block1.transactions;

      // check if the params updated OK
      const params = await fixture.database.findOne({
        contract: 'stopspam',
        table: 'params',
        query: {}
      });
      console.log(" ")
      console.log( '\u001b[' + 93 + 'm' + 'Test: update params on stopspam.js' + '\u001b[0m')
      console.log("26  ⚪",JSON.parse(transactionsBlock1[4].logs))
      console.log(params);


      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('it counts transactions', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(ContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(ContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "harpagon", "quantity": "100000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'transfer', '{ "symbol": "BEE", "quantity": "1", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'harpagon', 'tokens', 'transfer', '{ "symbol": "BEE", "quantity": "2", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber+1, fixture.getNextTxId(), 'harpagon', 'tokens', 'transfer', '{ "symbol": "BEE", "quantity": "3", "to": "drewlongshot", "isSignedWithActiveKey": true }'));

   let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const res = await fixture.database.getBlockInfo(1);

      const block1 = res;
      const transactionsBlock1 = block1.transactions;

           let res2 = await fixture.database.findOne({
              contract: 'tokens',
              table: 'balances',
              query: {account:'harpagon',}
            });
      
            let token = res2
      

      console.log(" ")
      console.log( '\u001b[' + 93 + 'm' + 'Test: counts transactions by user' + '\u001b[0m')
      // console.log("  ⚪ ",JSON.parse(transactionsBlock1[4].logs))
      // console.log("  ⚪ ",JSON.parse(transactionsBlock1[5].logs))
      // console.log("  ⚪ ",JSON.parse(transactionsBlock1[6].logs))


      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  // it('does not update parameters', (done) => {
  //   new Promise(async (resolve) => {

  //     await fixture.setUp();

  //     let refBlockNumber = fixture.getNextRefBlockNumber();
  //     let transactions = [];
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(ContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(ContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'stopspam', 'updateParams', '{ "numberOfFreeTx": "4", "feePercentage": "0.025" }'));

  //     let block = {
  //       refHiveBlockNumber: refBlockNumber,
  //       refHiveBlockId: 'ABCD1',
  //       prevRefHiveBlockId: 'ABCD2',
  //       timestamp: '2018-06-01T00:00:00',
  //       transactions,
  //     };

  //     await fixture.sendBlock(block);

  //     const res = await fixture.database.getBlockInfo(1);

  //     const block1 = res;
  //     const transactionsBlock1 = block1.transactions;

  //     // check if the params updated OK
  //     const params = await fixture.database.findOne({
  //       contract: 'stopspam',
  //       table: 'params',
  //       query: {}
  //     });
  //     console.log(" ")
  //     console.log( '\u001b[' + 93 + 'm' + 'Test: Does not update params on stopspam.js' + '\u001b[0m')
  //     console.log(params);


  //     resolve();
  //   })
  //     .then(() => {
  //       fixture.tearDown();
  //       done();
  //     });
  // });
});
