const { connect, disconnect } = require('../src/db');
const Job = require('../src/models/Job');
const service = require('../src/services/jobService');
const { STATUS } = require('../src/core/stateMachine');

const JOBS = 100;
const WORKERS = 5;

// The WRONG way: two separate steps (check, then act).
async function claimNaive(workerId) {
  const job = await Job.findOne({ status: STATUS.PENDING });
  if (!job) return null;
  await Job.updateOne(
    { _id: job._id },
    { $set: { status: STATUS.RUNNING, lockedBy: workerId }, $inc: { attempts: 1 } }
  );
  return job;
}

// The RIGHT way: one atomic step.
const claimAtomic = (workerId) => service.claimNext(workerId, 30000);

async function experiment(label, claimFn) {
  await Job.deleteMany({});
  await Job.insertMany(Array.from({ length: JOBS }, (_, i) => ({ type: 'race-test', payload: { i } })));

  const claims = new Map(); // jobId -> how many workers claimed it

  async function worker(id) {
    for (;;) {
      const job = await claimFn(id);
      if (!job) return;
      const key = String(job._id);
      claims.set(key, (claims.get(key) || 0) + 1);
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(`worker-${i + 1}`)));

  const totalClaims = [...claims.values()].reduce((a, b) => a + b, 0);
  const duplicated = [...claims.values()].filter((c) => c > 1).length;
  console.log(`${label}: ${JOBS} jobs, ${WORKERS} workers`);
  console.log(`  total claims: ${totalClaims}  |  jobs claimed more than once: ${duplicated}\n`);
}

(async () => {
  await connect();
  console.log('WARNING: this clears the jobs collection (only your test jobs exist).\n');
  await experiment('NAIVE (find, then update)', claimNaive);
  await experiment('ATOMIC (findOneAndUpdate)', claimAtomic);
  await Job.deleteMany({});
  await disconnect();
})();