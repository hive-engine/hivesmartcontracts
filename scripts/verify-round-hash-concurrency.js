#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint-disable no-await-in-loop, no-restricted-syntax */
const { MongoClient } = require('mongodb');
const config = require('../config.json');
const { calculateRoundHash } = require('../libs/util/roundHash');

const args = process.argv.slice(2);
const concurrencyArgument = args.find((argument) => argument.startsWith('--concurrency='));
const concurrency = concurrencyArgument
  ? Number(concurrencyArgument.slice('--concurrency='.length))
  : 5;
const ranges = args.filter((argument) => !argument.startsWith('--'));

const parseRange = (range) => {
  const [startText, endText] = range.split(':');
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
    throw new Error(`Invalid block range: ${range}; expected start:end with start <= end`);
  }
  return { start, end };
};

const main = async () => {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || ranges.length === 0) {
    throw new Error('Usage: node scripts/verify-round-hash-concurrency.js [--concurrency=5] <start:end> [...]');
  }

  const parsedRanges = ranges.map(parseRange);
  const poolConfig = config.databasePool && typeof config.databasePool === 'object'
    ? config.databasePool
    : {};
  const client = await MongoClient.connect(config.databaseURL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    ...poolConfig,
  });

  try {
    const chain = client.db(config.databaseName).collection('chain');
    const getBlockInfo = (blockNumber) => chain.findOne({ _id: blockNumber });

    for (const { start, end } of parsedRanges) {
      const sequentialHash = await calculateRoundHash(start, end, getBlockInfo, 1);
      const concurrentHash = await calculateRoundHash(start, end, getBlockInfo, concurrency);
      if (sequentialHash === null || concurrentHash === null) {
        throw new Error(`Missing block in historical range ${start}:${end}`);
      }
      if (sequentialHash !== concurrentHash) {
        throw new Error(`Round hash mismatch for ${start}:${end}`);
      }
      console.log(`${start}:${end} matches (${sequentialHash})`);
    }
  } finally {
    await client.close();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
