import nock from "nock";
import deployApp from "../src/app";
import {Probot, ProbotOctokit} from "probot";
import mockFs from "mock-fs";
import payload from "./fixtures/deployment.created.json";

const TOKEN = "token";

let mockChildProcess: any;

jest.mock("child_process", () => ({
  fork: jest.fn(() => mockChildProcess),
}));

describe("app", () => {
  let probot: any; // Any to avoid needing all the fields in the payloads

  beforeEach(() => {
    nock.disableNetConnect();

    probot = new Probot({
      githubToken: TOKEN,
      // disable request throttling and retries for testing
      Octokit: ProbotOctokit.defaults({
        retry: {enabled: false},
        throttle: {enabled: false},
      }),
    });
    probot.load(deployApp);
  });

  afterEach(() => {
    expect(nock.pendingMocks()).toEqual([]);
    expect(nock.isDone()).toBe(true);
  });

  afterEach(() => mockFs.restore());

  test("Does nothing if repo not present in config", async () => {
    mockFs({
      ".config.yml": JSON.stringify({
        services: [
          {
            repo: "other/repo",
            environment: "production",
          },
        ],
      }),
    });

    await probot.receive({name: "deployment", payload});
  });

  test("Does nothing if environment not present in config", async () => {
    mockFs({
      ".config.yml": JSON.stringify({
        services: [
          {
            repo: "Codertocat/Hello-World",
            environment: "staging",
          },
        ],
      }),
    });

    await probot.receive({name: "deployment", payload});
  });

  test("Reports in progress and starts subprocess", async () => {
    mockFs({
      ".config.yml": JSON.stringify({
        services: [
          {
            repo: "Codertocat/Hello-World",
            environment: "production",
            dir: "/foo/bar",
            steps: [["step", "with", "args"]],
          },
        ],
      }),
    });

    nock("https://api.github.com")
      .post(
        `/repos/${payload.repository.full_name}/deployments/${payload.deployment.id}/statuses`,
        (body: any) => {
          expect(body.state).toEqual("in_progress");
          return true;
        }
      )
      .reply(201);

    const child = {
      send: jest.fn(),
      on: (event: string, cb: (arg: {ack: boolean}) => Promise<void>) => {
        expect(event).toEqual("message");
        cb({ack: true});
      },
      disconnect: jest.fn(),
      unref: jest.fn(),
    };
    mockChildProcess = child;

    await probot.receive({name: "deployment", payload});

    expect(child.send).toHaveBeenCalledWith({
      dir: "/foo/bar",
      commitHash: payload.deployment.sha,
      token: TOKEN,
      repoOwner: payload.repository.owner.login,
      repo: payload.repository.name,
      deploymentId: payload.deployment.id,
      steps: [["step", "with", "args"]],
    });
    expect(child.disconnect).toHaveBeenCalled();
    expect(child.unref).toHaveBeenCalled();
  });

  test("Reports failed if subprocess times out", async () => {
    mockFs({
      ".config.yml": JSON.stringify({
        services: [
          {
            repo: "Codertocat/Hello-World",
            environment: "production",
            dir: "/foo/bar",
            steps: [],
          },
        ],
      }),
    });

    nock("https://api.github.com")
      .post(
        `/repos/${payload.repository.full_name}/deployments/${payload.deployment.id}/statuses`,
        (body: any) => {
          return body.state === "in_progress";
        }
      )
      .reply(201)
      .post(
        `/repos/${payload.repository.full_name}/deployments/${payload.deployment.id}/statuses`,
        (body: any) => {
          return body.state === "error";
        }
      )
      .reply(201);

    const child = {
      send: jest.fn(),
      on: (event: string, _cb: (arg: {ack: boolean}) => Promise<void>) => {
        expect(event).toEqual("message");
        // don't call callback
      },
      disconnect: jest.fn(),
      unref: jest.fn(),
      exitCode: 1,
    };
    mockChildProcess = child;

    await probot.receive({name: "deployment", payload});
  });
});
