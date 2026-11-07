/* eslint-env mocha */
const assert = require('assert').strict;
const {
  MAX_PROPOSE_ROUND_RETRIES,
  getRetryDelay,
  isRetryableTimeoutError,
} = require('../libs/util/p2pRetry');

describe('P2P round retry backoff', () => {
  it('uses capped exponential delays with additive jitter', () => {
    assert.equal(getRetryDelay(0, () => 0), 8000);
    assert.equal(getRetryDelay(1, () => 0), 16000);
    assert.equal(getRetryDelay(2, () => 0), 32000);
    assert.equal(getRetryDelay(2, () => 0.999), 32999);
    assert.equal(getRetryDelay(5, () => 0), 60000);
  });

  it('keeps the worst-case retry window inside a two-minute round', () => {
    let maximumBackoffMs = 0;
    for (let retry = 0; retry < MAX_PROPOSE_ROUND_RETRIES; retry += 1) {
      maximumBackoffMs += getRetryDelay(retry, () => 0.999);
    }

    const maximumRequestTimeMs = (MAX_PROPOSE_ROUND_RETRIES + 1) * 10000;
    assert.equal(maximumBackoffMs, 58997);
    assert.ok(maximumBackoffMs + maximumRequestTimeMs < 120000);
  });

  it('detects both OS-level ETIMEDOUT and Axios request timeouts', () => {
    assert.equal(isRetryableTimeoutError(new Error('connect ETIMEDOUT 1.2.3.4:5001')), true);
    assert.equal(isRetryableTimeoutError({ code: 'ETIMEDOUT', message: 'socket hang up' }), true);
    assert.equal(
      isRetryableTimeoutError({
        code: 'ECONNABORTED',
        message: 'timeout of 10000ms exceeded',
        toString() {
          return 'AxiosError: timeout of 10000ms exceeded';
        },
      }),
      true,
    );
    assert.equal(
      isRetryableTimeoutError(new Error('AxiosError: timeout of 10000ms exceeded')),
      true,
    );
    assert.equal(isRetryableTimeoutError(new Error('connect ECONNREFUSED 1.2.3.4:5001')), false);
    assert.equal(isRetryableTimeoutError(null), false);
  });
});
