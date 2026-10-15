// Pure function: turns environment variables into validated queue settings.

const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
};

function parseQueueConfig(env) {
  const mode = (env.QUEUE_MODE || 'mongo').trim().toLowerCase();
  if (!['mongo', 'sqs'].includes(mode)) {
    throw new Error(`QUEUE_MODE must be "mongo" or "sqs" (got "${env.QUEUE_MODE}")`);
  }
  if (mode === 'sqs' && !env.SQS_QUEUE_URL) {
    throw new Error('SQS_QUEUE_URL is required when QUEUE_MODE=sqs');
  }
  return {
    mode,
    url: env.SQS_QUEUE_URL || null,
    region: env.AWS_REGION || 'ap-south-1',
    // SQS allows 0 to 20 seconds of long polling.
    waitSeconds: Math.min(Math.max(int(env.SQS_WAIT_SECONDS, 20), 0), 20),
    // How much longer than the lease a message stays hidden after it is received.
    visibilityMarginSeconds: Math.max(int(env.SQS_VISIBILITY_MARGIN_SECONDS, 5), 1),
  };
}

module.exports = { parseQueueConfig };