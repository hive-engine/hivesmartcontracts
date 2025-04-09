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
const { query } = require('winston');
const { table } = require('console');
const { access } = require('fs');
const { Query } = require('mongodb/lib/core');


const tknContractPayload = setupContractPayload('tokens', './contracts/tokens.js');
const bdContractPayload = setupContractPayload('burndollar', './contracts/burndollar.js');
const beeContractPayload = setupContractPayload('beedollar', './contracts/beedollar.js');
const mpContractPayload = setupContractPayload('marketpools', './contracts/marketpools.js');

const fixture = new Fixture();
const tableAsserts = new TableAsserts(fixture);

// test cases for burndollar smart contract
describe('burndollar', function () {
  this.timeout(7000);

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

  // it('updates parameters on the burndollar contract', (done) => {
  //   new Promise(async (resolve) => {

  //     await fixture.setUp();

  //     let refBlockNumber = fixture.getNextRefBlockNumber();
  //     let transactions = [];
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'burndollar', 'updateParams', '{ "issueDTokenFee": "1200", "updateParamsFee": "200", "burnUsageFee": "2"}'));

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
  //       contract: 'burndollar',
  //       table: 'params',
  //       query: {}
  //     });

  //     console.log(" ")
  //     console.log( '\u001b[' + 93 + 'm' + 'Test: updates parameters on the fee charges in the burndollar contract' + '\u001b[0m')

  //     console.log(params)
  //     assert.equal(params.issueDTokenFee, '1200');
  //     assert.equal(params.updateParamsFee, '200');
  //     assert.equal(params.burnUsageFee, '2');

  //     resolve();
  //   })
  //     .then(() => {
  //       fixture.tearDown();
  //       done();
  //     });
  // });

  // it('generates errors when trying to create D tokens with wrong parameters', (done) => {
  //   new Promise(async (resolve) => {

  //     await fixture.setUp();

  //     let refBlockNumber =  74391382; 
  //     let transactions = [];
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(beeContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(beeContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 1
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 2
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "HBD Pegged", "symbol": "SWAP.HBD", "precision": 8, "maxSupply": "1000000000000" }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "drewlongshot", "quantity": "1000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_PEGGED_ACCOUNT, 'tokens', 'transfer', '{ "symbol": "SWAP.HIVE", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "10000", "price": "10", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', '{ "symbol": "SWAP.HBD", "quantity": "10000", "price": "0.5", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "100", "price": "10", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', '{ "symbol": "SWAP.HBD", "quantity": "100", "price": "0.5","isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:BEE", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:BEE", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }')); 
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:BEE", "tokenSymbol": "SWAP.HIVE", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "tokenSymbol": "SWAP.HBD", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
  //     // now, do a convert from bee to beed
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'beedollar', 'convert', '{ "quantity": "200.0", "isSignedWithActiveKey": true }'));
  //     //user must be the owner a pre-existing token that they wish to make into corresponding D token
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "URQTEST", "precision": 3, "maxSupply": "10000", "isSignedWithActiveKey": true  }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'issue', '{ "symbol": "URQTEST", "quantity": "200", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
  //     //trans #26 does user have enough BEED enough tes ... trans28 signed active key test
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "feePercentage": ".5", "minConvertibleAmount": "1", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'beedollar', 'convert', '{ "quantity": "5000.0", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "feePercentage": ".5","minConvertibleAmount": "1", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": false }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": 156, "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "RUTTMUTTT", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //     //trans31 + 32 precision must be number between 0 and 8 
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "maxSupply": "20000", "burnRouting" : "whale", "precision": "ty", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "maxSupply": "20000", "precision": 9, "burnRouting" : "whale", "isSignedWithActiveKey": true }'));
  //     //trans33+ 34 maxSupply must be a valid param
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "minConvertibleAmount": "1", "feePercentage": "1", "burnRouting" : "whale", "maxSupply": 20000, "precision": 2, "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "minConvertibleAmount": "1", "feePercentage": "1", "burnRouting" : "whale", "maxSupply": "tim", "precision": 2, "isSignedWithActiveKey": true }'));
  //     //trans35 URL must be string
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'createTokenD', '{ "symbol": "URQTEST", "feePercentage": ".5", "burnRouting": "whale", "minConvertibleAmount": "1", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //     //trans 36 user must be issuer on the Parent token
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "BEE", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //     // trans37 the parent token is set to burn to null by default, but a user can send it to any other account
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "burnRouting": 123, "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //     // trans38 the min convertable amount has to be a string(value) of at least 1
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "minConvertibleAmount": "0", "burnRouting": "drewlongshot", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //     // trans39 fee conversion rate must be between 0 and 100% as a decimal
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "feePercentage": "1.1","minConvertibleAmount": "1", "burnRouting": "drewlongshot",  "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //     // trans40 the account for routing the fee portion of a converion must exist
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "feePercentage": ".5","minConvertibleAmount": "1", "burnRouting": "drewlongshotthesmall", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //     //trans41 tokenD name valid name params
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "name": "Lorem ipsum dolor sit amet consectetur adipiscing elit. Quisque faucibus ex sapien vitae pellentesque sem placerat. In id cursus mi pretium tellus duis convallis. Tempus leo eu aenean sed diam urna tempor. Pulvinar vivamus fringilla lacus nec metus bibendum egestas. Iaculis massa nisl malesuada lacinia integer nunc posuere. Ut hendrerit semper vel class aptent taciti sociosqu. Ad litora torquent per conubia nostra inceptos himenaeos.", "feePercentage": ".5","minConvertibleAmount": "1", "url":"myurl", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //     //trans 42-44 the name XXX-D token already exists
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "URQTEST.D", "precision": 3, "maxSupply": "10000", "isSignedWithActiveKey": true  }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "URQTEST.D", "quantity": "200", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot','burndollar', 'createTokenD', '{ "symbol": "URQTEST", "feePercentage": ".5","minConvertibleAmount": "1", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
          
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
      

  //     console.log(" ")
  //     console.log( '\u001b[' + 93 + 'm' + 'Test: generates errors when trying to issue D tokens with wrong parameters' + '\u001b[0m')
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[26].logs).errors[0])
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[28].logs).errors[0])
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[29].logs).errors[0],"... the symbol must be string")
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[30].logs).errors[0],"... the symbol must be less than 8 Chars")
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[31].logs).errors[0],"... precision must be number")
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[32].logs).errors[0],"... precision must be number less than 8")
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[33].logs).errors[0],"...  maxsupply must be string(of number)")
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[34].logs).errors[0],"... maxsupply must be string(of number)")

  //     console.log("  ⚪",JSON.parse(transactionsBlock1[36].logs).errors[0],"... token issuer ")
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[37].logs).errors[0],"... user not token parent issuer ")
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[38].logs).errors[0],"... burn routing must be a string and is set to null by default ")
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[39].logs).errors[0],"... min convertable amount must equal 1 ")
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[40].logs).errors[0],"... fee percent must be btwn 0 and 1 ")
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[41].logs).errors[0],"... does account exist?")
  //     console.log("  ⚪",JSON.parse(transactionsBlock1[44].logs).errors[0],"... XXX-D already exists")

  //     assert.equal(JSON.parse(transactionsBlock1[26].logs).errors[0], 'you must have enough BEED tokens to cover the creation fees');
  //     assert.equal(JSON.parse(transactionsBlock1[28].logs).errors[0], 'you must use a custom_json signed with your active key');
  //     assert.equal(JSON.parse(transactionsBlock1[29].logs).errors[0], 'symbol must be string of length 8 or less to create a xxx-D token');
  //     assert.equal(JSON.parse(transactionsBlock1[30].logs).errors[0], 'symbol must be string of length 8 or less to create a xxx-D token');
  //     assert.equal(JSON.parse(transactionsBlock1[31].logs).errors[0], 'min convert amount must be string(number) greater than 1');
  //     assert.equal(JSON.parse(transactionsBlock1[32].logs).errors[0], 'min convert amount must be string(number) greater than 1');
  //     assert.equal(JSON.parse(transactionsBlock1[33].logs).errors[0], 'max supply must be a minimum of 2000 units');
  //     assert.equal(JSON.parse(transactionsBlock1[34].logs).errors[0], 'max supply must be a minimum of 2000 units');

  //     assert.equal(JSON.parse(transactionsBlock1[36].logs).errors[0], `You must be the token issuer in order to issue D token`);
  //     assert.equal(JSON.parse(transactionsBlock1[37].logs).errors[0], `burn routing must be string`);
  //     assert.equal(JSON.parse(transactionsBlock1[38].logs).errors[0], `min convert amount must be string(number) greater than 1`);
  //     assert.equal(JSON.parse(transactionsBlock1[39].logs).errors[0], `fee percentage must be between 0 and 1 / 0% and 100%`);
  //     assert.equal(JSON.parse(transactionsBlock1[40].logs).errors[0], `account for burn routing must exist`);
  //     assert.equal(JSON.parse(transactionsBlock1[41].logs).errors[0], `invalid name: letters, numbers, whitespaces only, max length of 50`);
  //     assert.equal(JSON.parse(transactionsBlock1[44].logs).errors[0], `D token must not already exist`);

  //     resolve();
  //   })
  //     .then(() => {
  //       fixture.tearDown();
  //       done();
  //     });
  // });


  // it('creates a D token', (done) => {
  //   new Promise(async (resolve) => {
      
  //     await fixture.setUp();
  //   let refBlockNumber =  74391382; 
  //     let transactions = [];
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(beeContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(beeContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 1
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 2
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "HBD Pegged", "url": "https://hive-engine.com", "symbol": "SWAP.HBD", "precision": 8, "maxSupply": "1000000000000" }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "drewlongshot", "quantity": "1000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_PEGGED_ACCOUNT, 'tokens', 'transfer', '{ "symbol": "SWAP.HIVE", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "10000", "price": "10", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', '{ "symbol": "SWAP.HBD", "quantity": "10000", "price": "0.5", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "100", "price": "10", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', '{ "symbol": "SWAP.HBD", "quantity": "100", "price": "0.5","isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:BEE", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:BEE", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }')); 
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:BEE", "tokenSymbol": "SWAP.HIVE", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "tokenSymbol": "SWAP.HBD", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
  //     // now, do a convert from bee to beed
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'beedollar', 'convert', '{ "quantity": "2000.0", "isSignedWithActiveKey": true }'));
  //      //trans24-25 user is token_issuer on a parent token has to pay 1000 Beed to issue D token, ,and not pay a Bee fee of 100 for issue of parent token creatation of parent token brings bee burned total to 2100 
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "URQTWO", "precision": 3, "maxSupply": "20000", "isSignedWithActiveKey": true  }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'issue', '{ "symbol": "URQTWO", "name": "token", "quantity": "200", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
  //     // trans 26 BEE should still be 2100 burned and BEED should be at 1000
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'createTokenD', '{"symbol": "URQTWO", "name": "token", "feePercentage": ".5", "minConvertibleAmount": "1", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
      
  //     let block = {
  //       refHiveBlockNumber: refBlockNumber,
  //       refHiveBlockId: 'ABCD1',
  //       prevRefHiveBlockId: 'ABCD2',
  //       timestamp: '2018-06-01T00:00:00',
  //       transactions,
  //     };
  //     await fixture.sendBlock(block);

  //      const res = await fixture.database.getBlockInfo(1);

  //    const block1 = res;
  //    const transactionsBlock1 = block1.transactions;

  //    let res2 = await fixture.database.find({
  //       contract: 'tokens',
  //       table: 'balances',
  //       query: {account:'null', symbol:'BEE'}
  //     });

  //     let token = res2

  //    console.log(" ")
  //    console.log( '\u001b[' + 93 + 'm' + 'Test: creates a D tokencreates a D token' + '\u001b[0m')

  //    console.log (token)
    //  assert.equal(token.symbol, 'BEE');
    //  assert.equal(token.balance, '2100.00000000');

    //  res2 = await fixture.database.findOne({
    //   contract: 'tokens',
    //   table: 'balances',
    //   query: {account:'null', symbol: 'BEED'}
    // });

    //  token = res2
    //  console.log(token)
     

    // console.log("  ⚪",JSON.parse(transactionsBlock1[26].logs))
    //  assert.equal(token.symbol, 'BEED');
    //  assert.equal(token.balance, '1000.0000');

    //  res2 = await fixture.database.findOne({
    //   contract: 'tokens',
    //   table: 'tokens',
    //   query: {symbol: 'URQTWO'}
    // });
    
    // token = res2

    // console.log(token)
    // assert.equal(token.symbol, 'URQTWO');
    // assert.equal(token.issuer, 'drewlongshot');
    // assert.equal(token.name, 'token');
    // // !! why do I need to pass a string but mancer can pass a number?
    // assert.equal(token.maxSupply,  '20000.000');
    // assert.equal(token.supply,  '200.000');


    // res2 = await fixture.database.findOne({
    //   contract: 'tokens',
    //   table: 'tokens',
    //   query: {symbol: 'URQTWO.D'}
    // });
    
    // token = res2

    // console.log(token)
    // assert.equal(token.symbol, 'URQTWO.D');
    // assert.equal(token.issuer, 'null');
    // assert.equal(token.name, 'token');
    // assert.equal(token.precision, 2);
    // // !! why do I need to pass a string but mancer can pass a number?
    // assert.equal(token.maxSupply,  '20000.00');
    // assert.equal(token.supply, '0');

    // res2 = await fixture.database.findOne({
    //   contract: 'burndollar',
    //   table: 'burnpair',
    //   query: {}
    // });
    
    // token = res2

    // console.log(token)
    // assert.equal(token.symbol, 'URQTWO.D');
    // assert.equal(token.issuer, 'drewlongshot')
    // assert.equal(token.name, 'token');
    // assert.equal(token.parentSymbol,'URQTWO')
    // assert.equal(token.burnRouting, 'null')
    // assert.equal(token.minConvertibleAmount,'1')
    // assert.equal(token.feePercentage,'.5')



  //     resolve();
    
  // })
  //     .then(() => {
  //       fixture.tearDown();
  //       done();
  //     });
  // });

  // it('updates the params for the D token and charges 100 BEED', (done) => {
  //   new Promise(async (resolve) => {
      
  //     await fixture.setUp();
  //   let refBlockNumber =  74391382; 
  //     let transactions = [];
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(beeContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(beeContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 1
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 2
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "HBD Pegged", "url": "https://hive-engine.com", "symbol": "SWAP.HBD", "precision": 8, "maxSupply": "1000000000000" }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "drewlongshot", "quantity": "1000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_PEGGED_ACCOUNT, 'tokens', 'transfer', '{ "symbol": "SWAP.HIVE", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "10000", "price": "10", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', '{ "symbol": "SWAP.HBD", "quantity": "10000", "price": "0.5", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "100", "price": "10", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', '{ "symbol": "SWAP.HBD", "quantity": "100", "price": "0.5","isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:BEE", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:BEE", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }')); 
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:BEE", "tokenSymbol": "SWAP.HIVE", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "tokenSymbol": "SWAP.HBD", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
  //     // now, do a convert from bee to beed
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'beedollar', 'convert', '{ "quantity": "2000.0", "isSignedWithActiveKey": true }'));
  //      //trans24-25 user is token_issuer on a parent token has to pay 1000 Beed to issue D token, ,and not pay a Bee fee of 100 for issue of parent token creatation of parent token brings bee burned total to 2100 
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "URQTWO", "precision": 3, "maxSupply": "20000", "isSignedWithActiveKey": true  }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'issue', '{ "symbol": "URQTWO", "name": "token", "quantity": "200", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
  //     // BEE should still be 2100 burned and BEED should be at 1000
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'createTokenD', '{"symbol": "URQTWO", "name": "token", "feePercentage": ".5", "minConvertibleAmount": "1", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //    //trans27 update params
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'updateBurnPair', '{"symbol": "URQTWO.D","name": "my new name token", "feePercentage": ".7", "burnRouting": "whale", "isSignedWithActiveKey": true }'));



  //     let block = {
  //       refHiveBlockNumber: refBlockNumber,
  //       refHiveBlockId: 'ABCD1',
  //       prevRefHiveBlockId: 'ABCD2',
  //       timestamp: '2018-06-01T00:00:00',
  //       transactions,
  //     };
  //     await fixture.sendBlock(block);

  //      const res = await fixture.database.getBlockInfo(1);

  //    const block1 = res;
  //    const transactionsBlock1 = block1.transactions;

  //  res2 = await fixture.database.findOne({
  //     contract: 'burndollar',
  //     table: 'burnpair',
  //     query: {}
  //   });
    
  //   token = res2
  //   console.log(" ")
  //   console.log( '\u001b[' + 93 + 'm' + 'Test: updates the params for the D token and charges 100 BEED' + '\u001b[0m')
  //   console.log(token)
  //   assert.equal(token.name, 'my new name token')
  //   assert.equal(token.burnRouting, 'whale')
  //   assert.equal(token.feePercentage, '.7')


  //   res2 = await fixture.database.findOne({
  //     contract: 'tokens',
  //     table: 'balances',
  //     query: {account: 'drewlongshot', symbol: 'BEED'}
  //   });
    
  //   token = res2
  //   console.log(token)
  //   assert.equal(token.balance, '880.0000')


  //     resolve();
    
  // })
  //     .then(() => {
  //       fixture.tearDown();
  //       done();
  //     });
  // });


  // it('Fails tp update the params for the D token', (done) => {
  //   new Promise(async (resolve) => {
      
  //     await fixture.setUp();
  //   let refBlockNumber =  74391382; 
  //     let transactions = [];
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(beeContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(beeContractPayload)));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 1
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 2
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "HBD Pegged", "url": "https://hive-engine.com", "symbol": "SWAP.HBD", "precision": 8, "maxSupply": "1000000000000" }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "drewlongshot", "quantity": "1000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_PEGGED_ACCOUNT, 'tokens', 'transfer', '{ "symbol": "SWAP.HIVE", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "10000", "price": "10", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', '{ "symbol": "SWAP.HBD", "quantity": "10000", "price": "0.5", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "100", "price": "10", "isSignedWithActiveKey": true }`));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', '{ "symbol": "SWAP.HBD", "quantity": "100", "price": "0.5","isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:BEE", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:BEE", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }')); 
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:BEE", "tokenSymbol": "SWAP.HIVE", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "tokenSymbol": "SWAP.HBD", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
  //     // now, do a convert from bee to beed
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'beedollar', 'convert', '{ "quantity": "2000.0", "isSignedWithActiveKey": true }'));
  //      //trans24-25 user is token_issuer on a parent token has to pay 1000 Beed to issue D token, ,and not pay a Bee fee of 100 for issue of parent token creatation of parent token brings bee burned total to 2100 
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "URQTWO", "precision": 3, "maxSupply": "20000", "isSignedWithActiveKey": true  }'));
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'issue', '{ "symbol": "URQTWO", "name": "token", "quantity": "200", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
  //     // BEE should still be 2100 burned and BEED should be at 1000
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'createTokenD', '{"symbol": "URQTWO", "name": "token", "feePercentage": ".5", "minConvertibleAmount": "1", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
  //    //trans27 not signed
  //     transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'updateBurnPair', '{"symbol": "URQTWO.D","name": "my new name token", "feePercentage": ".7", "burnRouting": "whale", "isSignedWithActiveKey": false }'));
  //     //trans28 burn routing wrong
  //      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'updateBurnPair', '{"symbol": "URQTWO.D","name": "my new name token", "feePercentage": ".7", "burnRouting": "whaldsdfe", "isSignedWithActiveKey": true }'));
  //       //trans29+30 burn valid symbol
  //       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'updateBurnPair', '{"symbol": 123,"name": "my new name token", "feePercentage": ".7", "burnRouting": "whale", "isSignedWithActiveKey": true }'));
  //       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'updateBurnPair', '{"symbol": "123","name": "my new name token", "feePercentage": ".7", "burnRouting": "whale", "isSignedWithActiveKey": true }'));
  //       //trans31+32 valid perscision
  //       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'updateBurnPair', '{"symbol": "URQTWO.D","name": "my new name token", "feePercentage": 7, "burnRouting": "whale", "isSignedWithActiveKey": true }'));
  //       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'updateBurnPair', '{"symbol": "URQTWO.D","name": "my new name token", "feePercentage": "-1.1", "burnRouting": "whale", "isSignedWithActiveKey": true }'));
  //      //trans33 valid name
  //      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'updateBurnPair', '{"symbol": "URQTWO.D","name": 123, "feePercentage": "-1", "burnRouting": "whale", "isSignedWithActiveKey": true }'));
  //      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'updateBurnPair', '{"symbol": "URQTWO.D","name": "123 fffffffffffffffff fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "feePercentage": ".1", "burnRouting": "whale", "isSignedWithActiveKey": true }'));

  //     let block = {
  //       refHiveBlockNumber: refBlockNumber,
  //       refHiveBlockId: 'ABCD1',
  //       prevRefHiveBlockId: 'ABCD2',
  //       timestamp: '2018-06-01T00:00:00',
  //       transactions,
  //     };
  //     await fixture.sendBlock(block);

  //      const res = await fixture.database.getBlockInfo(1);

  //    const block1 = res;
  //    const transactionsBlock1 = block1.transactions;


   //    console.log(" ")
  //    console.log( '\u001b[' + 93 + 'm' + 'Test: Fails tp update the params for the D token' + '\u001b[0m')
  //    console.log("  ⚪ ",JSON.parse(transactionsBlock1[27].logs).errors[0])
  //    console.log("  ⚪ ",JSON.parse(transactionsBlock1[28].logs).errors[0])
  //    console.log("  ⚪ ",JSON.parse(transactionsBlock1[29].logs).errors[0])
  //    console.log("  ⚪ ",JSON.parse(transactionsBlock1[30].logs).errors[0])
  //    console.log("  ⚪ ",JSON.parse(transactionsBlock1[31].logs).errors[0])
  //    console.log("  ⚪ ",JSON.parse(transactionsBlock1[32].logs).errors[0])
  //    console.log("  ⚪ ",JSON.parse(transactionsBlock1[33].logs).errors[0])
  //    console.log("  ⚪ ",JSON.parse(transactionsBlock1[34].logs).errors[0])


  //    assert.equal(JSON.parse(transactionsBlock1[27].logs).errors[0], 'you must use a custom_json signed with your active key');
  //    assert.equal(JSON.parse(transactionsBlock1[28].logs).errors[0], 'account for burn routing must exist');
  //    assert.equal(JSON.parse(transactionsBlock1[29].logs).errors[0], 'symbol must be string');
  //    assert.equal(JSON.parse(transactionsBlock1[30].logs).errors[0], 'D token must exist');
  //    assert.equal(JSON.parse(transactionsBlock1[31].logs).errors[0], 'fee percentage must be between 0 and 1 / 0% and 100%');
  //    assert.equal(JSON.parse(transactionsBlock1[32].logs).errors[0], 'fee percentage must be between 0 and 1 / 0% and 100%');
  //    assert.equal(JSON.parse(transactionsBlock1[33].logs).errors[0], 'token name must be string')
  //    assert.equal(JSON.parse(transactionsBlock1[34].logs).errors[0], 'invalid name: letters, numbers, whitespaces only, max length of 50')
  //     resolve();
    
  // })
  //     .then(() => {
  //       fixture.tearDown();
  //       done();
  //     });
  // });


//   it('fails to covert token XXX to XXX.D', (done) => {
//     new Promise(async (resolve) => {
      
//       await fixture.setUp();
//     let refBlockNumber =  74391382; 
//       let transactions = [];
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(beeContractPayload)));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(beeContractPayload)));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 1
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 2
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "HBD Pegged", "url": "https://hive-engine.com", "symbol": "SWAP.HBD", "precision": 8, "maxSupply": "1000000000000" }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "drewlongshot", "quantity": "1000", "isSignedWithActiveKey": true }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_PEGGED_ACCOUNT, 'tokens', 'transfer', '{ "symbol": "SWAP.HIVE", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }`));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }`));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "10000", "price": "10", "isSignedWithActiveKey": true }`));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', '{ "symbol": "SWAP.HBD", "quantity": "10000", "price": "0.5", "isSignedWithActiveKey": true }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "100", "price": "10", "isSignedWithActiveKey": true }`));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', '{ "symbol": "SWAP.HBD", "quantity": "100", "price": "0.5","isSignedWithActiveKey": true }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:BEE", "isSignedWithActiveKey": true }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "isSignedWithActiveKey": true }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:BEE", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }')); 
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:BEE", "tokenSymbol": "SWAP.HIVE", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "tokenSymbol": "SWAP.HBD", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
//       // now, do a convert from bee to beed
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'beedollar', 'convert', '{ "quantity": "2000.0", "isSignedWithActiveKey": true }'));
//        //trans24-25 user is token_issuer on a parent token has to pay 1000 Beed to issue D token, ,and not pay a Bee fee of 100 for issue of parent token creatation of parent token brings bee burned total to 2100 
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token", "symbol": "URQTWO", "precision": 3, "maxSupply": "20000", "isSignedWithActiveKey": true  }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'issue', '{ "symbol": "URQTWO", "name": "token", "quantity": "200", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
//       // trans 26 BEE should still be 2100 burned and BEED should be at 1000
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'createTokenD', '{"symbol": "URQTWO", "name": "token", "feePercentage": ".5", "minConvertibleAmount": "1", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
//        // trans 27 active key
//        transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'convert', '{"symbol": "URQTWO", "quantity" : "20", "isSignedWithActiveKey": false }'));
//       // trans 28 invalid quant
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'convert', '{"symbol": "URQTWO", "quantity" : 20, "isSignedWithActiveKey": true }'));
//       // trans 29 +30 invalid symbol
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'convert', '{"symbol": 123, "quantity" : "20", "isSignedWithActiveKey": true }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'convert', '{"symbol": "123", "quantity" : "20", "isSignedWithActiveKey": true }'));
//       //31 quant > min convert
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'convert', '{"symbol": "URQTWO", "quantity" : "-2", "isSignedWithActiveKey": true }'));
//       //32 quant precision mismatch
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'convert', '{"symbol": "URQTWO", "quantity" : "2.0004", "isSignedWithActiveKey": true }'));
//       //33 - 35 Not enough BEED
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'transfer', '{ "symbol": "BEED", "to": "aggroed", "quantity": "980", "isSignedWithActiveKey": true }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'convert', '{"symbol": "URQTWO", "quantity" : "1", "isSignedWithActiveKey": true }'));
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'aggroed', 'tokens', 'transfer', '{ "symbol": "BEED", "to": "drewlongshot", "quantity": "980", "isSignedWithActiveKey": true }'));
//       //36 trying to convert more than you own
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'convert', '{"symbol": "URQTWO", "quantity" : "201", "isSignedWithActiveKey": true }'));
//       //37 market pool validation
//       transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'convert', '{"symbol": "URQTWO", "quantity" : "150", "isSignedWithActiveKey": true }'));




//       let block = {
//         refHiveBlockNumber: refBlockNumber,
//         refHiveBlockId: 'ABCD1',
//         prevRefHiveBlockId: 'ABCD2',
//         timestamp: '2018-06-01T00:00:00',
//         transactions,
//       };
//       await fixture.sendBlock(block);

//        const res = await fixture.database.getBlockInfo(1);

//      const block1 = res;
//      const transactionsBlock1 = block1.transactions;

//      res2 = await fixture.database.findOne({
//       contract: 'marketpools',
//       table: 'pools',
//       query: {tokenPair: 'SWAP.HIVE:BEE'}
//     });


// token = res2
//     console.log(" ")
//     console.log( '\u001b[' + 93 + 'm' + 'fails to covert token XXX to XXX.D' + '\u001b[0m')

//     console.log(token)
//     console.log("  ⚪",JSON.parse(transactionsBlock1[27].logs).errors[0])
//     console.log("  ⚪",JSON.parse(transactionsBlock1[28].logs).errors[0])
//     console.log("  ⚪",JSON.parse(transactionsBlock1[29].logs).errors[0])
//     console.log("  ⚪",JSON.parse(transactionsBlock1[30].logs).errors[0])
//     console.log("  ⚪",JSON.parse(transactionsBlock1[31].logs).errors[0])
//     console.log("  ⚪",JSON.parse(transactionsBlock1[32].logs).errors[0])
//     console.log("  ⚪",JSON.parse(transactionsBlock1[34].logs).errors[0])
//     console.log("  ⚪",JSON.parse(transactionsBlock1[36].logs).errors[0])
//     console.log("  ⚪",JSON.parse(transactionsBlock1[37].logs).errors[0])

//     assert.equal(JSON.parse(transactionsBlock1[27].logs).errors[0], 'you must use a custom_json signed with your active key');
//     assert.equal(JSON.parse(transactionsBlock1[28].logs).errors[0], 'invalid params quantity');
//     assert.equal(JSON.parse(transactionsBlock1[29].logs).errors[0], 'symbol must be string');
//     assert.equal(JSON.parse(transactionsBlock1[30].logs).errors[0], 'parent symbol must have a child .D token');
//     assert.equal(JSON.parse(transactionsBlock1[31].logs).errors[0], 'amount to convert must be >= 1');
//     assert.equal(JSON.parse(transactionsBlock1[32].logs).errors[0], 'symbol precision mismatch');
//     assert.equal(JSON.parse(transactionsBlock1[34].logs).errors[0], 'not enough BEED balance');
//     assert.equal(JSON.parse(transactionsBlock1[36].logs).errors[0], 'not enough parent token balance');
//     assert.equal(JSON.parse(transactionsBlock1[37].logs).errors[0], 'not enough tokens in market pools')


//       resolve();
    
//   })
//       .then(() => {
//         fixture.tearDown();
//         done();
//       });
//   });

it('it coverts XXX to XXX.D', (done) => {
  new Promise(async (resolve) => {
    
    await fixture.setUp();
  let refBlockNumber =  74391382; 
    let transactions = [];
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(tknContractPayload)));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(bdContractPayload)));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(bdContractPayload)));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(beeContractPayload)));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(beeContractPayload)));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 1
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(mpContractPayload))); // update 2
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "HBD Pegged", "url": "https://hive-engine.com", "symbol": "SWAP.HBD", "precision": 8, "maxSupply": "1000000000000" }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "drewlongshot", "quantity": "1000", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_PEGGED_ACCOUNT, 'tokens', 'transfer', '{ "symbol": "SWAP.HIVE", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "drewlongshot", "quantity": "100000", "isSignedWithActiveKey": true }`));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'transfer', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }`));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'tokens', 'issue', '{ "symbol": "SWAP.HBD", "to": "whale", "quantity": "100000", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "10000", "price": "10", "isSignedWithActiveKey": true }`));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'whale', 'market', 'sell', '{ "symbol": "SWAP.HBD", "quantity": "10000", "price": "0.5", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', `{ "symbol": "${CONSTANTS.UTILITY_TOKEN_SYMBOL}", "quantity": "100", "price": "10", "isSignedWithActiveKey": true }`));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'market', 'buy', '{ "symbol": "SWAP.HBD", "quantity": "100", "price": "0.5","isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:BEE", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'marketpools', 'createPool', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:BEE", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }')); 
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'addLiquidity', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "baseQuantity": "20000", "quoteQuantity": "200", "maxDeviation": "0", "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:BEE", "tokenSymbol": "SWAP.HIVE", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'marketpools', 'swapTokens', '{ "tokenPair": "SWAP.HIVE:SWAP.HBD", "tokenSymbol": "SWAP.HBD", "tokenAmount": "5", "tradeType": "exactOutput", "isSignedWithActiveKey": true}'));
    // now, do a convert from bee to beed
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'beedollar', 'convert', '{ "quantity": "2000.0", "isSignedWithActiveKey": true }'));
     //trans24-25 user is token_issuer on a parent token has to pay 1000 Beed to issue D token, ,and not pay a Bee fee of 100 for issue of parent token creatation of parent token brings bee burned total to 2100 
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'create', '{ "isSignedWithActiveKey": true,  "name": "token",  "symbol": "URQTWO", "precision": 3, "maxSupply": "20000", "isSignedWithActiveKey": true  }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'tokens', 'issue', '{ "symbol": "URQTWO", "name": "token", "quantity": "20000", "to": "drewlongshot", "isSignedWithActiveKey": true }'));
    // BEE should still be 2100 burned and BEED should be at 1000
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'createTokenD', '{"symbol": "URQTWO", "name": "token", "feePercentage": ".5", "minConvertibleAmount": "1", "maxSupply": "20000", "precision": 2, "isSignedWithActiveKey": true }'));
    transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'drewlongshot', 'burndollar', 'convert', '{"symbol": "URQTWO", "quantity" : "2000", "isSignedWithActiveKey": true }'));

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

   let res2 = await fixture.database.find({
      contract: 'tokens',
      table: 'tokens',
      query: {symbol:'URQTWO.D'}
    });

    let token = res2

   console.log(" ")
   console.log( '\u001b[' + 93 + 'm' + 'Test: creates a D tokencreates a D token' + '\u001b[0m')
   console.log (token)
   
    resolve();
  
})
    .then(() => {
      fixture.tearDown();
      done();
    });
});



})
