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
const bdContractPayload = setupContractPayload('beedollar', './contracts/beedollar.js');

const fixture = new Fixture();
const tableAsserts = new TableAsserts(fixture);

// test cases for beedollar smart contract
describe('beedollar', function () {
  this.timeout(200000);

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
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'beedollar', 'updateParams', '{ "minConvertibleAmount": "5.5", "feePercentage": "0.025" }'));

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
        contract: 'beedollar',
        table: 'params',
        query: {}
      });

      console.log(params);

      assert.equal(params.minConvertibleAmount, '5.5');
      assert.equal(params.feePercentage, '0.025');

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('rejects invalid parameters', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'beedollar', 'updateParams', '{ "minConvertibleAmount": "5.5", "feePercentage": "0.025" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'beedollar', 'updateParams', '{ "wrongKey": "oops"  }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'beedollar', 'updateParams', '{ "minConvertibleAmount": 5 }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      // params should not have changed from their initial values
      const params = await fixture.database.findOne({
        contract: 'beedollar',
        table: 'params',
        query: {}
      });

      console.log(params);

      assert.equal(params.minConvertibleAmount, '1');
      assert.equal(params.feePercentage, '0.01');

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('converts BEE to BEE Dollars', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "aggroed", "quantity": "1000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'beedollar', 'convert', '{ "quantity": "10.0", "isSignedWithActiveKey": true }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      // confirm that BEE was burned in the convert
      let res = await fixture.database.findOne({
        contract: 'tokens',
        table: 'balances',
        query: {
          account: 'aggroed',
          symbol: CONSTANTS.UTILITY_TOKEN_SYMBOL
        }
      });
      console.log(`BEE balance: ${res.balance}`);
      //assert.equal(res.balance, '990.00000000');

      // confirm that BEED was issued
      res = await fixture.database.findOne({
        contract: 'tokens',
        table: 'balances',
        query: {
          account: 'aggroed',
          symbol: 'BEED'
        }
      });
      if (res && res.balance) {
        console.log(`BEED balance: ${res.balance}`);
      }

      // confirm that BEED was bootstrapped into existence OK
      const token = await fixture.database.findOne({
        contract: 'tokens',
        table: 'tokens',
        query: {
          symbol: 'BEED',
        }
      });
      console.log(token);
      assert.equal(token.issuer, 'null');
      assert.equal(token.symbol, 'BEED');
      assert.equal(token.name, 'BeeD');
      assert.equal(token.metadata, '{"url":"https://tribaldex.com","icon":"https://cdn.tribaldex.com/tribaldex/token-icons/BEE.png","desc":"BEED is the native stablecoin for the Hive Engine platform. You can mint new BEED by burning BEE."}');
      assert.equal(token.precision, 4);
      assert.equal(token.maxSupply, '9007199254740991.0000');

      const latestBlock = await fixture.database.getLatestBlockInfo();
      console.log(latestBlock.transactions);

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });
});
