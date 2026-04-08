import { StampResult } from './types';

const SECTION_HEADER = '### Blockchain Timestamps (Gridcoin)';

export function generateStampsMarkdown(stamps: StampResult[]): string {
  const rows = stamps.map((s) => {
    const shortHash = `${s.hash.substring(0, 8)}...${s.hash.substring(56)}`;
    return `| ${s.filename} | \`${shortHash}\` | [Verify](${s.proofUrl}) | ${s.status} |`;
  });

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

export function updateReleaseBody(existingBody: string | null, stampsMarkdown: string): string {
  const body = existingBody ?? '';
  const sectionRegex = new RegExp(
    `\\n---\\n${escapeRegex(SECTION_HEADER)}[\\s\\S]*?(?=\\n---\\n|$)`,
  );

  if (sectionRegex.test(body)) {
    return body.replace(sectionRegex, stampsMarkdown);
  }

  return body + stampsMarkdown;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
