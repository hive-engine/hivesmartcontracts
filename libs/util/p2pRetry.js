const MAX_PROPOSE_ROUND_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 8000;
const MAX_RETRY_DELAY_MS = 60000;
const RETRY_JITTER_MS = 1000;

// Jitter only schedules network retries; it never affects block or signature calculations.
const getRetryDelay = (retry, random = Math.random) => {
  const exponentialDelay = Math.min(BASE_RETRY_DELAY_MS * (2 ** retry), MAX_RETRY_DELAY_MS);
  return exponentialDelay + Math.floor(random() * RETRY_JITTER_MS);
};

const isRetryableTimeoutError = (error) => {
  if (!error) return false;
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
    return true;
  }
  const message = String(error);
  return message.includes('ETIMEDOUT')
    || message.includes('ECONNABORTED')
    || /timeout of \d+ms exceeded/i.test(message);
};

module.exports = {
  MAX_PROPOSE_ROUND_RETRIES,
  getRetryDelay,
  isRetryableTimeoutError,
};
