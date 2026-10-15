const {
  SQSClient,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} = require('@aws-sdk/client-sqs');

// A thin wrapper around SQS. A message carries only a job id: the job itself stays in MongoDB,
// which remains the single source of truth.
class SqsQueue {
  constructor({ queueUrl, region, client }) {
    if (!queueUrl) throw new Error('queueUrl is required');
    this.queueUrl = queueUrl;
    this.client = client || new SQSClient({ region });
  }

  // Send up to 10 job ids in ONE request. Returns { failed }: the ids SQS did not accept.
  async send(jobIds) {
    if (jobIds.length === 0) return { failed: [] };
    if (jobIds.length > 10) throw new Error('SQS accepts at most 10 messages per batch');

    const res = await this.client.send(
      new SendMessageBatchCommand({
        QueueUrl: this.queueUrl,
        Entries: jobIds.map((id, i) => ({ Id: String(i), MessageBody: JSON.stringify({ jobId: String(id) }) })),
      })
    );
    return { failed: (res.Failed || []).map((f) => jobIds[Number(f.Id)]) };
  }

  // Long-poll for up to `max` messages. Returns [] on timeout or when `signal` is aborted.
  async receive({ max = 10, waitSeconds = 20, visibilitySeconds, signal } = {}) {
    let res;
    try {
      res = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: Math.min(Math.max(max, 1), 10),
          WaitTimeSeconds: waitSeconds,
          ...(visibilitySeconds && { VisibilityTimeout: visibilitySeconds }),
        }),
        { abortSignal: signal }
      );
    } catch (err) {
      if (err && err.name === 'AbortError') return []; // we were told to stop waiting
      throw err;
    }

    return (res.Messages || []).map((m) => ({
      messageId: m.MessageId,
      receiptHandle: m.ReceiptHandle,
      jobId: parseJobId(m.Body),
    }));
  }

  // Delete a message once its job's outcome has been recorded.
  async remove(receiptHandle) {
    await this.client.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }));
  }
}

function parseJobId(body) {
  try {
    const { jobId } = JSON.parse(body);
    return typeof jobId === 'string' && jobId ? jobId : null;
  } catch {
    return null; // not our message format
  }
}

module.exports = SqsQueue;