/* eslint-disable */
const assert = require('assert');
const { Database } = require('../libs/Database');
const { getCleanupDecision } = require('../libs/util/lightNodeCleanup');

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

  it('caches the last verified block number until its TTL expires', async () => {
    const originalNow = Date.now;
    let now = 1000;
    let reads = 0;
    let lastVerifiedBlockNumber = 10000;
    const cleanedUntil = [];
    Date.now = () => now;

    const database = {
      lightNode: true,
      blocksToKeep: 100,
      cachedLastVerifiedBlockNumber: null,
      lastVerifiedBlockNumberFetchedAt: null,
      findOne: async () => {
        reads += 1;
        return { lastVerifiedBlockNumber };
      },
      cleanupBlocks: async block => cleanedUntil.push(block),
      cleanupTransactions: async () => {},
    };

    try {
      await Database.prototype.cleanupLightNode.call(database, 100);
      lastVerifiedBlockNumber = 12000;
      now = 1050;
      await Database.prototype.cleanupLightNode.call(database, 100);
      assert.equal(reads, 1);
      assert.deepEqual(cleanedUntil, [9899, 9899]);

      now = 1100;
      await Database.prototype.cleanupLightNode.call(database, 100);
      assert.equal(reads, 2);
      assert.deepEqual(cleanedUntil, [9899, 9899, 11899]);
    } finally {
      Date.now = originalNow;
    }
  });

  it('runs cleanup when sync lag is unknown', () => {
    assert.deepEqual(getCleanupDecision(null, 0, 1000, 3), {
      shouldSkip: false,
      reason: 'sync lag unavailable',
    });
  });

  it('skips cleanup only while far behind and below the skip ceiling', () => {
    assert.equal(getCleanupDecision(1001, 2, 1000, 3).shouldSkip, true);
    assert.equal(getCleanupDecision(1000, 0, 1000, 3).shouldSkip, false);
    assert.equal(getCleanupDecision(1500, 3, 1000, 3).shouldSkip, false);
  });
});
