// One shared logger, so every process prints lines the same way: "HH:MM:SS message" (UTC).
const stamp = () => new Date().toISOString().slice(11, 19);

module.exports = {
  info: (message) => console.log(`${stamp()} ${message}`),
  warn: (message) => console.warn(`${stamp()} ${message}`),
  error: (message) => console.error(`${stamp()} ${message}`),
};