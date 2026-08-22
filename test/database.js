/* eslint-disable */
const assert = require('assert');
const { Database } = require('../libs/Database');

describe('Database', function () {
  it('batches transaction index writes in order', async () => {
    let insertManyArgs = null;
    const database = {
      collection: () => ({
        insertMany: async (...args) => {
          insertManyArgs = args;
        },
      }),
    };

    await Database.prototype.addTransactions.call({
      database,
      session: 'test-session',
    }, {
      blockNumber: 42,
      transactions: [
        { transactionId: 'tx-1' },
        { transactionId: 'tx-2' },
      ],
    });

    assert.deepEqual(insertManyArgs, [
      [
        { _id: 'tx-1', blockNumber: 42, index: 0 },
        { _id: 'tx-2', blockNumber: 42, index: 1 },
      ],
      { ordered: true, session: 'test-session' },
    ]);
  });

  it('does not issue an empty batch insert', async () => {
    let insertManyCalled = false;
    const database = {
      collection: () => ({
        insertMany: async () => {
          insertManyCalled = true;
        },
      }),
    };

    await Database.prototype.addTransactions.call({
      database,
      session: 'test-session',
    }, { blockNumber: 42, transactions: [] });

    assert.equal(insertManyCalled, false);
  });
});
