// These are the root lifecycle events for a local npm install with no package arguments.
// Dependency-tree hooks fire only when npm changes the dependency tree.
const hooks = [
  ["predependencies", "Before the dependency-change hook"],
  ["dependencies", "When installed dependencies change"],
  ["postdependencies", "After the dependency-change hook"],
  ["preinstall", "Before the install hook"],
  ["install", "During the install hook"],
  ["postinstall", "After the install hook"],
  ["prepublish", "During local installation, despite its name"],
  ["preprepare", "Before project preparation"],
  ["prepare", "During project preparation"],
  ["postprepare", "After project preparation"],
];

const commitPattern = /^[0-9a-f]{40}$/i;
const maxManifestBytes = 128 * 1024;
const inputHint =
  "Use a public github.com repository homepage or a link to a full commit.";

export function parseRepository(input) {
  const text = input.trim();
  if (!text || /[?#\\\s@%]/.test(text)) throw new Error(inputHint);
  const match =
    /^(?:https:\/\/github\.com\/|github\.com\/)?([a-z0-9-]+)\/([a-z0-9_.-]+)(?:\/(?:commit|tree)\/([0-9a-f]{40}))?\/?$/i.exec(
      text,
    );
  if (!match) throw new Error(inputHint);
  const [, owner, project, commit] = match;
  const name = project.replace(/\.git$/i, "");
  if (!name || /^\.{1,2}$/.test(name)) throw new Error(inputHint);
  return { owner, name, commit };
}

export function inspectManifest(manifest, hasBinding) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("The root package.json does not contain a JSON object.");
  }
  const scripts = manifest.scripts === undefined ? {} : manifest.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    throw new Error(
      "The scripts field has an unexpected format. Review the manifest directly.",
    );
  }
  const commands = [];
  for (const [event, timing] of hooks) {
    const value = scripts[event];
    if (value !== undefined && typeof value !== "string") {
      throw new Error(
        "An install script has an unexpected format. Review the manifest directly.",
      );
    }
    if (value?.trim())
      commands.push({ event, timing, command: value, file: "package.json" });
    if (
      event === "install" &&
      !value &&
      !scripts.preinstall &&
      hasBinding &&
      manifest.gypfile !== false
    ) {
      commands.push({
        event,
        timing: "Default native build requested by binding.gyp",
        command: "node-gyp rebuild",
        file: "binding.gyp",
      });
    }
  }
  return commands;
}

// Make terminal controls and bidirectional overrides visible in untrusted command text.
export function visibleCommand(command) {
  return command.replace(
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu,
    (char) => "\\u" + char.codePointAt(0).toString(16).padStart(4, "0"),
  );
}

async function readResponse(response, byteLimit) {
  if (Number(response.headers.get("content-length")) > byteLimit)
    throw new Error("This repository response is too large to inspect here.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > byteLimit) {
        await reader.cancel();
        throw new Error(
          "This repository response is too large to inspect here.",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export async function inspectRepository(
  input,
  { fetcher = fetch, signal } = {},
) {
  const { owner, name, commit } = parseRepository(input);
  const repo = owner + "/" + name;
  async function get(path, accept, limit) {
    let response;
    try {
      response = await fetcher(
        "https://api.github.com/repos/" + repo + "/" + path,
        {
          headers: { Accept: accept },
          signal,
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
        },
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(
        "GitHub could not be reached. Check the connection and the repository’s current URL.",
      );
    }
    if (!response.ok) {
      if (response.status === 403 || response.status === 429)
        throw new Error(
          "GitHub limited or denied this request. Try again later.",
        );
      if (response.status === 404 || response.status === 409)
        throw new Error(
          "GitHub could not find a public repository with a commit at this address.",
        );
      throw new Error(
        "GitHub returned an error. No inspection result is available.",
      );
    }
    return readResponse(response, limit);
  }

  // Resolve both default and user-supplied revisions as commits before reading any file.
  const sha = (
    await get(
      "commits/" + (commit || "HEAD"),
      "application/vnd.github.sha",
      128,
    )
  ).trim();
  if (
    !commitPattern.test(sha) ||
    (commit && sha.toLowerCase() !== commit.toLowerCase())
  ) {
    throw new Error("GitHub did not return the requested commit.");
  }
  const tree = JSON.parse(
    await get("git/trees/" + sha, "application/vnd.github+json", 1024 * 1024),
  );
  if (tree.truncated !== false || !Array.isArray(tree.tree))
    throw new Error("GitHub returned an incomplete file list.");
  const base = {
    repo,
    sha,
    url: "https://github.com/" + repo + "/tree/" + sha,
  };
  const manifest = tree.tree.find((entry) => entry.path === "package.json");
  if (!manifest) return { ...base, kind: "missing", commands: [] };
  const regularFile = (entry) =>
    entry.type === "blob" && ["100644", "100755"].includes(entry.mode);
  if (!regularFile(manifest) || !commitPattern.test(manifest.sha))
    throw new Error(
      "The root package.json is not a regular file. Inspect the repository directly.",
    );
  if (
    !Number.isSafeInteger(manifest.size) ||
    manifest.size < 1 ||
    manifest.size > maxManifestBytes
  ) {
    throw new Error(
      "The root package.json is empty or exceeds the 128 KiB reading limit.",
    );
  }
  const binding = tree.tree.find((entry) => entry.path === "binding.gyp");
  if (binding && !regularFile(binding))
    throw new Error(
      "The native-build entry is not a regular file. Its behavior needs manual review.",
    );
  const raw = await get(
    "git/blobs/" + manifest.sha,
    "application/vnd.github.raw+json",
    maxManifestBytes,
  );
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    throw new Error(
      "The root package.json could not be parsed. No inspection result is available.",
    );
  }
  return {
    ...base,
    kind: "inspected",
    commands: inspectManifest(pkg, Boolean(binding)),
  };
}
