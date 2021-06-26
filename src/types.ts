export interface WorkerArgs {
  dir: string;
  steps: Step[];
  repoOwner: string;
  repo: string;
  commitHash: string;
  deploymentId: number;
  token: string;
}

export interface Config {
  services: Service[];
}

export interface Service {
  repo: string;
  dir: string;
  environment: string;
  steps: Step[];
}

export type Step = [string, ...string[]];
