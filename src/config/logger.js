const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(logLevel, message, meta = {}) {
    if ((LEVELS[logLevel] ?? 999) < threshold) return;
    const payload = {
      time: new Date().toISOString(),
      level: logLevel,
      message,
      ...meta,
    };
    const output = JSON.stringify(payload);
    if (logLevel === 'error') console.error(output);
    else if (logLevel === 'warn') console.warn(output);
    else console.log(output);
  }

  return Object.freeze({
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  });
}
