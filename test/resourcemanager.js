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

const tknContractPayload = setupContractPayload('tokens', './contracts/tokens_minify.js');
const nftContractPayload = setupContractPayload('nft', './contracts/nft_minify.js');
const mktContractPayload = setupContractPayload('market', './contracts/market_minify.js');
const rmContractPayload = setupContractPayload('resourcemanager', './contracts/resourcemanager_minify.js');
const mktPoolContractPayload = setupContractPayload('marketpools', './contracts/marketpools_minify.js');

const fixture = new Fixture();
const tableAsserts = new TableAsserts(fixture);
const resourceManagerForkBlock = 96287448;

// test cases for resourcemanager smart contract
describe('resourcemanager', function () {
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

  async function initializeResourceManager() {
     // Initialize new resourcemanager contract before fork
     let refBlockNumber = resourceManagerForkBlock - 1;
     let transactions = [];
     // deploy contracts
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mktContractPayload)));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(rmContractPayload)));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(rmContractPayload)));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(nftContractPayload)));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(mktPoolContractPayload)));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mktPoolContractPayload)));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mktPoolContractPayload)));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'nft', 'updateParams', '{ "nftCreationFee": "1", "nftIssuanceFee": {"TKN":"1"}, "dataPropertyCreationFee": "1", "enableDelegationFee": "1" }'));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol":"${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to":"drew", "quantity":"200", "isSignedWithActiveKey":true }`));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateParams', `{ "numberOfFreeTx": 1 }`));

     // Create BEED token if not already available
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "url": "https://token.com", "symbol": "BEED", "precision": 8, "maxSupply": "100000" }'));
     // Issue some tokens to drew
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "BEED", "to": "drew", "quantity": "1", "isSignedWithActiveKey": true }'));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "BEED", "to": "tate", "quantity": "10", "isSignedWithActiveKey": true }'));
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', `{ "symbol": "BEED", "to": "${CONSTANTS.HIVE_ENGINE_ACCOUNT}", "quantity": "10000", "isSignedWithActiveKey": true }`));
     // Create test NFT
     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'nft', 'create', '{ "isSignedWithActiveKey": true, "name":"test NFT", "symbol":"TSTNFT", "url":"http://mynft.com", "maxSupply":"3" }'));

     let block = {
       refHiveBlockNumber: refBlockNumber,
       refHiveBlockId: 'ABCD1',
       prevRefHiveBlockId: 'ABCD2',
       timestamp: '2025-05-12T16:30:00',
       transactions,
     };

     // process all transactions defined above in block
     await fixture.sendBlock(block);
     await tableAsserts.assertNoErrorInLastBlock();
  }

  it('one action per block is free', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'market', 'sell', '{ "symbol": "BEED", "quantity": "0.1", "price": "1", "isSignedWithActiveKey": true }'));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T00:00:00',
      transactions,
    };
    await fixture.sendBlock(block);

    let res = await fixture.database.getLatestBlockInfo();

    let txLogs = JSON.parse(res.transactions[0].logs);
    assert.ok(!txLogs.errors || txLogs.errors.length === 0, 'First transaction should not have errors');
    await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.90000000' });

    ++refBlockNumber;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'market', 'sell', '{ "symbol": "BEED", "quantity": "0.1", "price": "1", "isSignedWithActiveKey": true }'));

    block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T00:00:00',
      transactions,
    };
    await fixture.sendBlock(block);
    res = await fixture.database.getLatestBlockInfo();

    txLogs = JSON.parse(res.transactions[0].logs);
    assert.ok(!txLogs.errors || txLogs.errors.length === 0, 'First transaction should not have errors');
    await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.80000000' });
  });

  it('two or more actions costs', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'market', 'sell', '{ "symbol": "BEED", "quantity": "0.1", "price": "1", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'market', 'sell', '{ "symbol": "BEED", "quantity": "0.1", "price": "1", "isSignedWithActiveKey": true }'));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T00:00:00',
      transactions,
    };
    await fixture.sendBlock(block);

    const res = await fixture.database.getLatestBlockInfo();

    const logs0 = JSON.parse(res.transactions[0].logs);
    const logs1 = JSON.parse(res.transactions[1].logs);

    assert.ok(!logs0.errors || logs0.errors.length === 0, 'First transaction should be free and succeed');
    assert.ok(!logs1.errors || logs1.errors.length === 0 || logs1.events.length > 1, 'Second transaction should succeed but incur burn');

    assert.ok(logs1.events && logs1.events.length > 1 && logs1.events[1].contract === 'resourcemanager'
      && logs1.events[1].event === 'burnFee' && logs1.events[1].data.to === 'null' && logs1.events[1].data.fee === '0.001', 'Burn not protocolled');

    await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.79900000' });
  });


  it('checks declared fee if parameter set', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateParams', '{ "checkDeclaredFee": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'market', 'sell', '{ "symbol": "BEED", "quantity": "0.1", "price": "1", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'market', 'sell', '{ "symbol": "BEED", "quantity": "0.1", "price": "1", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'market', 'sell', '{ "symbol": "BEED", "quantity": "0.1", "price": "1", "isSignedWithActiveKey": true, "he__burnFee": "0.001" }'));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T00:00:00',
      transactions,
    };
    await fixture.sendBlock(block);

    const res = await fixture.database.getLatestBlockInfo();

    const logs1 = JSON.parse(res.transactions[1].logs);
    const logs3 = JSON.parse(res.transactions[3].logs);

    assert.ok(!logs1.errors || logs1.errors.length === 0, 'First transaction should be free and succeed');
    assertError(res.transactions[2], 'Must declare matching multiTransaction fee in he__burnFee field');
    assert.ok(!logs3.errors || logs3.errors.length === 0 || logs3.events.length > 1, 'Second transaction should succeed but incur burn');

    assert.ok(logs3.events && logs3.events.length > 1 && logs3.events[1].contract === 'resourcemanager'
      && logs3.events[1].event === 'burnFee' && logs3.events[1].data.to === 'null' && logs3.events[1].data.fee === '0.001', 'Burn not protocolled');

    await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.79900000' });
  });

  it('multiple token transfers pay no fees', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "to": "drewlongshot", "quantity": "0.5", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "to": "drewlongshot", "quantity": "0.5", "isSignedWithActiveKey": true }'));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T00:00:00',
      transactions,
    };
    await fixture.sendBlock(block);

    const res = await fixture.database.getLatestBlockInfo();

    const logs0 = JSON.parse(res.transactions[0].logs);
    const logs1 = JSON.parse(res.transactions[1].logs);

    assert.ok(!logs0.errors || logs0.errors.length === 0, 'First transaction should be free and succeed');
    assert.ok(!logs1.errors || logs1.errors.length === 0, 'Second transaction should be free and succeed');

    await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.00000000' });
    await tableAsserts.assertUserBalances({ account: 'drewlongshot', symbol: 'BEED', balance: '1.00000000' });
  });

  it('more actions more costs, no 20 limit on market operations', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    for (let i = 0; i < 50; i++) {
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'market', 'sell', '{ "symbol": "BEED", "quantity": "0.001", "price": "1", "isSignedWithActiveKey": true }'));
    }

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T00:00:00',
      transactions,
    };
    await fixture.sendBlock(block);

    const res = await fixture.database.getLatestBlockInfo();

    for (let i = 0; i < 50; i++) {
      const logs = JSON.parse(res.transactions[i].logs);
      if (i == 0) {
        assert.ok(!logs.errors || logs.errors.length === 0, 'First transaction should be free and succeed');
      } else {
        assert.ok(!logs.errors || logs.errors.length === 0 || logs.events.length > 1, 'Other transactions should succeed but incur burn');
      }
    }

    await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.90100000' });
  });

  it('20 limit on transfers', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    for (let i = 0; i < 50; i++) {
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'tokens', 'transfer', '{ "symbol": "BEED", "to": "drewlongshot", "quantity": "0.001", "isSignedWithActiveKey": true }'));
    }

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T00:00:00',
      transactions,
    };
    await fixture.sendBlock(block);

    const res = await fixture.database.getLatestBlockInfo();

    for (let i = 0; i < 50; i++) {
      const logs = JSON.parse(res.transactions[i].logs);
      if (i < 20) {
        assert.ok(!logs.errors || logs.errors.length === 0, 'First 20 transactions should be free and succeed');
      } else {
        assert.equal(logs.errors[0], 'max transaction limit per block reached.');
      }
    }

    await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.98000000' });
  });

  it('no 20 limit on marketpool actions', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "BEE:BEED", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'addLiquidity', '{ "tokenPair": "BEE:BEED", "baseQuantity": "1000", "quoteQuantity": "10000", "isSignedWithActiveKey": true }'));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T00:00:00',
      transactions,
    };
    await fixture.sendBlock(block);
    await tableAsserts.assertNoErrorInLastBlock();

    refBlockNumber++;
    transactions = [];

    for (let i = 0; i < 50; i++) {
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'marketpools', 'swapTokens', '{ "tokenPair": "BEE:BEED", "tokenSymbol": "BEED", "tokenAmount": "0.01", "tradeType": "exactInput", "maxSlippage": "1", "isSignedWithActiveKey": true}'));
    }

    block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T01:00:00',
      transactions,
    };
    await fixture.sendBlock(block);

    const res = await fixture.database.getLatestBlockInfo();
    // All actions should succeed, and with no fee
    await tableAsserts.assertNoErrorInLastBlock();
    await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.50000000' });
  });

  it('add to denyList and get blocked', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateAccount', '{"account": "drew", "isDenied": true}' ));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'nft', 'addProperty', '{ "symbol": "TSTNFT", "name": "a", "type": "number", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'nft', 'addProperty', '{ "symbol": "TSTNFT", "name": "b", "type": "number", "isSignedWithActiveKey": true }'));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-12T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    const res = await fixture.database.getLatestBlockInfo();

    // first tx (addAccount) has no errors
    const log0 = JSON.parse(res.transactions[0].logs);
    assert.ok(!log0.errors || log0.errors.length === 0);
    assert.ok(log0.events && log0.events.length === 1 && log0.events[0].contract === 'resourcemanager'
      && log0.events[0].event === 'updateAccount' && log0.events[0].data.isDenied === true
      && log0.events[0].data.updatedAccount === 'drew' && log0.events[0].data.from === CONSTANTS.HIVE_ENGINE_ACCOUNT, 'Failed to deny account');

    const logs1 = JSON.parse(res.transactions[1].logs);
    assert.ok(!logs1.errors || logs1.errors.length === 0, 'First action from drew should succeed');

    const logs2 = JSON.parse(res.transactions[2].logs);
    assert.equal(logs2.errors[0], 'max transaction limit per day reached.');
  });

  it('check reset counter after 24h of denied user', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateAccount', '{"account": "drew", "isDenied": true}' ));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'nft', 'addProperty', '{ "symbol": "TSTNFT", "name": "a", "type": "number", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'nft', 'addProperty', '{ "symbol": "TSTNFT", "name": "b", "type": "number", "isSignedWithActiveKey": true }'));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-12T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    let res = await fixture.database.getLatestBlockInfo();
    const log0 = JSON.parse(res.transactions[0].logs);
    assert.ok(!log0.errors || log0.errors.length === 0);

    let logs1 = JSON.parse(res.transactions[1].logs);
    assert.ok(!logs1.errors || logs1.errors.length === 0, 'First action from drew should succeed');

    let logs2 = JSON.parse(res.transactions[2].logs);
    assert.equal(logs2.errors[0], 'max transaction limit per day reached.');

    refBlockNumber++;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'nft', 'addProperty', '{ "symbol": "TSTNFT", "name": "b", "type": "number", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'nft', 'addProperty', '{ "symbol": "TSTNFT", "name": "c", "type": "number", "isSignedWithActiveKey": true }'));

    block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-13T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    res = await fixture.database.getLatestBlockInfo();

    logs1 = JSON.parse(res.transactions[0].logs);
    assert.ok(!logs1.errors || logs1.errors.length === 0, 'First action from drew should succeed');

    logs2 = JSON.parse(res.transactions[1].logs);
    assert.equal(logs2.errors[0], 'max transaction limit per day reached.');
  });

  it('update account', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateAccount', '{"account": "drew", "isDenied": true}' ));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-12T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    let res = await fixture.database.getLatestBlockInfo();
    let log0 = JSON.parse(res.transactions[0].logs);
    assert.ok(!log0.errors || log0.errors.length === 0);

    res = await fixture.database.findOne({
      contract: 'resourcemanager',
      table: 'accountControls',
      query: {
        account: 'drew'
      }
    });
    assert.ok(res && res.isDenied == true);

    refBlockNumber++;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateAccount', '{"account": "drew", "isDenied": false}' ));

    block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-13T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    res = await fixture.database.getLatestBlockInfo();

    log0 = JSON.parse(res.transactions[0].logs);
    assert.ok(!log0.errors || log0.errors.length === 0);

    res = await fixture.database.findOne({
      contract: 'resourcemanager',
      table: 'accountControls',
      query: {
        account: 'drew'
      }
    });
    assert.ok(res && res.isDenied == false);
  });

  it('add & remove moderator', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateModerator', '{"account": "satoshi", "action": "add"}' ));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-12T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    let res = await fixture.database.getLatestBlockInfo();
    let log0 = JSON.parse(res.transactions[0].logs);
    assert.ok(!log0.errors || log0.errors.length === 0);

    res = await fixture.database.findOne({
      contract: 'resourcemanager',
      table: 'moderators',
      query: {
        account: 'satoshi'
      }
    });

    assert.ok(res && res.account === 'satoshi');

    refBlockNumber++;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateModerator', '{"account": "satoshi", "action": "remove"}' ));

    block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-13T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    res = await fixture.database.getLatestBlockInfo();

    log0 = JSON.parse(res.transactions[0].logs);
    assert.ok(!log0.errors || log0.errors.length === 0);

    res = await fixture.database.findOne({
      contract: 'resourcemanager',
      table: 'accountControls',
      query: {
        account: 'drew'
      }
    });
    assert.ok(!res);
  });

  it('moderator adds acc to denylist', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateModerator', '{"account": "satoshi", "action": "add"}' ));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'satoshi', 'resourcemanager', 'updateAccount', '{"account": "drew", "isDenied": true}' ));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-12T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    let res = await fixture.database.getLatestBlockInfo();
    let log0 = JSON.parse(res.transactions[0].logs);
    assert.ok(!log0.errors || log0.errors.length === 0);
    assert.ok(log0.events && log0.events.length === 1 && log0.events[0].contract === 'resourcemanager'
      && log0.events[0].event === 'updateModerator' && log0.events[0].data.account === 'satoshi'
      && log0.events[0].data.action === 'add' && log0.events[0].data.from === CONSTANTS.HIVE_ENGINE_ACCOUNT, 'Adding moderator no emit or wrong');

    let log1 = JSON.parse(res.transactions[1].logs);
    assert.ok(!log1.errors || log1.errors.length === 0);
    assert.ok(log1.events && log1.events.length === 1 && log1.events[0].contract === 'resourcemanager'
      && log1.events[0].event === 'updateAccount' && log1.events[0].data.isDenied === true
      && log1.events[0].data.updatedAccount === 'drew' && log1.events[0].data.from === 'satoshi', 'Faile to deny account as moderator');

    res = await fixture.database.findOne({
      contract: 'resourcemanager',
      table: 'accountControls',
      query: {
        account: 'drew'
      }
    });

    assert.ok(res && res.account === 'drew' && res.isDenied);
  });

  it('updates parameters to 2 free tx, 0.01 BEE fee', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    let transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateParams', `{ "numberOfFreeTx": 2, "multiTransactionFee": "0.01", "burnSymbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}" }`));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T00:00:00',
      transactions,
    };
    await fixture.sendBlock(block);
    await tableAsserts.assertNoErrorInLastBlock();

    refBlockNumber++;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'market', 'sell', '{ "symbol": "BEED", "quantity": "0.1", "price": "1", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'market', 'sell', '{ "symbol": "BEED", "quantity": "0.1", "price": "1", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'market', 'sell', '{ "symbol": "BEED", "quantity": "0.1", "price": "1", "isSignedWithActiveKey": true }'));

    block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T00:00:00',
      transactions,
    };
    await fixture.sendBlock(block);

    const res = await fixture.database.getLatestBlockInfo();

    const logs0 = JSON.parse(res.transactions[0].logs);
    const logs1 = JSON.parse(res.transactions[1].logs);
    const logs2 = JSON.parse(res.transactions[2].logs);

    assert.ok(!logs0.errors || logs0.errors.length === 0, 'First transaction should be free and succeed');
    assert.ok(!logs1.errors || logs1.errors.length === 0, 'Second transaction should be free and succeed');
    assert.ok(!logs2.errors || logs2.errors.length === 0 || logs2.events.length > 1, 'Third transaction should succeed but incur burn');

    assert.ok(logs2.events && logs2.events.length > 1 && logs2.events[1].contract === 'resourcemanager'
      && logs2.events[1].event === 'burnFee' && logs2.events[1].data.to === 'null' && logs2.events[1].data.fee === '0.01' && logs2.events[1].data.symbol === 'BEE', 'Burn not protocolled');

    await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEED', balance: '0.70000000' });
    await tableAsserts.assertUserBalances({ account: 'drew', symbol: 'BEE', balance: '198.99000000' });
  });

  it('updates parameters to 2 denyMaxTx', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    let transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateParams', '{"denyMaxTx": 2}'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'resourcemanager', 'updateAccount', '{"account": "drew", "isDenied": true}' ));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2018-06-01T00:00:00',
      transactions,
    };
    await fixture.sendBlock(block);
    await tableAsserts.assertNoErrorInLastBlock();

    refBlockNumber++;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'nft', 'addProperty', '{ "symbol": "TSTNFT", "name": "a", "type": "number", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'nft', 'addProperty', '{ "symbol": "TSTNFT", "name": "b", "type": "number", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drew', 'nft', 'addProperty', '{ "symbol": "TSTNFT", "name": "c", "type": "number", "isSignedWithActiveKey": true }'));

    block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-12T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    let res = await fixture.database.getLatestBlockInfo();
    let logs1 = JSON.parse(res.transactions[0].logs);
    assert.ok(!logs1.errors || logs1.errors.length === 0, 'First action from drew should succeed');

    let logs2 = JSON.parse(res.transactions[1].logs);
    assert.ok(!logs2.errors || logs2.errors.length === 0, 'Second action from drew should succeed');

    let logs3 = JSON.parse(res.transactions[2].logs);
    assert.equal(logs3.errors[0], 'max transaction limit per day reached.');
  });

  it('allowlist subscription for 30 days', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'tate', 'resourcemanager', 'subscribe', '{ "isSignedWithActiveKey": true }'));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-12T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    const res = await fixture.database.getLatestBlockInfo();

    const log0 = JSON.parse(res.transactions[0].logs);
    assert.ok(!log0.errors || log0.errors.length === 0);
    assert.ok(log0.events && log0.events.length === 2 && log0.events[0].contract === 'tokens'
        && log0.events[0].event === 'transfer' && log0.events[0].data.from === 'tate' && log0.events[0].data.quantity === '10'
        && log0.events[0].data.symbol === 'BEED' && log0.events[0].data.to === 'null');
    assert.ok(log0.events && log0.events.length === 2 && log0.events[1].contract === 'resourcemanager'
      && log0.events[1].event === 'subscribe' && log0.events[1].data.fee === '10'
      && log0.events[1].data.from === 'tate' && log0.events[1].data.symbol === 'BEED' && log0.events[1].data.to === 'null', 'Failed to subscribe');

    const logs1 = JSON.parse(res.transactions[0].logs);
    assert.ok(!logs1.errors || logs1.errors.length === 0, 'Transfer / burn should succeed');

    // verify balance and db
    await tableAsserts.assertUserBalances({ account: 'tate', symbol: 'BEED', balance: '0.00000000' });
    await tableAsserts.assertUserBalances({ account: 'null', symbol: 'BEED', balance: '10' });
    let dbRes = await fixture.database.findOne({
      contract: 'resourcemanager',
      table: 'accountControls',
      query: {
        account: 'tate'
      }
    });

    let validUntil = new Date(`${res.timestamp}.000Z`);
    validUntil.setDate(validUntil.getDate() + 30);
    const validUntilMs = validUntil.getTime();
    assert.ok(dbRes.allowedUntil == validUntilMs);
    assert.ok(dbRes.isAllowed === true);
  });

  it('allowlist subscription not allowed before expiration', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'tate', 'resourcemanager', 'subscribe', '{ "isSignedWithActiveKey": true }'));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-12T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'tate', 'resourcemanager', 'subscribe', '{ "isSignedWithActiveKey": true }'));

    block = {
      refHiveBlockNumber: ++refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-12T16:31:06',
      transactions,
    };

    await fixture.sendBlock(block);

    const res = await fixture.database.getLatestBlockInfo();
    
    const log0 = JSON.parse(res.transactions[0].logs);
    assert.ok(log0.errors || log0.errors.length >= 1, 'Transaction should fail');
    assert.equal(log0.errors[0], 'can only be purchased once a month.', 'Transaction should fail with correct error');
  });

  it('allowlist expiration', async () => {
    await fixture.setUp();

    await initializeResourceManager();

    let refBlockNumber = resourceManagerForkBlock;
    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'tate', 'resourcemanager', 'subscribe', '{ "isSignedWithActiveKey": true }'));

    let block = {
      refHiveBlockNumber: refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-05-12T16:30:03',
      transactions,
    };
    await fixture.sendBlock(block);

    transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'tate', 'market', 'cancel', '{ "account": "tate", "id": "TXID1235", "type": "buy", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'tate', 'market', 'cancel', '{ "account": "tate", "id": "TXID1236", "type": "buy", "isSignedWithActiveKey": true }'));

    block = {
      refHiveBlockNumber: ++refBlockNumber,
      refHiveBlockId: 'ABCD1',
      prevRefHiveBlockId: 'ABCD2',
      timestamp: '2025-06-12T16:33:06',
      transactions,
    };

    await fixture.sendBlock(block);

    const res = await fixture.database.getLatestBlockInfo();
    
    const log1 = JSON.parse(res.transactions[1].logs);
    assert.ok(log1.events && log1.events.length >= 1, 'Transaction should have events');
    assert.ok(log1.events[0].contract === 'resourcemanager' && log1.events[0].event === 'allowListSubscriptionExpired', 'AllowList subscription should have expired');
  });

});
