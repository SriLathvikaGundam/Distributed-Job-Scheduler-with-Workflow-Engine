// Creates the job queue and its dead-letter queue (DLQ). Safe to run again.
require('dotenv').config();
const { SQSClient, CreateQueueCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');

const region = process.env.AWS_REGION || 'ap-south-1';
const name = process.env.QUEUE_NAME || 'job-scheduler-jobs';
const client = new SQSClient({ region });

(async () => {
  // 1. The dead-letter queue: where messages go after too many failed deliveries.
  const dlq = await client.send(
    new CreateQueueCommand({ QueueName: `${name}-dlq`, Attributes: { MessageRetentionPeriod: '1209600' } }) // keep 14 days
  );
  const dlqAttrs = await client.send(
    new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl, AttributeNames: ['QueueArn'] })
  );

  // 2. The main queue, which sends a message to the DLQ after 5 failed deliveries.
  const main = await client.send(
    new CreateQueueCommand({
      QueueName: name,
      Attributes: {
        VisibilityTimeout: '30', // the worker overrides this on each receive
        ReceiveMessageWaitTimeSeconds: '20', // long polling by default
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqAttrs.Attributes.QueueArn,
          maxReceiveCount: '5',
        }),
      },
    })
  );

  console.log(`Region:      ${region}`);
  console.log(`Dead-letter: ${dlq.QueueUrl}`);
  console.log('\nAdd this line to your .env file:\n');
  console.log(`SQS_QUEUE_URL=${main.QueueUrl}`);
})().catch((err) => {
  if (err.name === 'QueueNameExists') {
    console.error(`A queue named "${name}" already exists with different settings. Delete it in the SQS console, or set QUEUE_NAME to a new name.`);
  } else {
    console.error(`Failed: ${err.name} - ${err.message}`);
  }
  process.exit(1);
});