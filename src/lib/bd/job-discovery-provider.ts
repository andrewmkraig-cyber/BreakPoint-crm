export interface DiscoveryParams {
  verticals: string[];
  locations: string[];
  minRevenue?: number;
  maxResults: number;
  postedSince?: Date;
}

export interface DiscoveredCompany {
  companyName: string;
  domain: string;
  jobTitle: string;
  jobLocation: string;
  jobPostingUrl?: string;
  source: string;
  rawPayload: unknown;
}

export interface JobDiscoveryProvider {
  discoverJobs(params: DiscoveryParams): Promise<DiscoveredCompany[]>;
}
