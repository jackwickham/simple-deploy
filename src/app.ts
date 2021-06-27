import {fork} from "child_process";
import {promises as fs} from "fs";
import {Probot} from "probot";
import yaml from "js-yaml";
import {Config, WorkerArgs} from "./types";

export default async function deployApp(app: Probot): Promise<void> {
  app.on("deployment.created", async (context) => {
    const configFile = await fs.readFile(".config.yml", "utf-8");
    const config = yaml.load(configFile) as Config;

    const repo = context.repo();
    const service = config.services.find(
      (svc) =>
        svc.repo === `${repo.owner}/${repo.repo}` &&
        svc.environment == context.payload.deployment.environment
    );

    if (!service) {
      context.log.info(
        `No deployment config found for ${repo.owner}/${repo.repo} ${context.payload.deployment.environment}, skipping`
      );
      return;
    }

    await context.octokit.repos.createDeploymentStatus(
      context.repo({
        deployment_id: context.payload.deployment.id,
        state: "in_progress",
      })
    );

    const token = (await (context.octokit.auth({type: "installation"}) as Promise<{token: string}>))
      .token;
    const args: WorkerArgs = {
      dir: service.dir,
      commitHash: context.payload.deployment.sha,
      token: token,
      repoOwner: context.repo().owner,
      repo: context.repo().repo,
      deploymentId: context.payload.deployment.id,
      steps: service.steps,
    };
    const errorFile = config.errorFile ? (await fs.open(config.errorFile, "a")).fd : "ignore";
    const child = fork(__dirname + "/standalone.js", [], {
      detached: true,
      stdio: ["ipc", errorFile, errorFile],
    });
    child.send(args);

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(async () => {
        const exitCode = child.exitCode;
        if (exitCode !== null) {
          context.log.error(`Deployment script exited with code ${exitCode}`);
        } else {
          child.disconnect();
          child.unref();
          context.log.error(`Deployment init timed out`);
        }
        await context.octokit.repos.createDeploymentStatus(
          context.repo({
            deployment_id: context.payload.deployment.id,
            state: "error",
          })
        );
        resolve();
      }, 1000);

      child.on("message", async (m: {ack: boolean}) => {
        clearTimeout(timeout);
        child.disconnect();
        child.unref();
        if (m.ack === true) {
          // Child is happy, let it do its thing
          context.log.info(`Running deployment`);
        } else {
          context.log.error(`Deployment init failed`);
          await context.octokit.repos.createDeploymentStatus(
            context.repo({
              deployment_id: context.payload.deployment.id,
              state: "error",
            })
          );
        }
        resolve();
      });
    });
  });
}
