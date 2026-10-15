const {
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} = require('@aws-sdk/client-sqs');
const SqsQueue = require('../src/queue/sqsQueue');

const URL = 'https://sqs.ap-south-1.amazonaws.com/123/job-scheduler-jobs';
const makeQueue = (send) => {
  const client = { send: jest.fn(send) };
  return { client, queue: new SqsQueue({ queueUrl: URL, client }) };
};

test('requires a queue url', () => {
  expect(() => new SqsQueue({})).toThrow(/queueUrl/);
});

describe('send', () => {
  test('sends all ids in ONE batch request, carrying only the job id', async () => {
    const { client, queue } = makeQueue(async () => ({ Successful: [] }));
    const result = await queue.send(['a1', 'b2']);

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(SendMessageBatchCommand);
    expect(cmd.input.QueueUrl).toBe(URL);
    expect(cmd.input.Entries).toEqual([
      { Id: '0', MessageBody: '{"jobId":"a1"}' },
      { Id: '1', MessageBody: '{"jobId":"b2"}' },
    ]);
    expect(result).toEqual({ failed: [] });
  });

  test('reports which ids SQS rejected', async () => {
    const { queue } = makeQueue(async () => ({ Failed: [{ Id: '1' }] }));
    await expect(queue.send(['a1', 'b2', 'c3'])).resolves.toEqual({ failed: ['b2'] });
  });

  test('does nothing for an empty list', async () => {
    const { client, queue } = makeQueue(async () => ({}));
    await expect(queue.send([])).resolves.toEqual({ failed: [] });
    expect(client.send).not.toHaveBeenCalled();
  });

  test('refuses more than 10 messages (the SQS batch limit)', async () => {
    const { queue } = makeQueue(async () => ({}));
    await expect(queue.send(Array.from({ length: 11 }, (_, i) => `j${i}`))).rejects.toThrow(/at most 10/);
  });

  test('lets errors through so the dispatcher can undo its marks', async () => {
    const { queue } = makeQueue(async () => { throw new Error('AccessDenied'); });
    await expect(queue.send(['a1'])).rejects.toThrow('AccessDenied');
  });
});

describe('receive', () => {
  test('long-polls with the given limits and parses job ids', async () => {
    const { client, queue } = makeQueue(async () => ({
      Messages: [
        { MessageId: 'm1', ReceiptHandle: 'r1', Body: '{"jobId":"j1"}' },
        { MessageId: 'm2', ReceiptHandle: 'r2', Body: 'not json' },
      ],
    }));
    const signal = new AbortController().signal;
    const messages = await queue.receive({ max: 25, waitSeconds: 20, visibilitySeconds: 35, signal });

    const [cmd, opts] = client.send.mock.calls[0];
    expect(cmd).toBeInstanceOf(ReceiveMessageCommand);
    expect(cmd.input).toMatchObject({ QueueUrl: URL, MaxNumberOfMessages: 10, WaitTimeSeconds: 20, VisibilityTimeout: 35 });
    expect(opts.abortSignal).toBe(signal);
    expect(messages).toEqual([
      { messageId: 'm1', receiptHandle: 'r1', jobId: 'j1' },
      { messageId: 'm2', receiptHandle: 'r2', jobId: null }, // malformed bodies are flagged, not thrown
    ]);
  });

  test('returns [] when there are no messages', async () => {
    const { queue } = makeQueue(async () => ({}));
    await expect(queue.receive({ visibilitySeconds: 30 })).resolves.toEqual([]);
  });

  test('returns [] when the wait is aborted', async () => {
    const { queue } = makeQueue(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
    await expect(queue.receive({ visibilitySeconds: 30 })).resolves.toEqual([]);
  });

  test('real errors are not swallowed', async () => {
    const { queue } = makeQueue(async () => { throw new Error('ExpiredToken'); });
    await expect(queue.receive({ visibilitySeconds: 30 })).rejects.toThrow('ExpiredToken');
  });
});

test('remove deletes by receipt handle', async () => {
  const { client, queue } = makeQueue(async () => ({}));
  await queue.remove('r1');
  const cmd = client.send.mock.calls[0][0];
  expect(cmd).toBeInstanceOf(DeleteMessageCommand);
  expect(cmd.input).toEqual({ QueueUrl: URL, ReceiptHandle: 'r1' });
});