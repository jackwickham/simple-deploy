import nock from "nock";
import {Step} from "../src/types";
import {Readable} from "stream";
import _ from "lodash";

const REPO_DIR = "/foo/bar";
const COMMIT_HASH = "hash";
const TOKEN = "token";
const REPO_OWNER = "owner";
const REPO = "repo";
const DEPLOYMENT_ID = 2;
const SPAWN_OPTS = {cwd: REPO_DIR, stdio: ["ignore", "pipe", "pipe"]};

type SpawnOverride = [string[], {exitCode?: number; stdout?: string}];

describe("Standalone", () => {
  let spawnOverrides: SpawnOverride[];

  beforeEach(() => {
    nock.disableNetConnect();
    spawnOverrides = [];
  });

  afterEach(() => {
    expect(spawnOverrides).toEqual([]);
    expect(nock.pendingMocks()).toEqual([]);
    expect(nock.isDone()).toBe(true);
  });

  test("Checks out commits and runs steps", async () => {
    const spawnMock = mockSpawn();

    nock("https://api.github.com")
      .post(`/repos/${REPO_OWNER}/${REPO}/deployments/${DEPLOYMENT_ID}/statuses`, (body: any) => {
        expect(body.state).toEqual("success");
        return true;
      })
      .reply(201);

    await run([["cmd", "arg1", "arg2"]]);

    expect(spawnMock).toHaveBeenCalledTimes(4);
    expect(spawnMock).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], SPAWN_OPTS);
    expect(spawnMock).toHaveBeenCalledWith("git", ["fetch", "--quiet"], SPAWN_OPTS);
    expect(spawnMock).toHaveBeenCalledWith("git", ["checkout", COMMIT_HASH, "--quiet"], SPAWN_OPTS);
    expect(spawnMock).toHaveBeenCalledWith("cmd", ["arg1", "arg2"], SPAWN_OPTS);
  });

  test("Aborts with error if checkout fails", async () => {
    const spawnMock = mockSpawn([
      [
        ["git", "checkout", COMMIT_HASH, "--quiet"],
        {
          exitCode: 1,
        },
      ],
    ]);

    nock("https://api.github.com")
      .post(`/repos/${REPO_OWNER}/${REPO}/deployments/${DEPLOYMENT_ID}/statuses`, (body: any) => {
        expect(body.state).toEqual("error");
        return true;
      })
      .reply(201);

    await run([["should", "not", "run"]]);

    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(spawnMock).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], SPAWN_OPTS);
    expect(spawnMock).toHaveBeenCalledWith("git", ["fetch", "--quiet"], SPAWN_OPTS);
    expect(spawnMock).toHaveBeenCalledWith("git", ["checkout", COMMIT_HASH, "--quiet"], SPAWN_OPTS);
  });

  test("Aborts with failure and rolls back if steps fails", async () => {
    const currentCommit = "currentCommit";
    const spawnMock = mockSpawn([
      [
        ["git", "rev-parse", "HEAD"],
        {
          stdout: currentCommit + "\n",
        },
      ],
      [
        ["step2"],
        {
          exitCode: 1,
        },
      ],
    ]);

    nock("https://api.github.com")
      .post(`/repos/${REPO_OWNER}/${REPO}/deployments/${DEPLOYMENT_ID}/statuses`, (body: any) => {
        expect(body.state).toEqual("failure");
        return true;
      })
      .reply(201);

    await run([["step1"], ["step2"]]);

    expect(spawnMock.mock.calls).toEqual([
      ["git", ["rev-parse", "HEAD"], SPAWN_OPTS],
      ["git", ["fetch", "--quiet"], SPAWN_OPTS],
      ["git", ["checkout", COMMIT_HASH, "--quiet"], SPAWN_OPTS],
      ["step1", [], SPAWN_OPTS],
      ["step2", [], SPAWN_OPTS],
      ["git", ["checkout", currentCommit, "--quiet"], SPAWN_OPTS],
      ["step1", [], SPAWN_OPTS],
      ["step2", [], SPAWN_OPTS],
    ]);
  });

  async function run(steps: Step[]): Promise<void> {
    jest.resetModules();
    const oldProcessOn = process.on;
    const processOnMock = jest.fn();
    process.on = processOnMock;

    jest.requireActual("../src/standalone");

    process.on = oldProcessOn;

    expect(processOnMock).toHaveBeenCalledTimes(1);
    expect(processOnMock.mock.calls[0][0]).toEqual("message");
    const standaloneHandler = processOnMock.mock.calls[0][1];
    await standaloneHandler({
      dir: REPO_DIR,
      commitHash: COMMIT_HASH,
      token: TOKEN,
      repoOwner: REPO_OWNER,
      repo: REPO,
      deploymentId: DEPLOYMENT_ID,
      steps: steps,
    });
  }

  function mockSpawn(overrides: SpawnOverride[] = []): jest.Mock {
    spawnOverrides = overrides;
    const spawnMock = jest.fn((cmd, args) => {
      const key = [cmd, ...args];
      let override: SpawnOverride | undefined = undefined;
      for (let i = 0; i < overrides.length; i++) {
        if (_.isEqual(key, overrides[i][0])) {
          override = overrides[i];
          overrides.splice(i, 1);
          break;
        }
      }
      if (override) {
        return {
          stdout: Readable.from(override[1].stdout || ""),
          stderr: Readable.from(""),
          on: (cmd: string, cb: (n: number) => void) => {
            expect(cmd).toEqual("exit");
            setTimeout(() => cb(override![1].exitCode || 0), 0);
          },
        };
      } else {
        return {
          stdout: Readable.from(""),
          stderr: Readable.from(""),
          on: (cmd: string, cb: (n: number) => void) => {
            expect(cmd).toEqual("exit");
            cb(0);
          },
        };
      }
    });

    jest.mock("child_process", () => ({
      spawn: spawnMock,
    }));

    return spawnMock;
  }
});
