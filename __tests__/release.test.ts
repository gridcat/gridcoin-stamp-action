import {
  buildProofManifest,
  parseProofManifestCommit,
  stampedAssetNames,
  stripLeadingV,
} from '../src/release';

describe('stripLeadingV', () => {
  it('strips a leading v', () => {
    expect(stripLeadingV('v1.2.3')).toBe('1.2.3');
  });

  it('leaves tags without a leading v untouched', () => {
    expect(stripLeadingV('1.2.3')).toBe('1.2.3');
    expect(stripLeadingV('release-2026-04-08')).toBe('release-2026-04-08');
  });

  it('does not strip an internal v', () => {
    expect(stripLeadingV('2025-v1')).toBe('2025-v1');
  });
});

describe('stampedAssetNames', () => {
  it('mirrors GitHub native archive naming with a -stamped suffix', () => {
    expect(stampedAssetNames('gridcoin-stamp-action', 'v1.0.1')).toEqual({
      zip: 'gridcoin-stamp-action-1.0.1-stamped.zip',
      tar: 'gridcoin-stamp-action-1.0.1-stamped.tar.gz',
      manifest: 'v1.0.1.stamp.txt',
    });
  });

  it('keeps the original tag in the manifest filename', () => {
    const names = stampedAssetNames('my-repo', 'release-2026-04-08');
    expect(names.manifest).toBe('release-2026-04-08.stamp.txt');
    expect(names.zip).toBe('my-repo-release-2026-04-08-stamped.zip');
  });
});

describe('buildProofManifest', () => {
  it('emits a deterministic four-line manifest with trailing newline', () => {
    const manifest = buildProofManifest(
      'gridcat',
      'gridcoin-stamp-action',
      'v1.0.1',
      '26627c60a459b63c1453fbfab3feda1abda09694',
      '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
    );
    expect(manifest).toBe(
      'repository: gridcat/gridcoin-stamp-action\n' +
        'tag: v1.0.1\n' +
        'commit: 26627c60a459b63c1453fbfab3feda1abda09694\n' +
        'tree: 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b\n',
    );
  });

  it('round-trips the same bytes on repeated calls', () => {
    const args = ['o', 'r', 'v1', 'c'.repeat(40), 't'.repeat(40)] as const;
    expect(buildProofManifest(...args)).toBe(buildProofManifest(...args));
  });
});

describe('parseProofManifestCommit', () => {
  it('extracts the commit SHA from a well-formed manifest', () => {
    const manifest = buildProofManifest(
      'gridcat',
      'gridcoin-stamp-action',
      'v1.0.1',
      '26627c60a459b63c1453fbfab3feda1abda09694',
      '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
    );
    expect(parseProofManifestCommit(manifest)).toBe(
      '26627c60a459b63c1453fbfab3feda1abda09694',
    );
  });

  it('tolerates CRLF line endings (manifest may be downloaded through tools that normalize)', () => {
    const manifest =
      'repository: a/b\r\ntag: v1\r\ncommit: 0123456789abcdef0123456789abcdef01234567\r\ntree: ' +
      'f'.repeat(40) +
      '\r\n';
    expect(parseProofManifestCommit(manifest)).toBe(
      '0123456789abcdef0123456789abcdef01234567',
    );
  });

  it('rejects an uppercase SHA (sha1 canonical form is lowercase hex)', () => {
    const manifest = 'commit: ABCDEF0123456789ABCDEF0123456789ABCDEF01\n';
    expect(parseProofManifestCommit(manifest)).toBeNull();
  });

  it('rejects an abbreviated SHA', () => {
    const manifest = 'commit: abc1234\n';
    expect(parseProofManifestCommit(manifest)).toBeNull();
  });

  it('returns null for completely unrelated content', () => {
    expect(parseProofManifestCommit('totally not a manifest')).toBeNull();
    expect(parseProofManifestCommit('')).toBeNull();
  });

  it('ignores a commit mention that is not at the start of a line', () => {
    const manifest = 'something commit: ' + 'a'.repeat(40) + '\n';
    expect(parseProofManifestCommit(manifest)).toBeNull();
  });

  it('round-trips: build → parse recovers the original commit SHA', () => {
    const commit = 'deadbeefcafebabefeedfacef00dd00db00fb00f';
    const manifest = buildProofManifest('o', 'r', 'v1', commit, 'a'.repeat(40));
    expect(parseProofManifestCommit(manifest)).toBe(commit);
  });
});
