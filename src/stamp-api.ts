import { StampApiResponse } from './types';

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
