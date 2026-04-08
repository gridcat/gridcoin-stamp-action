import { StampApiClient } from './stamp-api';
import { StampApiResponse } from './types';
export declare function pollForConfirmation(client: StampApiClient, stampId: string, timeout: number, interval: number): Promise<StampApiResponse>;
