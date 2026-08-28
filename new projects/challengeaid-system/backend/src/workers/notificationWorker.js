require('dotenv').config();
const { Worker, Queue } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null
});

const QUEUE_NAME = 'approver-reminders';

// Exported so API code can enqueue jobs, e.g. after a request sits
// awaiting one trustee's signature past a threshold (Section 12's
// open question on escalation). Nothing currently calls this — see
// README "Still needed".
const reminderQueue = new Queue(QUEUE_NAME, { connection });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { phone, message } = job.data;

    if (!process.env.SMS_GATEWAY_API_KEY) {
      console.warn(
        `[notificationWorker] SMS_GATEWAY_API_KEY not set — skipping send to ${phone}. ` +
          `Job payload: ${JSON.stringify(job.data)}`
      );
      return { skipped: true, reason: 'no_gateway_configured' };
    }

    // Phase 2: replace with an actual HTTP call to the SMS gateway.
    // Left unimplemented deliberately — no gateway has been chosen
    // yet (see design doc Section 12, open questions).
    throw new Error('SMS gateway integration not yet implemented');
  },
  { connection }
);

worker.on('completed', (job, result) => {
  if (result?.skipped) return;
  console.log(`[notificationWorker] Sent reminder for job ${job.id}`);
});

worker.on('failed', (job, err) => {
  console.error(`[notificationWorker] Job ${job?.id} failed:`, err.message);
});

console.log('Notification worker started, listening on queue:', QUEUE_NAME);

module.exports = { reminderQueue };
