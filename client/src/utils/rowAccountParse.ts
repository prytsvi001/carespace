// client/src/utils/rowAccountParse.ts
// Client-side mirror of the Row Accounts bulk parser (server/src/routes/
// rowAccounts.ts) — used only for the Add modal's live preview and column
// auto-detection. The server re-parses the text itself with the same column
// order, so keep splitColumns in sync with the server copy.

export type RowAccountField = 'login' | 'password' | 'twoFaCode' | 'email' | 'emailPassword';
export type RowAccountColumn = RowAccountField | 'skip';

export const COLUMN_LABELS: Record<RowAccountColumn, string> = {
  login: 'Nickname',
  password: 'Password',
  twoFaCode: '2FA',
  email: 'Email',
  emailPassword: 'Email password',
  skip: '— skip —',
};

export const ORDER_PRESETS: { label: string; order: RowAccountColumn[] }[] = [
  { label: 'With 2FA', order: ['login', 'password', 'twoFaCode', 'email', 'emailPassword'] },
  { label: '2FA last', order: ['login', 'password', 'email', 'emailPassword', 'twoFaCode'] },
  { label: 'Without 2FA', order: ['login', 'password', 'email', 'emailPassword'] },
];

// Same separator priority as the server: tab → colon → 2+ spaces → any space.
export function splitColumns(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((s) => s.trim());
  if (line.includes(':')) return line.split(':').map((s) => s.trim());
  if (/ {2,}/.test(line)) return line.split(/ {2,}/).map((s) => s.trim());
  return line.split(/\s+/).map((s) => s.trim());
}

export function splitLines(text: string): string[][] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map(splitColumns);
}

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
// A TOTP secret (base32, optionally in space-separated groups of 4) or a
// 6-digit one-time code.
const looksLike2fa = (v: string) => {
  const compact = v.replace(/\s+/g, '');
  return /^[A-Z2-7]{16,}=*$/i.test(compact) || /^\d{6}$/.test(compact);
};

// Share of non-empty cells in column `i` that pass `test`.
function columnScore(rows: string[][], i: number, test: (v: string) => boolean): number {
  const cells = rows.map((r) => r[i]).filter(Boolean);
  if (cells.length === 0) return 0;
  return cells.filter(test).length / cells.length;
}

function bestColumn(rows: string[][], count: number, test: (v: string) => boolean, exclude: number[]): number {
  let best = -1;
  let bestScore = 0.6; // at least 60% of the rows must match
  for (let i = 0; i < count; i++) {
    if (exclude.includes(i)) continue;
    const s = columnScore(rows, i, test);
    if (s >= bestScore) { best = i; bestScore = s; }
  }
  return best;
}

// Guesses the column order from the pasted rows. Only email and 2FA can be
// recognised by their content; the rest is inferred: email password is the
// column right after email, nickname and password take the remaining columns
// left to right, anything left over is skipped. Returns null when nothing
// recognisable was found.
export function detectOrder(rows: string[][]): RowAccountColumn[] | null {
  const count = Math.max(0, ...rows.map((r) => r.length));
  if (count < 2) return null;

  const emailCol = bestColumn(rows, count, looksLikeEmail, []);
  const twoFaCol = bestColumn(rows, count, looksLike2fa, emailCol >= 0 ? [emailCol] : []);
  if (emailCol < 0 && twoFaCol < 0) return null;

  const order: (RowAccountColumn | null)[] = Array(count).fill(null);
  if (emailCol >= 0) order[emailCol] = 'email';
  if (twoFaCol >= 0) order[twoFaCol] = 'twoFaCode';
  if (emailCol >= 0 && emailCol + 1 < count && order[emailCol + 1] === null) order[emailCol + 1] = 'emailPassword';

  const rest: RowAccountField[] = ['login', 'password'];
  if (!order.includes('emailPassword')) rest.push('emailPassword');
  for (let i = 0; i < count; i++) {
    if (order[i] === null) order[i] = rest.shift() ?? 'skip';
  }
  return order as RowAccountColumn[];
}

export type ParsedRow = Partial<Record<RowAccountField, string>>;

export function applyOrder(tokens: string[], order: RowAccountColumn[]): ParsedRow {
  const row: ParsedRow = {};
  order.forEach((key, i) => {
    if (key !== 'skip' && tokens[i]) row[key] = tokens[i];
  });
  return row;
}

// Human-readable problems with one parsed row, shown in the preview.
export function rowWarnings(row: ParsedRow): string[] {
  const w: string[] = [];
  if (!row.login || !row.password) w.push('missing nickname or password — will be skipped');
  if (row.email && !looksLikeEmail(row.email)) w.push("email doesn't look like an email");
  (['login', 'password', 'twoFaCode', 'emailPassword'] as const).forEach((k) => {
    if (row[k] && looksLikeEmail(row[k]!)) w.push(`${COLUMN_LABELS[k]} looks like an email`);
  });
  return w;
}

// An order is valid when no field repeats and nickname + password are set.
export function orderError(order: RowAccountColumn[]): string | null {
  const fields = order.filter((k) => k !== 'skip');
  if (new Set(fields).size !== fields.length) return 'Each field can be picked only once.';
  if (!fields.includes('login') || !fields.includes('password')) return 'Nickname and Password columns are required.';
  return null;
}

export const sameOrder = (a: RowAccountColumn[], b: RowAccountColumn[]) =>
  a.length === b.length && a.every((k, i) => k === b[i]);
