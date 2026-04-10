/**
 * Tests for the "fishy" edge cases in the orchestration layer:
 *
 *   - `assertTagNotMutated`: every branch of the preflight tag-mutation
 *     safeguard. This is the check that keeps a force-pushed tag from
 *     silently corrupting a release, so every branch matters.
 *
 *   - `resolveArtifactBytes`: the idempotency path that distinguishes
 *     "asset already exists on the release, reuse its bytes" from
 *     "asset is missing, produce and upload", plus the cache lookup that
 *     avoids re-downloading the manifest after the preflight fetched it.
 *
 * The network-facing helpers from `./release` are partial-mocked so the
 * pure helpers (`parseProofManifestCommit`, `buildProofManifest`,
 * `stampedAssetNames`) stay real while the HTTP-backed ones are fully
 * controllable from each test.
 */
import { vi, type MockedFunction } from 'vitest';
import { Artifact, assertTagNotMutated, resolveArtifactBytes } from '../src/flow';
import type { ReleaseAssetRef } from '../src/release';

vi.mock('../src/release', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/release')>();
  return {
    ...actual,
    downloadAssetBytes: vi.fn(),
    getCommitInfo: vi.fn(),
    uploadReleaseAsset: vi.fn(),
  };
});

// Silence @actions/core's stdout chatter so test output stays readable.
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  getInput: vi.fn(),
  getBooleanInput: vi.fn(),
}));

// Imported after vi.mock so these bindings are the mocked functions.
import {
  downloadAssetBytes,
  getCommitInfo,
  uploadReleaseAsset,
  buildProofManifest,
} from '../src/release';

const mockedDownload = downloadAssetBytes as MockedFunction<typeof downloadAssetBytes>;
const mockedGetCommit = getCommitInfo as MockedFunction<typeof getCommitInfo>;
const mockedUpload = uploadReleaseAsset as MockedFunction<typeof uploadReleaseAsset>;

// Octokit is only forwarded to mocked functions, never touched directly.
const fakeOctokit = {} as never;

const COMMIT_A = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const COMMIT_B = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
const TREE_SHA = 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3';
const MANIFEST_NAME = 'v1.0.1.stamp.txt';
const MANIFEST_REF: ReleaseAssetRef = { id: 42, name: MANIFEST_NAME };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertTagNotMutated', () => {
  it('returns null and makes no network calls when no prior manifest exists', async () => {
    await expect(
      assertTagNotMutated(fakeOctokit, 'v1.0.1', undefined),
    ).resolves.toBeNull();

    // First runs must not eat API quota for a preflight with nothing to
    // check against.
    expect(mockedDownload).not.toHaveBeenCalled();
    expect(mockedGetCommit).not.toHaveBeenCalled();
  });

  it('returns the manifest bytes when the pinned commit still matches', async () => {
    const manifest = buildProofManifest('gridcat', 'repo', 'v1.0.1', COMMIT_A, TREE_SHA);
    const manifestBytes = Buffer.from(manifest, 'utf-8');
    mockedDownload.mockResolvedValueOnce(manifestBytes);
    mockedGetCommit.mockResolvedValueOnce({ commit: COMMIT_A, tree: TREE_SHA });

    const result = await assertTagNotMutated(fakeOctokit, 'v1.0.1', MANIFEST_REF);

    // Returning the bytes lets the caller seed a cache and skip the
    // re-download during the artifact-reuse path.
    expect(result).toEqual(manifestBytes);
    expect(mockedDownload).toHaveBeenCalledWith(fakeOctokit, 42);
    expect(mockedGetCommit).toHaveBeenCalledWith(fakeOctokit, 'v1.0.1');
  });

  it('throws a tag-mutation error when the commit has moved', async () => {
    const manifest = buildProofManifest('gridcat', 'repo', 'v1.0.1', COMMIT_A, TREE_SHA);
    mockedDownload.mockResolvedValueOnce(Buffer.from(manifest, 'utf-8'));
    mockedGetCommit.mockResolvedValueOnce({ commit: COMMIT_B, tree: TREE_SHA });

    await expect(
      assertTagNotMutated(fakeOctokit, 'v1.0.1', MANIFEST_REF),
    ).rejects.toThrow(/Tag mutation detected/);
  });

  it('error message on tag mutation mentions both commits and remediation steps', async () => {
    mockedDownload.mockResolvedValue(
      Buffer.from(buildProofManifest('o', 'r', 'v1.0.1', COMMIT_A, TREE_SHA), 'utf-8'),
    );
    mockedGetCommit.mockResolvedValue({ commit: COMMIT_B, tree: TREE_SHA });

    const err = await assertTagNotMutated(fakeOctokit, 'v1.0.1', MANIFEST_REF).catch(
      (e: Error) => e,
    );

    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain(COMMIT_A);
    expect(msg).toContain(COMMIT_B);
    expect(msg).toContain("'v1.0.1'");
    expect(msg).toMatch(/reset|delete/i);
  });

  it('throws a malformed-manifest error when the commit line cannot be parsed', async () => {
    mockedDownload.mockResolvedValueOnce(Buffer.from('this is not a valid manifest\n', 'utf-8'));

    await expect(
      assertTagNotMutated(fakeOctokit, 'v1.0.1', MANIFEST_REF),
    ).rejects.toThrow(/malformed or uses an unknown format/);

    // Malformed manifest short-circuits before fetching the current
    // commit — there's nothing to compare against, so the user needs to
    // clean up the bad asset before we can proceed.
    expect(mockedGetCommit).not.toHaveBeenCalled();
  });

  it('accepts a manifest whose contents happen to have CRLF line endings', async () => {
    const crlfManifest =
      `repository: o/r\r\ntag: v1.0.1\r\ncommit: ${COMMIT_A}\r\ntree: ${TREE_SHA}\r\n`;
    const manifestBytes = Buffer.from(crlfManifest, 'utf-8');
    mockedDownload.mockResolvedValueOnce(manifestBytes);
    mockedGetCommit.mockResolvedValueOnce({ commit: COMMIT_A, tree: TREE_SHA });

    await expect(
      assertTagNotMutated(fakeOctokit, 'v1.0.1', MANIFEST_REF),
    ).resolves.toEqual(manifestBytes);
  });
});

describe('resolveArtifactBytes', () => {
  const makeArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
    name: 'example-1.0.1-stamped.zip',
    contentType: 'application/zip',
    produce: vi.fn().mockResolvedValue(Buffer.from('fresh-bytes')),
    ...overrides,
  });

  it('produces and uploads on first run when the asset is absent', async () => {
    const artifact = makeArtifact();
    const existingByName = new Map<string, ReleaseAssetRef>();
    const bytesCache = new Map<string, Buffer>();

    const bytes = await resolveArtifactBytes(
      fakeOctokit,
      999,
      artifact,
      existingByName,
      bytesCache,
    );

    expect(bytes).toEqual(Buffer.from('fresh-bytes'));
    expect(artifact.produce).toHaveBeenCalledTimes(1);
    expect(mockedUpload).toHaveBeenCalledWith(
      fakeOctokit,
      999,
      'example-1.0.1-stamped.zip',
      'application/zip',
      Buffer.from('fresh-bytes'),
    );
    expect(mockedDownload).not.toHaveBeenCalled();
  });

  it('reuses the existing upload on a rerun and skips produce() entirely', async () => {
    const produceSpy = vi.fn();
    const artifact = makeArtifact({ produce: produceSpy });
    const existingByName = new Map<string, ReleaseAssetRef>([
      [artifact.name, { id: 777, name: artifact.name }],
    ]);
    const bytesCache = new Map<string, Buffer>();
    mockedDownload.mockResolvedValueOnce(Buffer.from('already-on-release'));

    const bytes = await resolveArtifactBytes(
      fakeOctokit,
      999,
      artifact,
      existingByName,
      bytesCache,
    );

    expect(bytes).toEqual(Buffer.from('already-on-release'));
    expect(mockedDownload).toHaveBeenCalledWith(fakeOctokit, 777);
    // Core idempotency invariant: produce() MUST NOT fire when the asset
    // already exists, otherwise we'd regenerate from unstable sources
    // and break verification.
    expect(produceSpy).not.toHaveBeenCalled();
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('returns cached bytes without any network activity when the artifact is pre-cached', async () => {
    const produceSpy = vi.fn();
    const artifact = makeArtifact({ produce: produceSpy });
    const existingByName = new Map<string, ReleaseAssetRef>([
      [artifact.name, { id: 777, name: artifact.name }],
    ]);
    const cachedBytes = Buffer.from('cached-from-preflight');
    const bytesCache = new Map<string, Buffer>([[artifact.name, cachedBytes]]);

    const bytes = await resolveArtifactBytes(
      fakeOctokit,
      999,
      artifact,
      existingByName,
      bytesCache,
    );

    expect(bytes).toBe(cachedBytes);
    // The cache path must take precedence over both the reuse-download
    // path and the produce-and-upload path.
    expect(mockedDownload).not.toHaveBeenCalled();
    expect(produceSpy).not.toHaveBeenCalled();
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('propagates produce() errors so callers can surface per-artifact failures', async () => {
    const artifact = makeArtifact({
      produce: vi.fn().mockRejectedValue(new Error('network blew up')),
    });
    const existingByName = new Map<string, ReleaseAssetRef>();
    const bytesCache = new Map<string, Buffer>();

    await expect(
      resolveArtifactBytes(fakeOctokit, 999, artifact, existingByName, bytesCache),
    ).rejects.toThrow('network blew up');

    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('propagates upload errors (e.g. 403 permission denied) without swallowing them', async () => {
    const artifact = makeArtifact();
    const existingByName = new Map<string, ReleaseAssetRef>();
    const bytesCache = new Map<string, Buffer>();
    mockedUpload.mockRejectedValueOnce(
      new Error(
        "Upload of 'x' failed with 403 Forbidden. The workflow's GITHUB_TOKEN needs 'contents: write' permission.",
      ),
    );

    await expect(
      resolveArtifactBytes(fakeOctokit, 999, artifact, existingByName, bytesCache),
    ).rejects.toThrow(/403 Forbidden/);
  });
});
