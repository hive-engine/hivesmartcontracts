/* eslint-env mocha */
const assert = require('assert').strict;
const { calculateRoundHash } = require('../libs/util/roundHash');

describe('P2P round hash calculation', () => {
  const blocks = Array.from({ length: 24 }, (_, index) => ({ hash: `block-hash-${index + 1}` }));

  it('fetches with bounded concurrency and hashes in block order', async () => {
    let activeFetches = 0;
    let maximumActiveFetches = 0;
    const getBlockInfo = async (blockNumber) => {
      activeFetches += 1;
      maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
      await new Promise((resolve) => {
        setTimeout(resolve, (blockNumber % 4) * 2);
      });
      activeFetches -= 1;
      return blocks[blockNumber - 1];
    };

    const sequentialHash = await calculateRoundHash(1, blocks.length, getBlockInfo, 1);
    maximumActiveFetches = 0;
    const concurrentHash = await calculateRoundHash(1, blocks.length, getBlockInfo, 5);

    assert.equal(concurrentHash, sequentialHash);
    assert.ok(maximumActiveFetches > 1);
    assert.ok(maximumActiveFetches <= 5);
  });

  it('returns null when any requested block is missing', async () => {
    const getBlockInfo = async (blockNumber) => (
      blockNumber === 3 ? null : blocks[blockNumber - 1]
    );

    assert.equal(await calculateRoundHash(1, 5, getBlockInfo, 3), null);
  });

  it('propagates block-fetch errors instead of hashing a partial range', async () => {
    const getBlockInfo = async (blockNumber) => {
      if (blockNumber === 3) throw new Error('database read failed');
      return blocks[blockNumber - 1];
    };

    await assert.rejects(calculateRoundHash(1, 5, getBlockInfo, 3), /database read failed/);
  });
});
