import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inspectManifest,
  inspectRepository,
  parseRepository,
  visibleCommand,
} from "../docs/inspect.mjs";

const sha = "a".repeat(40);
const blob = "b".repeat(40);
const manifest = {
  path: "package.json",
  mode: "100644",
  type: "blob",
  sha: blob,
  size: 80,
};
const tree = (entries, truncated = false) =>
  JSON.stringify({ tree: entries, truncated });
const raw = (value) => new Response(value);
function replies(...responses) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      assert.ok(responses.length, "unexpected fetch");
      return responses.shift();
    },
  };
}

test("accepts a repository homepage, shorthand, or an exact commit", () => {
  for (const input of [
    "https://github.com/acme-lab/take.home.git",
    "acme-lab/take.home/",
    "github.com/acme-lab/take.home",
  ]) {
    assert.deepEqual(parseRepository(input), {
      owner: "acme-lab",
      name: "take.home",
      commit: undefined,
    });
  }
  assert.equal(
    parseRepository("https://github.com/acme/repo/tree/" + sha).commit,
    sha,
  );
  assert.equal(
    parseRepository("https://github.com/acme/repo/commit/" + sha).commit,
    sha,
  );
});

test("never fetches other hosts, credentials, ambiguous paths, or a different branch", async () => {
  const net = replies();
  for (const input of [
    "https://github.com.attacker.invalid/acme/demo",
    "https://github.com@host.invalid/o/r",
    "https://github.com/o/r?token=x",
    "https://github.com/o/r/tree/main/example",
    "o/..",
    "o/r%2frelease",
    "file:///o/r",
  ]) {
    await assert.rejects(inspectRepository(input, net), /public github.com/);
  }
  assert.equal(net.calls.length, 0);
});

test("lists the root install hooks, excluding unrelated commands", () => {
  const scripts = Object.fromEntries(
    [
      "predependencies",
      "dependencies",
      "postdependencies",
      "preinstall",
      "install",
      "postinstall",
      "prepublish",
      "preprepare",
      "prepare",
      "postprepare",
      "test",
      "start",
      "prepublishOnly",
    ].map((k) => [k, "echo " + k]),
  );
  const found = inspectManifest({ scripts }, false);
  assert.deepEqual(
    found.map((row) => row.event),
    Object.keys(scripts).slice(0, 10),
  );
  assert.ok(found.every((row) => row.command === scripts[row.event]));
});

test("shows the implicit native build and honors overrides", () => {
  assert.deepEqual(
    inspectManifest({}, true).map((x) => [x.command, x.file]),
    [["node-gyp rebuild", "binding.gyp"]],
  );
  assert.deepEqual(inspectManifest({ gypfile: false }, true), []);
  for (const key of ["install", "preinstall"]) {
    assert.deepEqual(
      inspectManifest({ scripts: { [key]: "echo setup" } }, true).map(
        (x) => x.command,
      ),
      ["echo setup"],
    );
  }
});

test("treats a malformed scripts object as incomplete", () => {
  for (const pkg of [
    [],
    null,
    { scripts: [] },
    { scripts: null },
    { scripts: { postinstall: { unexpected: true } } },
  ]) {
    assert.throws(() => inspectManifest(pkg, false));
  }
});

test("exposes hidden control characters and preserves shell text as evidence", () => {
  const cmd = "echo <tag>\u202e\u001b\nnext";
  assert.equal(visibleCommand(cmd), "echo <tag>\\u202e\\u001b\nnext");
});

test("reads the exact revision and blob, omitting credentials and redirects", async () => {
  const net = replies(
    raw(sha),
    raw(tree([manifest])),
    raw('{"scripts":{"postinstall":"echo hello"}}'),
  );
  const result = await inspectRepository("acme/lab", net);
  assert.equal(result.kind, "inspected");
  assert.equal(result.commands[0].command, "echo hello");
  assert.equal(result.url, "https://github.com/acme/lab/tree/" + sha);
  assert.deepEqual(
    net.calls.map((x) => x.url),
    ["commits/HEAD", "git/trees/" + sha, "git/blobs/" + blob].map(
      (p) => "https://api.github.com/repos/acme/lab/" + p,
    ),
  );
  assert.ok(
    net.calls.every(
      (x) => x.options.credentials === "omit" && x.options.redirect === "error",
    ),
  );
});

test("rejects a response naming a different revision", async () => {
  const net = replies(raw(blob));
  await assert.rejects(
    inspectRepository("acme/lab/commit/" + sha, net),
    /requested commit/,
  );
  assert.equal(net.calls.length, 1);
});

test("distinguishes absence of a root manifest from an inspected manifest with no hooks", async () => {
  const missing = await inspectRepository(
    "acme/lab",
    replies(raw(sha), raw(tree([]))),
  );
  const quiet = await inspectRepository(
    "acme/lab",
    replies(
      raw(sha),
      raw(tree([manifest])),
      raw('{"scripts":{"test":"echo ok"}}'),
    ),
  );
  assert.equal(missing.kind, "missing");
  assert.equal(quiet.kind, "inspected");
  assert.deepEqual(quiet.commands, []);
});

test("refuses incomplete trees, links, or oversized manifests before loading content", async () => {
  for (const value of [
    tree([], true),
    tree([{ ...manifest, mode: "120000" }]),
    tree([{ ...manifest, size: 131073 }]),
    tree([manifest, { ...manifest, path: "binding.gyp", mode: "120000" }]),
  ]) {
    const net = replies(raw(sha), raw(value));
    await assert.rejects(inspectRepository("acme/lab", net));
    assert.equal(net.calls.length, 2);
  }
});

test("reports unreadable, invalid, or unexpectedly large content as an error", async () => {
  for (const body of ["not json", " ".repeat(131073)]) {
    await assert.rejects(
      inspectRepository(
        "acme/lab",
        replies(raw(sha), raw(tree([manifest])), raw(body)),
      ),
    );
  }
});

test("unavailable repositories and GitHub rate limits produce explicit failures", async () => {
  for (const [status, message] of [
    [404, /could not find/],
    [403, /limited or denied/],
    [429, /limited or denied/],
    [500, /returned an error/],
  ]) {
    await assert.rejects(
      inspectRepository("acme/lab", replies(new Response("", { status }))),
      message,
    );
  }
});
