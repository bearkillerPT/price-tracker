// Plain one-line logs; journald (or the terminal) adds the timestamp.
type Fields = Record<string, unknown>;

function line(level: string, msg: string, fields?: Fields): string {
  const extra = fields
    ? ' ' +
      Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v instanceof Error ? JSON.stringify(v.message) : JSON.stringify(v)}`)
        .join(' ')
    : '';
  return `${level} ${msg}${extra}`;
}

export const log = {
  info: (msg: string, fields?: Fields) => console.log(line('INFO', msg, fields)),
  warn: (msg: string, fields?: Fields) => console.warn(line('WARN', msg, fields)),
  error: (msg: string, fields?: Fields) => console.error(line('ERROR', msg, fields)),
};
