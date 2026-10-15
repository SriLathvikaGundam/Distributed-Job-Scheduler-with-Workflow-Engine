// Checks that your credentials, region and queue url work, and shows the queue's state.
require('dotenv').config();
const { SQSClient, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');
const { parseQueueConfig } = require('../src/core/queueConfig');

(async () => {
  const cfg = parseQueueConfig({ ...process.env, QUEUE_MODE: 'sqs' });
  const client = new SQSClient({ region: cfg.region });
  const { Attributes: a } = await client.send(
    new GetQueueAttributesCommand({ QueueUrl: cfg.url, AttributeNames: ['All'] })
  );

  console.log(`Connected to ${cfg.url}`);
  console.log(`  messages waiting:   ${a.ApproximateNumberOfMessages}`);
  console.log(`  messages in flight: ${a.ApproximateNumberOfMessagesNotVisible}`);
  console.log(`  visibility timeout: ${a.VisibilityTimeout}s`);
  console.log(`  long polling:       ${a.ReceiveMessageWaitTimeSeconds}s`);
  console.log(`  dead-letter queue:  ${a.RedrivePolicy ? 'configured' : 'NOT configured'}`);
})().catch((err) => {
  console.error(`Could not reach the queue: ${err.name} - ${err.message}`);
  process.exit(1);
});