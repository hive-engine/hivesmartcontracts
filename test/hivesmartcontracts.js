/* eslint-disable */
const assert = require('assert');
const { Base64 } = require('js-base64');
const { MongoClient } = require('mongodb');
const { Database } = require('../libs/Database');
const blockchain = require('../plugins/Blockchain');
const { Block } = require('../libs/Block');
const { Transaction } = require('../libs/Transaction');
const { CONSTANTS } = require('../libs/Constants');
const { Fixture, conf } = require('../libs/util/testing/Fixture');
const { TableAsserts } = require('../libs/util/testing/TableAsserts');
const { assertError } = require('../libs/util/testing/Asserts');

const fixture = new Fixture();
const tableAsserts = new TableAsserts(fixture);

// Database
describe('Database', function () {

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
        await db.dropDatabase()
        resolve();
      })
        .then(() => {
          done()
        })
  });

  it('should get the latest block', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', ''));

      let block = new Block(
        '2018-06-01T00:00:00',
        0,
        '',
        '',
        transactions,
        123456788,
        'PREV_HASH',
      );

      await fixture.database.addBlock(block);

      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', ''));

      block = new Block(
        '2018-06-01T00:00:00',
        0,
        '',
        '',
        transactions,
        123456789,
        'PREV_HASH',
      );

      await fixture.database.addBlock(block);

      const res = await fixture.database.getLatestBlockInfo();
      assert.equal(res.blockNumber, 123456790);
      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });
});

// smart contracts
describe('Smart Contracts', function ()  {
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

  it('should deploy a basic smart contract', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = function (payload) {
          // Initialize the smart contract via the create action
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'testcontract',
        params: '',
        code: base64SmartContractCode,
      };

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const contract = await fixture.database.findContract({ name: 'testcontract' });

      assert.equal(contract._id, 'testcontract');
      assert.equal(contract.owner, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      resolve()
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should create a table during the smart contract deployment', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          await api.db.createTable('testTable');
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'testcontract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const contract = await fixture.database.findContract({ name: 'testcontract' });

      assert.notEqual(contract.tables['testcontract_testTable'], undefined);

      res = await fixture.database.getTableDetails({ contract: 'testcontract', table: 'testTable' });

      assert.notEqual(res, null);
      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should create a table with indexes during the smart contract deployment', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          await api.db.createTable('testTable', ['index1', 'index2']);
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'testcontract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const table = await fixture.database.getTableDetails({ contract: 'testcontract', table: 'testTable' });
      const { indexes } = table;

      assert.equal(indexes._id_[0][0], '_id');
      assert.equal(indexes._id_[0][1], 1);

      assert.equal(indexes.index1_1[0][0], 'index1');
      assert.equal(indexes.index1_1[0][1], 1);

      assert.equal(indexes.index2_1[0][0], 'index2');
      assert.equal(indexes.index2_1[0][1], 1);

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should add a record into a smart contract table', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();
      
      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          await api.db.createTable('users');
        }

        actions.addUser = async (payload) => {
          const newUser = {
            'id': api.sender
          };

          await api.db.insert('users', newUser);
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'usersContract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', ''));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const user = await fixture.database.findOne({ contract: 'usersContract', table: 'users', query: { "id": CONSTANTS.HIVE_ENGINE_ACCOUNT } });

      assert.equal(user.id, CONSTANTS.HIVE_ENGINE_ACCOUNT);

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should update a record from a smart contract table', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();
      
      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          await api.db.createTable('users');
        }

        actions.addUser = async (payload) => {
          const newUser = {
            'id': api.sender,
            'username': api.sender
          };

          await api.db.insert('users', newUser);
        }

        actions.updateUser = async (payload) => {
          const { username } = payload;
          
          let user = await api.db.findOne('users', { 'id': api.sender });

          user.username = username;

          await api.db.update('users', user);
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'usersContract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'updateUser', '{ "username": "MyUsernameUpdated" }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const user = await fixture.database.findOne({ contract: 'usersContract', table: 'users', query: { "id": CONSTANTS.HIVE_ENGINE_ACCOUNT } })

      assert.equal(user.id, CONSTANTS.HIVE_ENGINE_ACCOUNT);
      assert.equal(user.username, 'MyUsernameUpdated');

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should remove a record from a smart contract table', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          await api.db.createTable('users');
        }

        actions.addUser = async (payload) => {
          const newUser = {
            'id': api.sender,
            'username': api.sender
          };

          await api.db.insert('users', newUser);
        }

        actions.removeUser = async (payload) => {
          let user = await api.db.findOne('users', { 'id': api.sender });

          await api.db.remove('users', user);
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'usersContract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'removeUser', ''));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const user = await fixture.database.findOne({ contract: 'usersContract', table: 'users', query: { "id": CONSTANTS.HIVE_ENGINE_ACCOUNT } });

      assert.equal(user, null);

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should read the records from a smart contract table via pagination', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          await api.db.createTable('users');
        }

        actions.addUser = async (payload) => {
          const newUser = {
            'id': api.sender,
            'username': api.sender
          };

          await api.db.insert('users', newUser);
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'usersContract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT1', 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT2', 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT3', 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT4', 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT5', 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT6', 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT7', 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT8', 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT9', 'usersContract', 'addUser', ''));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5
      };

      let users = await fixture.database.find(payload);

      assert.equal(users[0]._id, 1);
      assert.equal(users[4]._id, 5);

      payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 5,
      };

      users = await fixture.database.find(payload);

      assert.equal(users[0]._id, 6);
      assert.equal(users[4]._id, 10);

      payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 10,
      };

      users = await fixture.database.find(payload);

      assert.equal(users.length, 0);

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should read the records from a smart contract table using an index ascending (integer)', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          await api.db.createTable('users', ['age']);
        }

        actions.addUser = async (payload) => {
          const { age } = payload;

          const newUser = {
            'id': api.sender,
            age
          };

          await api.db.insert('users', newUser);
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'usersContract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', '{ "age": 2 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT1', 'usersContract', 'addUser', '{ "age": 10 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT2', 'usersContract', 'addUser', '{ "age": 3 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT3', 'usersContract', 'addUser', '{ "age": 199 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT4', 'usersContract', 'addUser', '{ "age": 200 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT5', 'usersContract', 'addUser', '{ "age": 1 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT6', 'usersContract', 'addUser', '{ "age": 89 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT7', 'usersContract', 'addUser', '{ "age": 2 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT8', 'usersContract', 'addUser', '{ "age": 34 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT9', 'usersContract', 'addUser', '{ "age": 20 }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 0,
        indexes: [{ index: 'age', descending: false }],
      };

      let users = await fixture.database.find(payload);

      assert.equal(users[0].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT5');
      assert.equal(users[4].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT1');

      payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 5,
        indexes: [{ index: 'age', descending: false }],
      };

      users = await fixture.database.find(payload);

      assert.equal(users[0].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT9');
      assert.equal(users[4].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT4');

      payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 10,
        indexes: [{ index: 'age', descending: false }],
      };

      users = await fixture.database.find(payload);

      assert.equal(users.length, 0);

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should read the records from a smart contract table using an index ascending (string)', (done) => {
    new Promise(async (resolve) => {
      
      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          await api.db.createTable('users', ['age']);
        }

        actions.addUser = async (payload) => {
          const { age } = payload;

          const newUser = {
            'id': api.sender,
            age
          };

          await api.db.insert('users', newUser);
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'usersContract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', '{ "age": "2" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT1', 'usersContract', 'addUser', '{ "age": "10" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT2', 'usersContract', 'addUser', '{ "age": "3" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT3', 'usersContract', 'addUser', '{ "age": "199" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT4', 'usersContract', 'addUser', '{ "age": "200" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT5', 'usersContract', 'addUser', '{ "age": "1" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT6', 'usersContract', 'addUser', '{ "age": "89" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT7', 'usersContract', 'addUser', '{ "age": "2" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT8', 'usersContract', 'addUser', '{ "age": "34" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT9', 'usersContract', 'addUser', '{ "age": "20" }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 0,
        indexes: [{ index: 'age', descending: false }],
      };

      let users = await fixture.database.find(payload);;

      assert.equal(users[0].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT5');
      assert.equal(users[4].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT7');

      payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 5,
        indexes: [{ index: 'age', descending: false }],
      };

      users = await fixture.database.find(payload);;

      assert.equal(users[0].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT9');
      assert.equal(users[4].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT6');

      payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 10,
        indexes: [{ index: 'age', descending: false }],
      };

      users = await fixture.database.find(payload);;

      assert.equal(users.length, 0);

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should read the records from a smart contract table using an index descending (integer)', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          await api.db.createTable('users', ['age']);
        }

        actions.addUser = async (payload) => {
          const { age } = payload;

          const newUser = {
            'id': api.sender,
            age
          };

          await api.db.insert('users', newUser);
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'usersContract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', '{ "age": 2 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT1', 'usersContract', 'addUser', '{ "age": 10 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT2', 'usersContract', 'addUser', '{ "age": 3 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT3', 'usersContract', 'addUser', '{ "age": 199 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT4', 'usersContract', 'addUser', '{ "age": 200 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT5', 'usersContract', 'addUser', '{ "age": 1 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT6', 'usersContract', 'addUser', '{ "age": 89 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT7', 'usersContract', 'addUser', '{ "age": 2 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT8', 'usersContract', 'addUser', '{ "age": 34 }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT9', 'usersContract', 'addUser', '{ "age": 20 }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        indexes: [{ index: 'age', descending: true }],
      };

      let users = await fixture.database.find(payload);;

      assert.equal(users[0].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT4');
      assert.equal(users[4].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT9');

      payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 5,
        indexes: [{ index: 'age', descending: true }],
      };

      users = await fixture.database.find(payload);

      assert.equal(users[0].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT1');
      assert.equal(users[4].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT5');

      payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 10,
        indexes: [{ index: 'age', descending: true }],
      };

      users = await fixture.database.find(payload);;

      assert.equal(users.length, 0);

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should read the records from a smart contract table using an index descending (string)', (done) => {
    new Promise(async (resolve) => {
      
      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          await api.db.createTable('users', ['age']);
        }

        actions.addUser = async (payload) => {
          const { age } = payload;

          const newUser = {
            'id': api.sender,
            age
          };

          await api.db.insert('users', newUser);
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'usersContract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', '{ "age": "2" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT1', 'usersContract', 'addUser', '{ "age": "10" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT2', 'usersContract', 'addUser', '{ "age": "3" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT3', 'usersContract', 'addUser', '{ "age": "199" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT4', 'usersContract', 'addUser', '{ "age": "200" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT5', 'usersContract', 'addUser', '{ "age": "1" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT6', 'usersContract', 'addUser', '{ "age": "89" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT7', 'usersContract', 'addUser', '{ "age": "2" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT8', 'usersContract', 'addUser', '{ "age": "34" }'));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'CONSTANTS.HIVE_ENGINE_ACCOUNT9', 'usersContract', 'addUser', '{ "age": "20" }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        indexes: [{ index: 'age', descending: true }],
      };

      let users = await fixture.database.find(payload);;

      assert.equal(users[0].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT6');
      assert.equal(users[4].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT9');

      payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 5,
        indexes: [{ index: 'age', descending: true }],
      };

      users = await fixture.database.find(payload);;

      assert.equal(users[0].id, 'hive-engine');
      assert.equal(users[4].id, 'CONSTANTS.HIVE_ENGINE_ACCOUNT5');

      payload = {
        contract: 'usersContract',
        table: 'users',
        query: {},
        limit: 5,
        offset: 10,
        indexes: [{ index: 'age', descending: true }],
      };

      users = await fixture.database.find(payload);;

      assert.equal(users.length, 0);

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should allow only the owner of the smart contract to perform certain actions', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          await api.db.createTable('users');
        }

        actions.addUser = async (payload) => {
          if (api.sender !== api.owner) return;

          const { userId } = payload;
  
          const newUser = {
            'id': userId
          };

          await api.db.insert('users', newUser);
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'usersContract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'Dan', 'usersContract', 'addUser', '{ "userId": "Dan" }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let user = await fixture.database.findOne({ contract: 'usersContract', table: 'users', query: { "id": "Dan" } });

      assert.equal(user, null);

      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', '{ "userId": "Dan" }'));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:03',
        transactions,
      };

      await fixture.sendBlock(block);

      user = await fixture.database.findOne({ contract: 'usersContract', table: 'users', query: { "id": "Dan" } });

      assert.equal(user.id, "Dan");

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should perform a search in a smart contract table from another smart contract', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const usersSmartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          await api.db.createTable('users');
        }

        actions.addUser = async (payload) => {
          const newUser = {
            'id': api.sender,
            'username': api.sender
          };

          await api.db.insert('users', newUser);
        }
      `;

      const booksSmartContractCode = `
      actions.createSSC = async (payload) => {
        // Initialize the smart contract via the create action
        await api.db.createTable('books');
      }
      
      actions.addBook = async (payload) => {

        const { title } = payload;

        let user = await api.db.findOneInTable('usersContract', 'users', { "id": api.sender });

        if (user) {
          const newBook = {
            'userId': user.id,
            title
          };
  
          await api.db.insert('books', newBook);
        }
      }
    `;

      const base64UsersSmartContractCode = Base64.encode(usersSmartContractCode);
      const base64BooksSmartContractCode = Base64.encode(booksSmartContractCode);

      const usersContractPayload = {
        name: 'usersContract',
        params: '',
        code: base64UsersSmartContractCode,
      };

      const booksContractPayload = {
        name: 'booksContract',
        params: '',
        code: base64BooksSmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(usersContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(booksContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', ''));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'booksContract', 'addBook', '{ "title": "The Awesome Book" }'));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const book = await fixture.database.findOne({ contract: 'booksContract', table: 'books', query: { "userId": CONSTANTS.HIVE_ENGINE_ACCOUNT } });

      assert.equal(book.title, "The Awesome Book");

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should execute a smart contract from another smart contract', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const usersSmartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          await api.db.createTable('users');
        }

        actions.addUser = async (payload) => {
          const newUser = {
            'id': api.sender,
            'username': api.sender
          };

          const user = await api.db.insert('users', newUser);

          await api.executeSmartContract('booksContract', 'addBook', { "title": "The Awesome Book" })
        }
      `;

      const booksSmartContractCode = `
      actions.createSSC = async (payload) => {
        // Initialize the smart contract via the create action
        await api.db.createTable('books');
      }
      
      actions.addBook = async (payload) => {
        const { title, callingContractInfo } = payload;

        api.debug(callingContractInfo.name)
        api.debug(callingContractInfo.version)
        
        let user = await api.db.findOneInTable('usersContract', 'users', { "id": api.sender });

        if (user) {
          const newBook = {
            'userId': user.id,
            title
          };

          const book = await api.db.insert('books', newBook);
        }
      }
    `;

      const base64UsersSmartContractCode = Base64.encode(usersSmartContractCode);
      const base64BooksSmartContractCode = Base64.encode(booksSmartContractCode);

      const usersContractPayload = {
        name: 'usersContract',
        params: '',
        code: base64UsersSmartContractCode,
      };

      const booksContractPayload = {
        name: 'booksContract',
        params: '',
        code: base64BooksSmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(usersContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(booksContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', ''));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const book = await fixture.database.findOne({ contract: 'booksContract', table: 'books', query: { "userId": CONSTANTS.HIVE_ENGINE_ACCOUNT } });

      assert.equal(book.title, "The Awesome Book");

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should emit an event from a smart contract', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = function (payload) {
          // Initialize the smart contract via the create action
          api.emit('contract_create', { "contractName": "testcontract" })
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'testcontract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      const createContractTx = fixture.getNextTxId();
      transactions.push(new Transaction(refBlockNumber, createContractTx, CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const latestBlock = await fixture.database.getLatestBlockInfo();

      const txs = latestBlock.transactions.filter(transaction => transaction.transactionId === createContractTx);

      const logs = JSON.parse(txs[0].logs);

      assert.equal(logs.events[0].event, 'contract_create');
      assert.equal(logs.events[0].data.contractName, 'testcontract');

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should emit an event from another smart contract', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const usersSmartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
        }

        actions.addUser = async (payload) => {
          await api.executeSmartContract('booksContract', 'addBook', { })
        }
      `;

      const booksSmartContractCode = `
      actions.createSSC = async (payload) => {
        // Initialize the smart contract via the create action
      }
      
      actions.addBook = async (payload) => {
        api.emit('contract_create', { "contractName": "testcontract" });
      }
    `;

      const base64UsersSmartContractCode = Base64.encode(usersSmartContractCode);
      const base64BooksSmartContractCode = Base64.encode(booksSmartContractCode);

      const usersContractPayload = {
        name: 'usersContract',
        params: '',
        code: base64UsersSmartContractCode,
      };

      const booksContractPayload = {
        name: 'booksContract',
        params: '',
        code: base64BooksSmartContractCode,
      };


      // before cutoff
      let refBlockNumber = 1000;
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(usersContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(booksContractPayload)));
      const addUserTx = fixture.getNextTxId();
      transactions.push(new Transaction(refBlockNumber, addUserTx, CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', ''));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);
      await tableAsserts.assertNoErrorInLastBlock();

      const latestBlock = await fixture.database.getLatestBlockInfo();

      const txs = latestBlock.transactions.filter(transaction => transaction.transactionId === addUserTx);

      const logs = JSON.parse(txs[0].logs);

      assert.equal(logs.events[0].event, 'contract_create');
      assert.equal(logs.events[0].data.contractName, 'testcontract');
      assert.equal(txs[0].executedCodeHash, '8f9127047c5d1b13db1d08452fc5de68fb0e787025a405a58a780e545bd21dab9d0452e18c4662c7a59f0068fa7b0e1302c50e470fc486043c624fead2559628');

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });


  it('should trim executionCodeHash after cutoff', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const usersSmartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
        }

        actions.addUser = async (payload) => {
          await api.executeSmartContract('booksContract', 'addBook', { })
        }
      `;

      const booksSmartContractCode = `
      actions.createSSC = async (payload) => {
        // Initialize the smart contract via the create action
      }

      actions.addBook = async (payload) => {
        api.emit('contract_create', { "contractName": "testcontract" });
      }
    `;

      const base64UsersSmartContractCode = Base64.encode(usersSmartContractCode);
      const base64BooksSmartContractCode = Base64.encode(booksSmartContractCode);

      const usersContractPayload = {
        name: 'usersContract',
        params: '',
        code: base64UsersSmartContractCode,
      };

      const booksContractPayload = {
        name: 'booksContract',
        params: '',
        code: base64BooksSmartContractCode,
      };


      // after cutoff for truncation
      let refBlockNumber = 99999999;
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(usersContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(booksContractPayload)));
      const createContractTx = fixture.getNextTxId();
      transactions.push(new Transaction(refBlockNumber, createContractTx, CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', ''));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const latestBlock = await fixture.database.getLatestBlockInfo();

      const txs = latestBlock.transactions.filter(transaction => transaction.transactionId === createContractTx);

      const logs = JSON.parse(txs[0].logs);

      assert.equal(logs.events[0].event, 'contract_create');
      assert.equal(logs.events[0].data.contractName, 'testcontract');
      assert.equal(txs[0].executedCodeHash, 'defd36cc6c47126c8ca875bd1952a09bbf6d7baaab13f75252b0d717b0d07664');

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should log a node error during the deployment of a smart contract if an error is thrown up to block 83680408', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          
          THIS CODE CRASHES :)
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'testcontract',
        params: '',
        code: base64SmartContractCode,
      };

      let transactions = [];
      const crashTx = fixture.getNextTxId();
      transactions.push(new Transaction(83680408, crashTx, CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));

      let block = {
        refHiveBlockNumber: 83680408,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const latestBlock = await fixture.database.getLatestBlockInfo();

      const txs = latestBlock.transactions.filter(transaction => transaction.transactionId === crashTx);

      const logs = JSON.parse(txs[0].logs);

      assert.equal(logs.errors[0], "SyntaxError: Unexpected identifier");

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should log a custom error during the deployment of a smart contract if an error is thrown after block 83680408', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
          
          THIS CODE CRASHES :)
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'testcontract',
        params: '',
        code: base64SmartContractCode,
      };

      let transactions = [];
      const crashTx = fixture.getNextTxId();
      transactions.push(new Transaction(83680409, crashTx, CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));

      let block = {
        refHiveBlockNumber: 83680409,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const latestBlock = await fixture.database.getLatestBlockInfo();

      const txs = latestBlock.transactions.filter(transaction => transaction.transactionId === crashTx);

      const logs = JSON.parse(txs[0].logs);

      assert.equal(logs.errors[0], "A node.js error occoured during deployment");

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should log an error during the execution of a smart contract if an error is thrown', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
        }

        actions.addUser = async (payload) => {
          let test = test1.crash
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'testcontract',
        params: '',
        code: base64SmartContractCode,
      };

      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));
      const errorTx = fixture.getNextTxId();
      transactions.push(new Transaction(refBlockNumber, errorTx, CONSTANTS.HIVE_ENGINE_ACCOUNT, 'testcontract', 'addUser', ''));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const latestBlock = await fixture.database.getLatestBlockInfo();

      const txs = latestBlock.transactions.filter(transaction => transaction.transactionId === errorTx);

      const logs = JSON.parse(txs[0].logs);

      assert.equal(logs.errors[0], "ReferenceError: test1 is not defined");

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should log an error from another smart contract', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const usersSmartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
        }

        actions.addUser = async (payload) => {
          await api.executeSmartContract('booksContract', 'addBook', { })
        }
      `;

      const booksSmartContractCode = `
      actions.createSSC = async (payload) => {
        // Initialize the smart contract via the create action
      }
      
      actions.addBook = async (payload) => {
        let test = test1.crash
      }
    `;

      const base64UsersSmartContractCode = Base64.encode(usersSmartContractCode);
      const base64BooksSmartContractCode = Base64.encode(booksSmartContractCode);

      const usersContractPayload = {
        name: 'usersContract',
        params: '',
        code: base64UsersSmartContractCode,
      };

      const booksContractPayload = {
        name: 'booksContract',
        params: '',
        code: base64BooksSmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(usersContractPayload)));
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(booksContractPayload)));
      const errorTx = fixture.getNextTxId();
      transactions.push(new Transaction(refBlockNumber, errorTx, CONSTANTS.HIVE_ENGINE_ACCOUNT, 'usersContract', 'addUser', ''));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const latestBlock = await fixture.database.getLatestBlockInfo()

      const txs = latestBlock.transactions.filter(transaction => transaction.transactionId === errorTx);

      const logs = JSON.parse(txs[0].logs);

      assert.equal(logs.errors[0], "ReferenceError: test1 is not defined");

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should generate random numbers in a deterministic way', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      const smartContractCode = `
        actions.createSSC = async (payload) => {
          // Initialize the smart contract via the create action
        }

        actions.generateRandomNumbers = async (payload) => {
          let generatedRandom = api.random();

          api.emit('random_generated', { generatedRandom })

          generatedRandom = api.random();

          api.emit('random_generated', { generatedRandom })
        }
      `;

      const base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'random',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'deploy', JSON.stringify(contractPayload)));
      let txId = fixture.getNextTxId();
      transactions.push(new Transaction(refBlockNumber, txId, CONSTANTS.HIVE_ENGINE_ACCOUNT, 'random', 'generateRandomNumbers', ''));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      let latestBlock = await fixture.database.getLatestBlockInfo();

      let txs = latestBlock.transactions.filter(transaction => transaction.transactionId === txId);

      let logs = JSON.parse(txs[0].logs);

      assert.equal(logs.events[0].event, 'random_generated');
      assert.equal(logs.events[0].data.generatedRandom, 0.1167167315351255);
      assert.equal(logs.events[1].event, 'random_generated');
      assert.equal(logs.events[1].data.generatedRandom, 0.36510788325979454);

      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions = [];
      txId = fixture.getNextTxId();
      transactions.push(new Transaction(refBlockNumber, txId, CONSTANTS.HIVE_ENGINE_ACCOUNT, 'random', 'generateRandomNumbers', ''));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      latestBlock = await fixture.database.getLatestBlockInfo();

      txs = latestBlock.transactions.filter(transaction => transaction.transactionId === txId);

      logs = JSON.parse(txs[0].logs);

      assert.equal(logs.events[0].event, 'random_generated');
      assert.equal(logs.events[0].data.generatedRandom, 0.9859509999175694);
      assert.equal(logs.events[1].event, 'random_generated');
      assert.equal(logs.events[1].data.generatedRandom, 0.7988133957484077);

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });

  it('should update a smart contract', (done) => {
    new Promise(async (resolve) => {

      await fixture.setUp();

      let smartContractCode = `
        actions.createSSC = async (payload) => {
          await api.db.createTable('testTable');
        }
      `;

      let base64SmartContractCode = Base64.encode(smartContractCode);

      const contractPayload = {
        name: 'testcontract',
        params: '',
        code: base64SmartContractCode,
      };


      let refBlockNumber = fixture.getNextRefBlockNumber();
      let transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), 'null', 'contract', 'deploy', JSON.stringify(contractPayload)));

      let block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD1',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:00:00',
        transactions,
      };

      await fixture.sendBlock(block);

      smartContractCode = `
        actions.createSSC = async (payload) => {
          await api.db.createTable('testUpdateTable');
        }
      `;

      base64SmartContractCode = Base64.encode(smartContractCode);

      contractPayload.code = base64SmartContractCode;

      refBlockNumber = fixture.getNextRefBlockNumber();
      transactions = [];
      transactions.push(new Transaction(refBlockNumber, fixture.getNextTxId(), CONSTANTS.HIVE_ENGINE_ACCOUNT, 'contract', 'update', JSON.stringify(contractPayload)));

      block = {
        refHiveBlockNumber: refBlockNumber,
        refHiveBlockId: 'ABCD3',
        prevRefHiveBlockId: 'ABCD2',
        timestamp: '2018-06-01T00:01:00',
        transactions,
      };

      await fixture.sendBlock(block);

      const contract = await fixture.database.findContract({ name: 'testcontract' });

      assert.equal(contract.version, 2);
      assert.notEqual(contract.tables['testcontract_testTable'], undefined);
      assert.notEqual(contract.tables['testcontract_testUpdateTable'], undefined);

      res = await fixture.database.getTableDetails({ contract: 'testcontract', table: 'testTable' })

      assert.notEqual(res, null);

      res = await fixture.database.getTableDetails({ contract: 'testcontract', table: 'testUpdateTable' })

      assert.notEqual(res, null);

      resolve();
    })
      .then(() => {
        fixture.tearDown();
        done();
      });
  });
});
