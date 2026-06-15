export interface DiscoveryParams {
  verticals: string[];
  locations: string[];
  minRevenue?: number;
  maxResults: number;
  postedSince?: Date;
  // When set, the provider fetches this TheirStack saved search's stored
  // filters (GET /v0/saved_searches/{id}) and replays them via the jobs
  // search, ignoring `verticals`. Null/undefined runs the default title query.
  theirstackSavedSearchId?: string | null;
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
