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
    expect(md).toContain('`abcdef01...23456789`');
    expect(md).toContain('[Verify]');
    expect(md).toContain('submitted');
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
});
