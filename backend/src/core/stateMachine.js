const STATUS = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
  CANCELLED: 'CANCELLED',
});

const TRANSITIONS = Object.freeze({
  [STATUS.PENDING]: [STATUS.RUNNING, STATUS.CANCELLED],
  [STATUS.RUNNING]: [STATUS.SUCCESS, STATUS.FAILED, STATUS.RETRYING, STATUS.RUNNING],
  [STATUS.RETRYING]: [STATUS.RUNNING, STATUS.CANCELLED],
  [STATUS.FAILED]: [STATUS.PENDING],
  [STATUS.SUCCESS]: [],
  [STATUS.CANCELLED]: [],
});
function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal job transition: ${from} -> ${to}`);
  }
}
const TERMINAL = new Set([STATUS.SUCCESS, STATUS.CANCELLED]);

function isTerminal(status) {
  return TERMINAL.has(status);
}

module.exports = { STATUS, TRANSITIONS, canTransition, assertTransition, isTerminal };