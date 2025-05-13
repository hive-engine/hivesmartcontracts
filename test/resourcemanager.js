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

const fixture = new Fixture();
const tableAsserts = new TableAsserts(fixture);

// test cases for resourcemanager smart contract
describe('resourcemanager', function () {
  this.timeout(1000000);

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

  async function initializeResourceManager() {
     // Initialize new resourcemanager contract before starting block 95935754 
     let refBlockNumber = 95935753;
     let transactions = [];
     // deploy contracts
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(ContractPayload)));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(ContractPayload)));
     
     // Create BEED token if not already available
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "url": "https://token.com", "symbol": "BEED", "precision": 8, "maxSupply": "1000" }'));
     // Issue some tokens to drew
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "BEED", "to": "drew", "quantity": "1", "isSignedWithActiveKey": true }'));

     let block = {
       refHiveBlockNumber: refBlockNumber,
       refHiveBlockId: 'ABCD1',
       prevRefHiveBlockId: 'ABCD2',
       timestamp: '2025-05-12T16:30:00',
       transactions,
     };
     
     // process all transactions defined above in block
     await fixture.sendBlock(block);
  }

  it('one action per block is free', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      await initializeResourceManager();

      // one transaction should be free
      let refBlockNumber = 95935754;
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "0.5", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      
      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };
      await fixture.sendBlock(block);

      let res = await fixture.database.getBlockInfo(2);

      let txLogs = JSON.parse(res.transactions[0].logs);
      assert.ok(!txLogs.errors || txLogs.errors.length === 0, 'First transaction should not have errors');
      await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.50000000' });
      await tableAsserts.assertUserBalances({ account: 'drewlongshot', symbol: 'BEED', balance: '0.5' });

      ++refBlockNumber;
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "0.5", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      
      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };
      await fixture.sendBlock(block);
      res = await fixture.database.getBlockInfo(3);

      txLogs = JSON.parse(res.transactions[0].logs);
      assert.ok(!txLogs.errors || txLogs.errors.length === 0, 'First transaction should not have errors');
      await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.00000000' });
      await tableAsserts.assertUserBalances({ account: 'drewlongshot', symbol: 'BEED', balance: '1.00000000' });

     resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('two or more actions costs', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      await initializeResourceManager();

      // one transaction should be free
      let refBlockNumber = 95935754;
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "0.001", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "0.001", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      
      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };
      await fixture.sendBlock(block);

      const res = await fixture.database.getBlockInfo(2);

      const logs0 = JSON.parse(res.transactions[0].logs);
      const logs1 = JSON.parse(res.transactions[1].logs);

      assert.ok(!logs0.errors || logs0.errors.length === 0, 'First transaction should be free and succeed');
      assert.ok(!logs1.errors || logs1.errors.length === 0 || logs1.events.length != 3, 'Second transaction should succeed but incur burn');

      await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.99700000' });
      await tableAsserts.assertUserBalances({ account: 'drewlongshot', symbol: 'BEED', balance: '0.00200000' });

     resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('more actions more costs', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      await initializeResourceManager();

      // one transaction should be free
      let refBlockNumber = 95935754;
      transactions = [];
      for(let i = 0; i < 50; i++) {
        transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "0.001", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      }
      
      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };
      await fixture.sendBlock(block);

      const res = await fixture.database.getBlockInfo(2);

      const logs0 = JSON.parse(res.transactions[0].logs);
      const logs1 = JSON.parse(res.transactions[1].logs);

      assert.ok(!logs0.errors || logs0.errors.length === 0, 'First transaction should be free and succeed');
      assert.ok(!logs1.errors || logs1.errors.length === 0 || logs1.events.length != 3, 'Second transaction should succeed but incur burn');

      await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.90100000' });
      await tableAsserts.assertUserBalances({ account: 'drewlongshot', symbol: 'BEED', balance: '0.05000000' });

     resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('add to denyList and get blocked', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      await initializeResourceManager();

      // one transaction should be free
      let refBlockNumber = 95935754;
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateAccount', '{"account": "drew", "isDenied": true}' ));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "0.001", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "0.001", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      
      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2025-05-12T16:30:03',
        transactions,
      };
      await fixture.sendBlock(block);

      const res = await fixture.database.getBlockInfo(2);

      // first tx (addAccount) has no errors
      const log0 = JSON.parse(res.transactions[0].logs);
      assert.ok(!log0.errors || log0.errors.length === 0);

      const logs1 = JSON.parse(res.transactions[1].logs);
      assert.ok(!logs1.errors || logs1.errors.length === 0, 'First action from drew should succeed');

      const logs2 = JSON.parse(res.transactions[2].logs);
      assert.equal(logs2.errors[0], 'max transaction limit per day reached.');

     resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });
  
  it('denyList 24h check', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      await initializeResourceManager();

      // one transaction should be free
      let refBlockNumber = 95935754;
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateAccount', '{"account": "drew", "isDenied": true}' ));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "0.001", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "0.001", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      
      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2025-05-12T16:30:03',
        transactions,
      };
      await fixture.sendBlock(block);

      let res = await fixture.database.getBlockInfo(2);
      const log0 = JSON.parse(res.transactions[0].logs);
      assert.ok(!log0.errors || log0.errors.length === 0);

      let logs1 = JSON.parse(res.transactions[1].logs);
      assert.ok(!logs1.errors || logs1.errors.length === 0, 'First action from drew should succeed');

      let logs2 = JSON.parse(res.transactions[2].logs);
      assert.equal(logs2.errors[0], 'max transaction limit per day reached.');

      refBlockNumber = 95935755;
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "0.001", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "0.001", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      
      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2025-05-13T16:30:03',
        transactions,
      };
      await fixture.sendBlock(block);

      res = await fixture.database.getBlockInfo(3);

      logs1 = JSON.parse(res.transactions[0].logs);
      assert.ok(!logs1.errors || logs1.errors.length === 0, 'First action from drew should succeed');

      logs2 = JSON.parse(res.transactions[1].logs);
      assert.equal(logs2.errors[0], 'max transaction limit per day reached.');

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });
});
