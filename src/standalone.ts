import {spawn} from "child_process";
import {Octokit} from "@octokit/rest";
import loggerFactory, {Logger} from "pino";
import {WorkerArgs} from "./types";

const fn = async (args: WorkerArgs): Promise<void> => {
  const octokit = new Octokit({
    auth: args.token,
    previews: ["flash"],
  });
  const log = loggerFactory({
    level: process.env.LOG_LEVEL || "info",
  }).child({
    repoOwner: args.repoOwner,
    repo: args.repo,
    deploymentId: args.deploymentId,
    commitHash: args.commitHash,
  });
  const context = new Context(args, octokit, log);

  try {
    // Report back to the caller to say we're happy and running - we now guarantee to report back the
    // deployment status when we're done
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    process.send!({
      ack: true,
    });

    log.info("Starting deployment");

    let initialCommit: string;
    try {
      initialCommit = await context.getCurrentCommit();
      await context.fetch();
      await context.checkout(args.commitHash);
    } catch (e) {
      log.error({err: e}, "Failed to checkout commit");
      await context.report("error");
      return;
    }

    try {
      await context.runSteps();
    } catch (e) {
      log.error({err: e}, "Failed to run steps, rolling back");
      try {
        // Roll back
        await context.checkout(initialCommit);
        await context.runSteps();
      } catch (nestedException) {
        log.error({err: nestedException}, "Failed to roll back");
      }
      await context.report("failure");
      return;
    }

    await context.report("success");
    log.info("Deployment successful");
  } catch (e) {
    log.error({err: e}, "Unhandled exception");
  }
};

process.on("message", fn);

class Context {
  public constructor(private args: WorkerArgs, private octokit: Octokit, private log: Logger) {}

  public async getCurrentCommit(): Promise<string> {
    return (await this.exec("git", ["rev-parse", "HEAD"])).trim();
  }

  public async fetch(): Promise<void> {
    await this.exec("git", [
      "fetch",
      "--quiet",
      `https://x-access-token:${this.args.token}@github.com/${this.args.repoOwner}/${this.args.repo}.git`,
    ]);
  }

  public async checkout(commit: string): Promise<void> {
    await this.exec("git", ["checkout", commit, "--quiet"]);
  }

  public async runSteps(): Promise<void> {
    for (const step of this.args.steps) {
      await this.exec(step[0], step.slice(1));
    }
  }

  public async report(state: "error" | "failure" | "in_progress" | "success"): Promise<void> {
    await this.octokit.repos.createDeploymentStatus({
      owner: this.args.repoOwner,
      repo: this.args.repo,
      deployment_id: this.args.deploymentId,
      state: state,
    });
  }

  private async exec(command: string, args: string[]): Promise<string> {
    const processLogger = this.log.child({
      command,
      args,
    });
    processLogger.info("Starting subprocess");
    const child = spawn(command, args, {cwd: this.args.dir, stdio: ["ignore", "pipe", "pipe"]});
    let output = "";
    child.stdout.on("data", (data) => (output += data.toString()));
    child.stderr.on("data", (data) => processLogger.warn({stderr: data.toString()}));
    return new Promise((resolve, reject) => {
      child.on("exit", (code) => {
        if (code === 0) {
          processLogger.debug("Subprocess finished successfully");
          resolve(output);
        } else {
          processLogger.error("Subprocess failed with exit code %d", code);
          reject(new Error(`Process exited with code ${code}`));
        }
      });
    });
  }
}
