import { sha256Buffer } from '../src/hasher';

describe('sha256Buffer', () => {
  it('matches the known SHA-256 of "hello world"', () => {
    expect(sha256Buffer(Buffer.from('hello world'))).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  it('matches the known SHA-256 of the empty buffer', () => {
    expect(sha256Buffer(Buffer.alloc(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('returns 64-character lowercase hex', () => {
    expect(sha256Buffer(Buffer.from([0x00, 0xff, 0x42]))).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic — same input always yields the same output', () => {
    const data = Buffer.from('deterministic');
    expect(sha256Buffer(data)).toBe(sha256Buffer(data));
  });
});
