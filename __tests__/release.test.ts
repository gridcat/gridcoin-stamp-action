import { vi } from 'vitest';
import {
  buildProofManifest,
  parseProofManifestCommit,
  resolveRelease,
  stampedAssetNames,
  stripLeadingV,
} from '../src/release';
import * as github from '@actions/github';

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

describe('resolveRelease', () => {
  // `github.context` is a getter on a shared singleton; stubbing `context.repo`
  // with `vi.spyOn` keeps the rest of the context object intact and auto-restores
  // between tests via `vi.restoreAllMocks()`.
  const fakeRepo = { owner: 'gridcat', repo: 'gridcoin-stamp-action' };

  beforeEach(() => {
    vi.spyOn(github.context, 'repo', 'get').mockReturnValue(fakeRepo);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Minimal octokit shim: resolveRelease only touches `rest.repos.getReleaseByTag`.
  function makeOctokit(
    getReleaseByTag: ReturnType<typeof vi.fn>,
  ): ReturnType<typeof github.getOctokit> {
    return {
      rest: { repos: { getReleaseByTag } },
    } as unknown as ReturnType<typeof github.getOctokit>;
  }

  it('fetches the release by tag via the GitHub API when a tag is provided', async () => {
    const getReleaseByTag = vi.fn().mockResolvedValue({
      data: { id: 42, tag_name: 'v1.2.3', body: 'release notes' },
    });
    const octokit = makeOctokit(getReleaseByTag);

    const release = await resolveRelease(octokit, 'v1.2.3');

    expect(release).toEqual({ id: 42, tagName: 'v1.2.3', body: 'release notes' });
    expect(getReleaseByTag).toHaveBeenCalledWith({
      owner: 'gridcat',
      repo: 'gridcoin-stamp-action',
      tag: 'v1.2.3',
    });
  });

  it('coerces a missing body to null (API returns null, ReleaseInfo uses null)', async () => {
    const getReleaseByTag = vi.fn().mockResolvedValue({
      data: { id: 7, tag_name: 'v0.1.0', body: null },
    });

    const release = await resolveRelease(makeOctokit(getReleaseByTag), 'v0.1.0');

    expect(release.body).toBeNull();
  });

  it('rewraps a 404 with an actionable message pointing at common causes', async () => {
    const error = Object.assign(new Error('Not Found'), { status: 404 });
    const getReleaseByTag = vi.fn().mockRejectedValue(error);

    await expect(
      resolveRelease(makeOctokit(getReleaseByTag), 'v9.9.9'),
    ).rejects.toThrow(/No GitHub release found for tag 'v9\.9\.9'/);
  });

  it('passes through non-404 errors unchanged (bubble up auth/5xx as-is)', async () => {
    const error = Object.assign(new Error('Bad credentials'), { status: 401 });
    const getReleaseByTag = vi.fn().mockRejectedValue(error);

    await expect(
      resolveRelease(makeOctokit(getReleaseByTag), 'v1.0.0'),
    ).rejects.toThrow('Bad credentials');
  });

  it('falls back to event payload when no tag is provided', async () => {
    vi.spyOn(github.context, 'payload', 'get').mockReturnValue({
      release: { id: 99, tag_name: 'v2.0.0', body: 'from payload' },
    });
    // octokit should never be touched on the payload path.
    const getReleaseByTag = vi.fn();
    const octokit = makeOctokit(getReleaseByTag);

    const release = await resolveRelease(octokit, '');

    expect(release).toEqual({ id: 99, tagName: 'v2.0.0', body: 'from payload' });
    expect(getReleaseByTag).not.toHaveBeenCalled();
  });

  it('throws the updated payload-missing error when neither tag nor release event is present', async () => {
    vi.spyOn(github.context, 'payload', 'get').mockReturnValue({});

    await expect(
      resolveRelease(makeOctokit(vi.fn()), ''),
    ).rejects.toThrow(/pass the `tag:` input/);
  });
});
