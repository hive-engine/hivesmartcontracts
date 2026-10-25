/* eslint-disable no-await-in-loop, no-restricted-syntax */
const SHA256 = require('crypto-js/sha256');
const enchex = require('crypto-js/enc-hex');

const calculateRoundHash = async (startBlock, endBlock, getBlockInfo, concurrency = 1) => {
  const blockCount = endBlock - startBlock + 1;
  if (blockCount <= 0) return '';

  const safeConcurrency = Number.isSafeInteger(concurrency) && concurrency > 0
    ? concurrency
    : 1;
  const workerCount = Math.min(blockCount, safeConcurrency);
  const blockHashes = new Array(blockCount);
  let nextIndex = 0;
  let stopFetching = false;
  let missingBlock = false;

  const fetchNextBlock = async () => {
    while (!stopFetching) {
      const blockIndex = nextIndex;
      nextIndex += 1;
      if (blockIndex >= blockCount) return;

      let blockInfo;
      try {
        blockInfo = await getBlockInfo(startBlock + blockIndex);
      } catch (error) {
        stopFetching = true;
        throw error;
      }

      if (blockInfo === null) {
        missingBlock = true;
        stopFetching = true;
        return;
      }

      blockHashes[blockIndex] = blockInfo.hash;
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => fetchNextBlock()));

  if (missingBlock) return null;

  let calculatedRoundHash = '';
  for (const blockHash of blockHashes) {
    calculatedRoundHash = SHA256(`${calculatedRoundHash}${blockHash}`).toString(enchex);
  }

  return calculatedRoundHash;
};

module.exports.calculateRoundHash = calculateRoundHash;
