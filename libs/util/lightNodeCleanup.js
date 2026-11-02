const getCleanupDecision = (syncLag, consecutiveSkips, lagThreshold, maxConsecutiveSkips) => {
  if (!Number.isFinite(syncLag)) {
    return { shouldSkip: false, reason: 'sync lag unavailable' };
  }

  if (syncLag <= lagThreshold) {
    return { shouldSkip: false, reason: 'within cleanup lag threshold' };
  }

  if (consecutiveSkips < maxConsecutiveSkips) {
    return { shouldSkip: true, reason: 'node is catching up' };
  }

  return { shouldSkip: false, reason: 'maximum consecutive cleanup skips reached' };
};

module.exports.getCleanupDecision = getCleanupDecision;
