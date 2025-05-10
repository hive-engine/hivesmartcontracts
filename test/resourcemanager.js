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
const ContractPayload = setupContractPayload('resourcemanager', './contracts/resourcemanager.js');
const mpContractPayload = setupContractPayload('marketpools', './contracts/marketpools.js');

const fixture = new Fixture();
const tableAsserts = new TableAsserts(fixture);

// test cases for resourcemanager smart contract
describe('resourcemanager', function () {
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

  it('how does block.js function?', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(ContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(ContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "harpagon", "quantity": "100000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber+1, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateParams', '{ "numberOfFreeTx": "4"}'));
      transactions.push(new Transaction(refBlockNumber+1, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'addAccount', '{ "allowList": ["drew","tim"] , "denyList": ["hate","hate1"] }'));
      transactions.push(new Transaction(refBlockNumber+1, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'addAccount', '{ "allowList": ["gus","todd"] , "denyList": ["hate2","hate3"] }'))
      transactions.push(new Transaction(refBlockNumber+2, fixture.getNextTxId(), 'harpagon', 'tokens', 'transfer', '{ "symbol": "BEE", "quantity": "1", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber+2, fixture.getNextTxId(), 'harpagon', 'tokens', 'transfer', '{ "symbol": "BEE", "quantity": "2", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber+2, fixture.getNextTxId(), 'harpagon', 'tokens', 'transfer', '{ "symbol": "BEE", "quantity": "3", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      

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
      const params = await fixture.database.findOne({
        contract: 'resourcemanager',
        table: 'params',
        query: {}
      });
      
            let table = params
      

      console.log(" ")
      console.log( '\u001b[' + 93 + 'm' + 'Test: how does block.js function' + '\u001b[0m')
      console.log(table)

      // console.log(transactions[4])
      // console.log(transactions[5])
      // console.log(transactions[6])

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

});
