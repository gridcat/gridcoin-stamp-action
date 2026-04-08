import { StampApiResponse } from './types';
export declare class StampApiClient {
    private baseUrl;
    constructor(baseUrl: string);
    submitHash(hash: string): Promise<StampApiResponse>;
    getByHash(hash: string): Promise<StampApiResponse | null>;
    getStamp(id: string): Promise<StampApiResponse>;
}
