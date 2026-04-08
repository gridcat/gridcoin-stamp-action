import { pollForConfirmation } from '../src/poller';
import { StampApiClient } from '../src/stamp-api';
import { StampApiResponse } from '../src/types';

// Mock @actions/core
jest.mock('@actions/core', () => ({
  info: jest.fn(),
}));

function makeResponse(block: number | null, time: number | null): StampApiResponse {
  return {
    data: {
      id: '42',
      type: 'stamps',
      attributes: {
        protocol: '0.0.1',
        type: 'sha256',
        hash: 'a'.repeat(64),
        block,
        tx: block ? 'tx123' : null,
        rawTransaction: null,
        time,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    },
  };
}

describe('pollForConfirmation', () => {
  it('returns immediately if already confirmed', async () => {
    const client = { getStamp: jest.fn().mockResolvedValue(makeResponse(100, 1704067200)) };

    const result = await pollForConfirmation(
      client as unknown as StampApiClient,
      '42',
      10,
      1,
    );

    expect(result.data.attributes.block).toBe(100);
    expect(client.getStamp).toHaveBeenCalledTimes(1);
  });

  it('polls until confirmed', async () => {
    const client = {
      getStamp: jest
        .fn()
        .mockResolvedValueOnce(makeResponse(null, null))
        .mockResolvedValueOnce(makeResponse(null, null))
        .mockResolvedValueOnce(makeResponse(200, 1704067200)),
    };

    const result = await pollForConfirmation(
      client as unknown as StampApiClient,
      '42',
      30,
      0.01, // very short interval for test speed
    );

    expect(result.data.attributes.block).toBe(200);
    expect(client.getStamp).toHaveBeenCalledTimes(3);
  });

  it('throws on timeout', async () => {
    const client = {
      getStamp: jest.fn().mockResolvedValue(makeResponse(null, null)),
    };

    await expect(
      pollForConfirmation(client as unknown as StampApiClient, '42', 0.05, 0.01),
    ).rejects.toThrow('Timed out');
  });
});
