import {WorkerArgs} from "./types";
import {execFile as execFileImported} from "child_process";
import * as util from "util";
import {Octokit} from "@octokit/rest";

const execFile = util.promisify(execFileImported);

process.on("message", async (args: WorkerArgs) => {
  const octokit = new Octokit({
    auth: args.token,
    previews: ["flash"],
  });
  const context = new Context(args, octokit);

  // Report back to the caller to say we're happy and running - we now guarantee to report back the
  // deployment status when we're done
  process.send!({
    ack: true,
  });

  let initialCommit: string;
  try {
    initialCommit = await context.getCurrentCommit();
    await context.checkout(args.commitHash);
  } catch (e) {
    console.error("Failed to checkout commit");
    await context.report("error");
    return;
  }

  try {
    await context.runSteps();
  } catch (e) {
    console.error("Failed to run steps, rolling back", e);
    try {
      // Roll back
      await context.checkout(initialCommit);
      await context.runSteps();
    } catch (nestedException) {
      console.error("Failed to roll back", nestedException);
    }
  }
});

class Context {
  public constructor(private args: WorkerArgs, private octokit: Octokit) {}

  private async exec(command: string, args: string[]): Promise<string> {
    const result = await execFile(command, args, {cwd: this.args.dir});
    return result.stdout;
  }

  public async getCurrentCommit(): Promise<string> {
    return await this.exec("git", ["rev-parse", "HEAD"]);
  }

  public async checkout(commit: string): Promise<void> {
    await this.exec("git", ["checkout", commit]);
    await this.exec("git", ["fetch"]);
  }

  public async runSteps(): Promise<void> {
    for (const step of this.args.steps) {
      await this.exec(step[0], step.slice(1));
    }
  }

  public async report(state: "error" | "failure" | "in_progress" | "success"): Promise<void> {
    this.octokit.repos.createDeploymentStatus({
      owner: this.args.repoOwner,
      repo: this.args.repo,
      deployment_id: this.args.deploymentId,
      state: state,
    });
  }
}
