const { parseQueueConfig } = require('../src/core/queueConfig');

describe('parseQueueConfig', () => {
  test('defaults to mongo mode and needs no AWS settings', () => {
    const cfg = parseQueueConfig({});
    expect(cfg.mode).toBe('mongo');
    expect(cfg.url).toBeNull();
    expect(cfg.region).toBe('ap-south-1');
    expect(cfg.waitSeconds).toBe(20);
  });

  test('accepts sqs mode with a queue url', () => {
    const cfg = parseQueueConfig({ QUEUE_MODE: ' SQS ', SQS_QUEUE_URL: 'https://sqs/q', AWS_REGION: 'us-east-1' });
    expect(cfg).toMatchObject({ mode: 'sqs', url: 'https://sqs/q', region: 'us-east-1' });
  });

  test('sqs mode without a queue url is an error', () => {
    expect(() => parseQueueConfig({ QUEUE_MODE: 'sqs' })).toThrow(/SQS_QUEUE_URL/);
  });

  test('an unknown mode is an error', () => {
    expect(() => parseQueueConfig({ QUEUE_MODE: 'kafka' })).toThrow(/QUEUE_MODE/);
  });

  test('long polling is clamped to the 0-20 second range SQS allows', () => {
    expect(parseQueueConfig({ SQS_WAIT_SECONDS: '99' }).waitSeconds).toBe(20);
    expect(parseQueueConfig({ SQS_WAIT_SECONDS: '-5' }).waitSeconds).toBe(0);
    expect(parseQueueConfig({ SQS_WAIT_SECONDS: 'abc' }).waitSeconds).toBe(20);
  });
});