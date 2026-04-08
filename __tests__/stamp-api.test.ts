import { StampApiClient } from '../src/stamp-api';

const mockStampResponse = {
  data: {
    id: '42',
    type: 'stamps',
    attributes: {
      protocol: '0.0.1',
      type: 'sha256',
      hash: 'a'.repeat(64),
      block: null,
      tx: null,
      rawTransaction: null,
      time: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    links: { self: '/stamps/42' },
  },
};

describe('StampApiClient', () => {
  let client: StampApiClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new StampApiClient('https://stamp.gridcoin.club/api');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('submitHash', () => {
    it('sends correct JSON:API request and returns response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve(mockStampResponse),
      });

      const hash = 'a'.repeat(64);
      const result = await client.submitHash(hash);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://stamp.gridcoin.club/api/stamps',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/vnd.api+json',
            Accept: 'application/vnd.api+json',
          },
          body: JSON.stringify({
            data: {
              type: 'stamps',
              attributes: { hash },
            },
          }),
        }),
      );
      expect(result.data.id).toBe('42');
    });

    it('handles 200 for already-existing stamp', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockStampResponse),
      });

      const result = await client.submitHash('a'.repeat(64));
      expect(result.data.id).toBe('42');
    });

    it('throws on 406 (insufficient funds)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 406,
        text: () => Promise.resolve('Insufficient funds'),
      });

      await expect(client.submitHash('a'.repeat(64))).rejects.toThrow(
        'insufficient wallet funds',
      );
    });

    it('throws on other errors', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(client.submitHash('a'.repeat(64))).rejects.toThrow('500');
    });
  });

  describe('getByHash', () => {
    it('returns stamp data when hash exists', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockStampResponse),
      });

      const result = await client.getByHash('a'.repeat(64));
      expect(global.fetch).toHaveBeenCalledWith(
        'https://stamp.gridcoin.club/api/hashes/' + 'a'.repeat(64),
        expect.objectContaining({
          headers: { Accept: 'application/vnd.api+json' },
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.data.id).toBe('42');
    });

    it('returns null when hash not found', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await client.getByHash('b'.repeat(64));
      expect(result).toBeNull();
    });

    it('throws on non-404 errors', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(client.getByHash('a'.repeat(64))).rejects.toThrow('500');
    });
  });

  describe('getStamp', () => {
    it('fetches stamp by id', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStampResponse),
      });

      const result = await client.getStamp('42');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://stamp.gridcoin.club/api/stamps/42',
        expect.objectContaining({
          headers: { Accept: 'application/vnd.api+json' },
        }),
      );
      expect(result.data.id).toBe('42');
    });

    it('throws on error response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(client.getStamp('999')).rejects.toThrow('404');
    });
  });
});
