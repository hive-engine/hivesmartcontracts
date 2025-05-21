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
const mpContractPayload = setupContractPayload('marketpools', './contracts/marketpools.js');

const fixture = new Fixture();
const tableAsserts = new TableAsserts(fixture);

// test cases for beedollar smart contract
describe('beedollar', function () {
  this.timeout(10000);

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

      const res = await fixture.database.getLatestBlockInfo();

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
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'beedollar', 'updateParams', '{ "wrongKey": "oops" }'));
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
      // first, setup the test
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(mpContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 1
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 2
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "HBD Pegged", "url": "https://hive-engine.com", "symbol": "SWAP.HBD", "precision": 8, "maxSupply": "1000000000000" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "aggroed", "quantity": "1000", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_PEGGED_ACCOUNT, 'tokens', 'transfer', '{ "symbol": "SWAP.HIVE", "to": "aggroed", "quantity": "1000", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "aggroed", "quantity": "1000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "whale", "quantity": "1000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "whale", "quantity": "1000", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "100", "price": "10", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', '{ "symbol": "SWAP.HBD", "quantity": "100", "price": "0.5", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'market', 'buy', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "1", "price": "10", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'market', 'buy', '{ "symbol": "SWAP.HBD", "quantity": "1", "price": "0.5","isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:BEE", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:BEE", "baseQuantity": "200", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }')); 
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "baseQuantity": "200", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:BEE", "tokenSymbol": "SWAP.HIVE", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "tokenSymbol": "SWAP.HBD", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));

      // now, do a convert
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'beedollar', 'convert', '{ "quantity": "10.0", "isSignedWithActiveKey": true }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      let res = await fixture.database.find({
        contract: 'marketpools',
        table: 'pools',
        query: {}
      });
      console.log(res);

      res = await fixture.database.find({
        contract: 'tokens',
        table: 'balances',
        query: {
          account: 'aggroed'
        }
      });
      console.log(res);

      // confirm that BEE was burned in the convert
      await tableAsserts.assertUserBalances({ account: 'aggroed', symbol: `${CONSTANTS.UTILITY_TOKEN_SYMBOL}`, balance: '785.85894222'});

      // confirm that BEED was issued
      await tableAsserts.assertUserBalances({ account: 'aggroed', symbol: 'BEED', balance: '8.9453'});

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
      assert.equal(token.supply, '8.9453');

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('fails to convert BEE to BEE Dollars', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      // first, setup the test
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(mpContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 1
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 2
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "HBD Pegged", "url": "https://hive-engine.com", "symbol": "SWAP.HBD", "precision": 8, "maxSupply": "1000000000000" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "aggroed", "quantity": "1000", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_PEGGED_ACCOUNT, 'tokens', 'transfer', '{ "symbol": "SWAP.HIVE", "to": "aggroed", "quantity": "1000", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "aggroed", "quantity": "1000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "whale", "quantity": "1000", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "whale", "quantity": "1000", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "100", "price": "10", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', '{ "symbol": "SWAP.HBD", "quantity": "100", "price": "0.5", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'market', 'buy', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "1", "price": "10", "isSignedWithActiveKey": true }`));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'market', 'buy', '{ "symbol": "SWAP.HBD", "quantity": "1", "price": "0.5","isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:BEE", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:BEE", "baseQuantity": "200", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "baseQuantity": "200", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:BEE", "tokenSymbol": "SWAP.HIVE", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "tokenSymbol": "SWAP.HBD", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));

      // now, do some converts (all of these should fail)
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'beedollar', 'convert', '{ "quantity": "10.0", "isSignedWithActiveKey": false }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'beedollar', 'convert', '{ "quantity": "abcdef", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'beedollar', 'convert', '{ "quantity": "0.99", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'beedollar', 'convert', '{ "quantity": "-5", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'beedollar', 'convert', '{ "quantity": "5.123456789", "isSignedWithActiveKey": true }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'beedollar', 'convert', '{ "quantity": "5000", "isSignedWithActiveKey": true }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      // confirm that no BEE was burned
      await tableAsserts.assertUserBalances({ account: 'aggroed', symbol: `${CONSTANTS.UTILITY_TOKEN_SYMBOL}`, balance: '795.85894222'});

      // confirm that no BEED was issued
      await tableAsserts.assertUserBalances({ account: 'aggroed', symbol: 'BEED' });

      const token = await fixture.database.findOne({
        contract: 'tokens',
        table: 'tokens',
        query: {
          symbol: 'BEED',
        }
      });
      console.log(token);
      assert.equal(token.supply, '0');

      const latestBlock = await fixture.database.getLatestBlockInfo();
      const transactionsBlock1 = latestBlock.transactions;

      console.log(JSON.parse(transactionsBlock1[22].logs).errors);
      console.log(JSON.parse(transactionsBlock1[23].logs).errors);
      console.log(JSON.parse(transactionsBlock1[24].logs).errors);
      console.log(JSON.parse(transactionsBlock1[25].logs).errors);
      console.log(JSON.parse(transactionsBlock1[26].logs).errors);
      console.log(JSON.parse(transactionsBlock1[27].logs).errors);

      assert.equal(JSON.parse(transactionsBlock1[22].logs).errors[0], 'you must use a custom_json signed with your active key');
      assert.equal(JSON.parse(transactionsBlock1[23].logs).errors[0], 'invalid params');
      assert.equal(JSON.parse(transactionsBlock1[24].logs).errors[0], 'amount to convert must be >= 1');
      assert.equal(JSON.parse(transactionsBlock1[25].logs).errors[0], 'amount to convert must be >= 1');
      assert.equal(JSON.parse(transactionsBlock1[26].logs).errors[0], 'symbol precision mismatch');
      assert.equal(JSON.parse(transactionsBlock1[27].logs).errors[0], 'not enough balance');

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });
});
