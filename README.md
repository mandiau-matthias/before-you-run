# Before You Run

Someone sends you a GitHub coding exercise and asks you to run `npm install`. Paste the repository link into Before You Run to see which setup commands the root project can start. You can also try the built-in example without sending a repository name anywhere. [Open Before You Run](https://mandiau-matthias.github.io/before-you-run/)

## What you see

The inspector lists each root install hook, shows its command as inert text, and links to the exact revision of the source. It also identifies npm’s default native build when a root `binding.gyp` is present and the package allows it. A hook can be part of an ordinary build. Following the command to the file it calls is the next step.

The checks cover a local, no-argument npm install at the repository root. Dependency code, nested packages, editor tasks, shell configuration, other package managers and the sender’s identity are outside this inspection. An empty result describes what was found at one revision. It cannot establish that the download is safe.

## How it reads a repository

Your browser requests a public commit, its top-level file list and the manifest blob directly from GitHub. The checker accepts repository homepages and full commit links. The file limit is 128 KiB. Incomplete listings, unsupported file types, unreadable manifests and rate limits produce an error. GitHub receives the request as it would for other public API reads. The tool uses no account, API key, analytics or application server.

## Run locally

Use Node 20 or later for the tests. The static site has no build step or dependency installation.

```sh
node --test
python3 -m http.server 8000 --directory docs
```

Open localhost on port 8000. Live inspections need a connection to the public GitHub API. The embedded example runs locally.

## Background

Microsoft documented fake recruiting assignments that prompted developers to execute untrusted code. This tool applies one small part of that lesson to npm setup commands. [Contagious Interview investigation](https://www.microsoft.com/en-us/security/blog/2026/03/11/contagious-interview-malware-delivered-through-fake-developer-job-interviews/) · [npm lifecycle documentation](https://docs.npmjs.com/cli/v11/using-npm/scripts/)

Built by [Matthias Mandiau, publishing as Automatron](https://github.com/mandiau-matthias).
