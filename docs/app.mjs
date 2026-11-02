import {
  inspectManifest,
  inspectRepository,
  visibleCommand,
} from "./inspect.mjs";

const byId = (id) => document.getElementById(id);
const result = byId("result");
const title = byId("result-title");
let active;
function start() {
  active?.abort();
  active = new AbortController();
  result.hidden = true;
  byId("progress").textContent = "";
  return active;
}
function link(text, url) {
  const anchor = document.createElement("a");
  anchor.textContent = text;
  anchor.href = url;
  return anchor;
}
function render(report) {
  const { commands } = report;
  const example = report.kind === "example";
  byId("source").textContent = example ? "ILLUSTRATIVE EXAMPLE" : report.repo;
  if (report.kind === "missing") {
    title.textContent = "No root package.json found";
    byId("note").textContent =
      "There is no root npm manifest to inspect at this revision. The project may use a different folder or setup method.";
  } else if (commands.length) {
    title.textContent =
      commands.length === 1
        ? "One setup command to review"
        : commands.length + " setup commands to review";
    byId("note").textContent =
      "npm can start these commands during installation. Build tools use these hooks too. Read what each command calls before you run the project.";
  } else {
    title.textContent = "No root install hooks found";
    byId("note").textContent =
      "Dependencies and other setup steps can still run code. This result covers only the root package at the revision below.";
  }
  byId("commands").replaceChildren();
  for (const { event, timing, command, file } of commands) {
    const row = document.createElement("article");
    const heading = document.createElement("h3");
    heading.textContent = event;
    const when = document.createElement("p");
    when.textContent = timing;
    const excerpt = document.createElement("pre");
    excerpt.textContent = visibleCommand(command);
    row.append(heading, when, excerpt);
    if (!example)
      row.append(
        link(
          "View " + file + " on GitHub ↗",
          "https://github.com/" +
            report.repo +
            "/blob/" +
            report.sha +
            "/" +
            file,
        ),
      );
    byId("commands").append(row);
  }
  byId("revision").replaceChildren(
    example
      ? "This sample prints a message. Nothing here is executed."
      : link("Inspected commit " + report.sha.slice(0, 12) + " ↗", report.url),
  );
  byId("progress").textContent = "";
  result.hidden = false;
  title.focus({ preventScroll: true });
  result.scrollIntoView({ block: "nearest" });
}
byId("sample").addEventListener("click", () => {
  start();
  render({
    kind: "example",
    commands: inspectManifest(
      {
        scripts: {
          postinstall: "node -e \"console.log('Setting up the exercise')\"",
        },
      },
      false,
    ),
  });
});
byId("check").addEventListener("submit", async (event) => {
  event.preventDefault();
  const request = start();
  const deadline = setTimeout(() => request.abort("timeout"), 15000);
  byId("progress").textContent = "Reading the repository from GitHub…";
  try {
    const report = await inspectRepository(byId("repo").value, {
      signal: request.signal,
    });
    if (request === active) render(report);
  } catch (error) {
    if (request !== active) return;
    byId("progress").textContent = request.signal.aborted
      ? "GitHub took too long to respond. Try again."
      : error.message;
  } finally {
    clearTimeout(deadline);
  }
});
