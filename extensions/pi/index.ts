import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runWorkers } from "./workers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const COMMANDS = readdirSync(join(ROOT, "commands")).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -3));

function commandPrompt(name: string, args: string): string {
  const source = readFileSync(join(ROOT, "commands", `${name}.md`), "utf8");
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, "");
  return `Host adapter: pi (backend pi-workers).\n${body}`
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", ROOT)
    .replaceAll("$ARGUMENTS", args)
    .replaceAll("~/.tri", ROOT);
}

export default function (pi: ExtensionAPI) {
  for (const name of COMMANDS) {
    const source = readFileSync(join(ROOT, "commands", `${name}.md`), "utf8");
    const description = source.match(/^description:\s*(.+)$/m)?.[1] ?? `Run TRI ${name}`;
    pi.registerCommand(`tri:${name}`, {
      description,
      handler: async (args) => pi.sendUserMessage(commandPrompt(name, args)),
    });
  }

  pi.registerTool({
    name: "tri_workers",
    label: "TRI Workers",
    description: "Run 1-4 leased TRI tasks concurrently in distinct, pre-created Git worktrees. Returns the observed backend, actual mode, peak worker count, exit status, and bounded output.",
    promptSnippet: "Launch leased TRI workers concurrently in isolated Git worktrees",
    promptGuidelines: ["Use tri_workers for Pi parallel TRI leases; never launch two tasks in one worktree or call run-state lease from child workers."],
    parameters: Type.Object({
      tasks: Type.Array(Type.Object({
        worker: Type.String(), task: Type.String(), worktree: Type.String(), base: Type.String(),
        paths: Type.Array(Type.String()),
      }), { minItems: 1, maxItems: 4 }),
    }),
    async execute(_id, params, signal, onUpdate) {
      const result = await runWorkers(params.tasks, {
        signal,
        onUpdate: ({ active, completed, total }) => onUpdate?.({
          content: [{ type: "text", text: `TRI workers: ${completed}/${total} complete, ${active} active` }], details: {},
        }),
      });
      const failed = result.results.filter((worker) => !worker.successful);
      const summary = `${result.actualMode} via ${result.backend}; peak ${result.peakWorkers}; ${result.results.length - failed.length}/${result.results.length} succeeded\n\n${result.results.map((worker) => `### ${worker.worker} / ${worker.task} (${worker.exitCode}, ${worker.stopReason ?? "no stop reason"})\n${worker.output || worker.stderr || "(no output)"}`).join("\n\n")}`;
      if (failed.length) throw new Error(summary);
      return { content: [{ type: "text", text: summary }], details: result };
    },
  });

  pi.registerTool({
    name: "tri_question",
    label: "TRI Question",
    description: "Ask one owner decision as a selectable question. Use only when repository evidence cannot decide it.",
    parameters: Type.Object({
      question: Type.String(),
      options: Type.Array(Type.String(), { minItems: 2, maxItems: 6 }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) throw new Error("tri_question requires interactive or RPC mode");
      const answer = await ctx.ui.select(params.question, params.options);
      return { content: [{ type: "text", text: answer ?? "User cancelled the decision." }], details: { answer } };
    },
  });
}
