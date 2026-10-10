// Pure logic for workflows (directed acyclic graphs of steps). No database code here.

const NAME_RE = /^[A-Za-z0-9_-]{1,50}$/;
const MAX_STEPS = 20;

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// Kahn's algorithm: repeatedly take steps with no unfinished dependencies.
// If some steps can never be taken, they are part of (or stuck behind) a cycle.
function topologicalOrder(steps) {
  const indegree = new Map(steps.map((s) => [s.name, (s.dependsOn || []).length]));
  const dependents = new Map(steps.map((s) => [s.name, []]));
  for (const s of steps) {
    for (const dep of s.dependsOn || []) dependents.get(dep).push(s.name);
  }

  const queue = [...indegree].filter(([, n]) => n === 0).map(([name]) => name);
  const order = [];
  while (queue.length) {
    const name = queue.shift();
    order.push(name);
    for (const next of dependents.get(name)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }

  if (order.length === steps.length) return { ok: true, order };
  return { ok: false, stuck: [...indegree].filter(([, n]) => n > 0).map(([name]) => name) };
}

// Returns { error } for a bad workflow, or { order } (a valid run order) for a good one.
function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return { error: '"steps" must be a non-empty array' };
  if (steps.length > MAX_STEPS) return { error: `a workflow can have at most ${MAX_STEPS} steps` };

  const names = new Set();
  for (const [i, s] of steps.entries()) {
    const where = `step ${i + 1}`;
    if (!isPlainObject(s)) return { error: `${where} must be an object` };
    if (typeof s.name !== 'string' || !NAME_RE.test(s.name)) {
      return { error: `${where}: "name" must be 1 to 50 letters, digits, "-" or "_"` };
    }
    if (names.has(s.name)) return { error: `duplicate step name "${s.name}"` };
    names.add(s.name);

    if (typeof s.type !== 'string' || !s.type.trim()) return { error: `step "${s.name}": "type" is required` };
    if (s.payload !== undefined && !isPlainObject(s.payload)) {
      return { error: `step "${s.name}": "payload" must be an object` };
    }
    if (s.maxAttempts !== undefined && !(Number.isInteger(s.maxAttempts) && s.maxAttempts >= 1 && s.maxAttempts <= 10)) {
      return { error: `step "${s.name}": "maxAttempts" must be an integer from 1 to 10` };
    }
    if (s.dependsOn !== undefined && !Array.isArray(s.dependsOn)) {
      return { error: `step "${s.name}": "dependsOn" must be an array of step names` };
    }
  }

  for (const s of steps) {
    const deps = s.dependsOn || [];
    if (new Set(deps).size !== deps.length) return { error: `step "${s.name}" lists the same dependency twice` };
    for (const dep of deps) {
      if (typeof dep !== 'string' || !names.has(dep)) return { error: `step "${s.name}" depends on unknown step "${dep}"` };
      if (dep === s.name) return { error: `step "${s.name}" cannot depend on itself` };
    }
  }

  const result = topologicalOrder(steps);
  if (!result.ok) return { error: `dependency cycle detected (steps that can never run: ${result.stuck.join(', ')})` };
  return { order: result.order };
}

// The overall state of a workflow, worked out from the statuses of its steps.
function workflowStatus(statuses) {
  if (statuses.length === 0) return 'PENDING';
  const active = ['PENDING', 'BLOCKED', 'RUNNING', 'RETRYING'];
  if (statuses.some((s) => active.includes(s))) return 'RUNNING'; // still in progress
  if (statuses.includes('FAILED')) return 'FAILED';
  if (statuses.includes('CANCELLED')) return 'CANCELLED';
  return 'SUCCESS';
}

module.exports = { validateSteps, topologicalOrder, workflowStatus, MAX_STEPS };