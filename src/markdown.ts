import { StampResult } from './types';

const SECTION_HEADER = '### Blockchain Timestamps (Gridcoin)';

/**
 * Matches an existing timestamps section so we can replace it on rerun.
 * Boundary is the next `\n---\n` (or end-of-body), so this coexists safely
 * with other `---`-delimited sections in the user's release notes.
 */
const SECTION_REGEX = new RegExp(
  `\\n---\\n${escapeRegex(SECTION_HEADER)}[\\s\\S]*?(?=\\n---\\n|$)`,
);

/**
 * Renders the "Blockchain Timestamps" markdown table appended to the
 * release body. The SHA-256 column shows the full 64-character hash so
 * users can `sha256sum <file>` and string-compare against the row directly,
 * without clicking through to the proof page.
 */
export function generateStampsMarkdown(stamps: StampResult[]): string {
  const rows = stamps.map(
    (s) => `| ${s.filename} | \`${s.hash}\` | [Verify](${s.proofUrl}) | ${s.status} |`,
  );

  return [
    '',
    '---',
    SECTION_HEADER,
    '| File | SHA-256 | Proof | Status |',
    '|------|---------|-------|--------|',
    ...rows,
    '',
  ].join('\n');
}

/**
 * Inserts or replaces the timestamps section in an existing release body.
 * First-time runs (no existing section) fall through to a plain append.
 */
export function updateReleaseBody(existingBody: string | null, stampsMarkdown: string): string {
  const body = existingBody ?? '';

  if (SECTION_REGEX.test(body)) {
    return body.replace(SECTION_REGEX, stampsMarkdown);
  }

  return body + stampsMarkdown;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
