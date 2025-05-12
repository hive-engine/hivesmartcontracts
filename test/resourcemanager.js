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

  it('one action is free', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      await initializeResourceManager();

      // one transaction should be free
      let refBlockNumber = 95935754;
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "quantity": "1", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
      
      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };
      await fixture.sendBlock(block);

      const res = await fixture.database.getBlockInfo(2);

      //TODO: Check if transfer was successfully

     resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('two actions costs', (done) => {
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

      //TODO: Check if transfer was successfully
      //TODO: Check if drew balance has now 0.997 BEED (0.002 sent away + 0.001 burned)

     resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('add to denyList', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      await initializeResourceManager();

      // one transaction should be free
      let refBlockNumber = 95935754;
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'addAccount', '{"denyList": ["drew", "satoshi"]}' ));
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

      //TODO: Check if one transfer was successfully
      //TODO: Second transaction has to be blocked

     resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });
  
});
