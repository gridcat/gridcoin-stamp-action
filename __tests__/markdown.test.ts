import { generateStampsMarkdown, updateReleaseBody } from '../src/markdown';
import { StampResult } from '../src/types';

describe('generateStampsMarkdown', () => {
  it('generates a markdown table from stamp results', () => {
    const stamps: StampResult[] = [
      {
        filename: 'v1.0.0-source.zip',
        hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',

        proofUrl: 'https://stamp.gridcoin.club/proof/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        status: 'submitted',
      },
    ];

    const md = generateStampsMarkdown(stamps);
    expect(md).toContain('### Blockchain Timestamps (Gridcoin)');
    expect(md).toContain('v1.0.0-source.zip');
    expect(md).toContain(
      '`abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789`',
    );
    expect(md).not.toContain('...');
    expect(md).toContain('[Verify]');
    expect(md).toContain('submitted');
  });

  it('renders the full 64-character hash so users can sha256sum-compare directly', () => {
    const hash = '0123456789abcdef'.repeat(4);
    const stamps: StampResult[] = [
      {
        filename: 'example-1.0.0-stamped.zip',
        hash,
        proofUrl: `https://stamp.gridcoin.club/proof/${hash}`,
        status: 'submitted',
      },
    ];

    const md = generateStampsMarkdown(stamps);
    expect(md).toContain(`\`${hash}\``);
    expect(hash).toHaveLength(64);
  });

  it('includes multiple rows', () => {
    const stamps: StampResult[] = [
      {
        filename: 'file1.zip',
        hash: 'a'.repeat(64),

        proofUrl: 'https://example.com/proof/' + 'a'.repeat(64),
        status: 'confirmed',
      },
      {
        filename: 'file2.tar.gz',
        hash: 'b'.repeat(64),

        proofUrl: 'https://example.com/proof/' + 'b'.repeat(64),
        status: 'pending',
      },
    ];

    const md = generateStampsMarkdown(stamps);
    expect(md).toContain('file1.zip');
    expect(md).toContain('file2.tar.gz');
    expect(md).toContain('confirmed');
    expect(md).toContain('pending');
  });
});

describe('updateReleaseBody', () => {
  const stampsSection =
    '\n---\n### Blockchain Timestamps (Gridcoin)\n| File | SHA-256 | Proof | Status |\n|------|---------|-------|--------|\n| f.zip | `abc...xyz` | [Verify](url) | submitted |\n';

  it('appends to empty body', () => {
    const result = updateReleaseBody(null, stampsSection);
    expect(result).toBe(stampsSection);
  });

  it('appends to existing body', () => {
    const result = updateReleaseBody('Release notes here.', stampsSection);
    expect(result).toBe('Release notes here.' + stampsSection);
  });

  it('replaces existing stamps section', () => {
    const existingBody =
      'Release notes.\n---\n### Blockchain Timestamps (Gridcoin)\n| old stuff |\n';
    const result = updateReleaseBody(existingBody, stampsSection);
    expect(result).toBe('Release notes.' + stampsSection);
    expect(result).not.toContain('old stuff');
  });

  it('replaces a realistic stamps section produced by generateStampsMarkdown (full rerun)', () => {
    // Simulates a real rerun: the first run emitted a 3-row table and
    // we're now replacing it with a 1-row table. The replacement must
    // drop every previous row and insert the new section verbatim.
    const firstRunStamps: StampResult[] = [
      { filename: 'a.zip', hash: 'a'.repeat(64), proofUrl: 'https://x/proof/a', status: 'submitted' },
      { filename: 'b.tar.gz', hash: 'b'.repeat(64), proofUrl: 'https://x/proof/b', status: 'submitted' },
      { filename: 'c.stamp.txt', hash: 'c'.repeat(64), proofUrl: 'https://x/proof/c', status: 'submitted' },
    ];
    const firstRunSection = generateStampsMarkdown(firstRunStamps);
    const releaseBody = `## v1.0.0\n\nChangelog here.${firstRunSection}`;

    const secondRunStamps: StampResult[] = [
      { filename: 'only.zip', hash: 'd'.repeat(64), proofUrl: 'https://x/proof/d', status: 'confirmed' },
    ];
    const secondRunSection = generateStampsMarkdown(secondRunStamps);

    const result = updateReleaseBody(releaseBody, secondRunSection);

    expect(result).toBe(`## v1.0.0\n\nChangelog here.${secondRunSection}`);
    // None of the old rows survive.
    expect(result).not.toContain('a.zip');
    expect(result).not.toContain('b.tar.gz');
    expect(result).not.toContain('c.stamp.txt');
    expect(result).toContain('only.zip');
    // Only one timestamps section after replacement.
    const occurrences = result.split('### Blockchain Timestamps (Gridcoin)').length - 1;
    expect(occurrences).toBe(1);
  });

  it('stops replacement at the next `---` boundary and preserves following sections', () => {
    // Covers the regex's `(?=\n---\n|$)` lookahead: the timestamps
    // section must end where the next `---` rule begins, so any user
    // content under a later heading is left alone.
    const trailingSection =
      '\n---\n### Notes\n\nThanks to all contributors.\n';
    const releaseBody =
      'Release notes.\n---\n### Blockchain Timestamps (Gridcoin)\n| old stuff |\n' +
      trailingSection;

    const result = updateReleaseBody(releaseBody, stampsSection);

    // The trailing `### Notes` section is preserved verbatim.
    expect(result).toContain(trailingSection);
    expect(result).toContain('Thanks to all contributors.');
    // The timestamps section was replaced.
    expect(result).not.toContain('old stuff');
    expect(result).toContain('| f.zip | `abc...xyz` | [Verify](url) | submitted |');
    // The prelude survived too.
    expect(result.startsWith('Release notes.')).toBe(true);
  });
});
