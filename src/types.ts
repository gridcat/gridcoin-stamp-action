export interface ActionInputs {
  apiUrl: string;
  waitForConfirmation: boolean;
  pollTimeout: number;
  pollInterval: number;
  includeSourceArchives: boolean;
  githubToken: string;
}

export interface AssetInfo {
  name: string;
  localPath: string;
}

export interface StampApiResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      protocol: string;
      type: string;
      hash: string;
      block: number | null;
      tx: string | null;
      rawTransaction: string | null;
      time: number | null;
      createdAt: string;
      updatedAt: string;
    };
    links?: {
      self: string;
    };
  };
}

export interface StampResult {
  filename: string;
  hash: string;
  proofUrl: string;
  status: 'submitted' | 'pending' | 'confirmed';
}
