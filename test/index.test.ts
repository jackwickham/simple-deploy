// You can import your modules
// import index from '../src/index'

import nock from "nock";
import deployApp from "../src/app";
import {Probot, ProbotOctokit} from "probot";

describe("My Probot app", () => {
  let probot: any;

  beforeEach(() => {
    nock.disableNetConnect();
    probot = new Probot({
      githubToken: "test",
      // disable request throttling and retries for testing
      Octokit: ProbotOctokit.defaults({
        retry: {enabled: false},
        throttle: {enabled: false},
      }),
    });
    // Load our app into probot
    probot.load(deployApp);
  });

  afterEach(() => {
    expect(nock.pendingMocks()).toEqual([]);
    expect(nock.isDone()).toBe(true);
  });

  /*test("creates a comment when an issue is opened", async (done) => {
    const mock = nock("https://api.github.com")
      // Test that we correctly return a test token
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: {
          issues: "write",
        },
      })

      // Test that a comment is posted
      .post("/repos/hiimbex/testing-things/issues/1/comments", (body: any) => {
        done(expect(body).toMatchObject(issueCreatedBody));
        return true;
      })
      .reply(200);

    // Receive a webhook event
    await probot.receive({name: "issues", payload});

    expect(mock.pendingMocks()).toStrictEqual([]);
  });*/
});
