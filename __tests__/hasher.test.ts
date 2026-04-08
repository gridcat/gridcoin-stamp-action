import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeSha256 } from '../src/hasher';

describe('computeSha256', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hasher-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('computes correct SHA-256 for a known string', async () => {
    const filePath = join(tempDir, 'test.txt');
    await writeFile(filePath, 'hello world');
    const hash = await computeSha256(filePath);
    // SHA-256 of "hello world"
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('computes correct SHA-256 for empty file', async () => {
    const filePath = join(tempDir, 'empty.txt');
    await writeFile(filePath, '');
    const hash = await computeSha256(filePath);
    // SHA-256 of empty string
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('returns 64-character lowercase hex string', async () => {
    const filePath = join(tempDir, 'data.bin');
    await writeFile(filePath, Buffer.from([0x00, 0xff, 0x42]));
    const hash = await computeSha256(filePath);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects for non-existent file', async () => {
    await expect(computeSha256(join(tempDir, 'nope.txt'))).rejects.toThrow();
  });
});
