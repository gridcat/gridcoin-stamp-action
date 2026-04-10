import { StampApiResponse } from './types';

/**
 * Thin client for the stamp.gridcoin.club JSON:API.
 *
 * The server enforces SHA-256 format on the `hash` attribute (exactly 64
 * lowercase hex chars), so callers MUST have already validated/normalized
 * the hash before calling `submitHash` — the API will reject anything else
 * with a 422.
 */
export class StampApiClient {
  constructor(private baseUrl: string) {}

  async submitHash(hash: string): Promise<StampApiResponse> {
    const response = await fetch(`${this.baseUrl}/stamps`, {
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
    });

    // 406 is the stamp API's signal that the stamping wallet is out of
    // GRC to burn — it's not a client-side problem (the request was well
    // formed), so we surface it with a clear operational message rather
    // than a generic HTTP error. Retrying will not help until the wallet
    // is topped up.
    if (response.status === 406) {
      throw new Error('Stamp API: insufficient wallet funds for stamping');
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Stamp API error (${response.status}): ${text}`);
    }

    return response.json() as Promise<StampApiResponse>;
  }

  async getByHash(hash: string): Promise<StampApiResponse | null> {
    const response = await fetch(`${this.baseUrl}/hashes/${hash}`, {
      headers: { Accept: 'application/vnd.api+json' },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Stamp API error (${response.status}): Failed to lookup hash ${hash}`);
    }

    return response.json() as Promise<StampApiResponse>;
  }

  async getStamp(id: string): Promise<StampApiResponse> {
    const response = await fetch(`${this.baseUrl}/stamps/${id}`, {
      headers: { Accept: 'application/vnd.api+json' },
    });

    if (!response.ok) {
      throw new Error(`Stamp API error (${response.status}): Failed to get stamp ${id}`);
    }

    return response.json() as Promise<StampApiResponse>;
  }
}
