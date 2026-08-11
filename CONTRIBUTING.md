# Changing tri

tri asks projects to keep a change and its companion files in one commit. This repository holds itself to the same rule, and enforces it mechanically rather than by memory.

## Run before every commit

```bash
node scripts/test-tri.mjs && node scripts/test-v3.mjs && node scripts/test-adapters.mjs && node scripts/check-consistency.mjs
```

Both must pass. The first proves behaviour; the second proves the change reached every artifact that describes it.

## What must move together

A change is not one file. Find the row that matches what you touched and move everything in it, in the same commit:

| You changed | Also update |
|---|---|
| `scripts/tri.mjs` behaviour | `scripts/test-tri.mjs` or `scripts/test-v3.mjs` (test first, watch it fail), README if user-facing, `CHANGELOG.md`, `plugin.json` version |
| A config option | README "Adopting an existing task tree", `docs/guide.html`, `templates/AGENTS-section.md` if an agent must know it, `CHANGELOG.md`, version |
| Added a command | `commands/<name>.md` and `.toml`, README command table, `docs/guide.html` command table, `skills/tri-method/SKILL.md` if it changes the method, `CHANGELOG.md`, every host manifest version |
| Added a host adapter | `scripts/host-capabilities.mjs`, `scripts/tri-host.mjs`, host tests, `docs/host-adapters.md`, `commands/run.md`, `SKILL.md`, README/guide install notes, `CHANGELOG.md`, every host manifest version |
| The method itself | `SKILL.md`, `templates/AGENTS-section.md` (Codex parity), `docs/guide.html`, the SVG diagrams if the loop shape changed |
| Test count | The README claim — `check-consistency.mjs` compares them |

## The version is not optional

Plugin managers decide whether to update from the host manifests. Shipping a change without bumping every manifest means installed copies silently stay behind. Keep `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `gemini-extension.json`, and `package.json` aligned, add the matching `CHANGELOG.md` section, and tag the release.

## What check-consistency.mjs enforces

- Every command file is documented in both the README and the guide.
- Every command file has frontmatter with a description and loads the `tri-method` skill.
- Every config key the script reads is documented in the README.
- Every host manifest has the same current version and that version has a changelog section.
- Every Markdown command has a Codex/Gemini TOML adapter.
- The README's test-count claim matches the tests that exist.
- The cross-agent template still uses the `~/.tri` convention and names the registers.
- Every file the README and guide link to exists.

It cannot check prose accuracy. It checks that the places which must mention a thing do mention it — the failure mode that actually happens, which is a change landing in one file and stopping there.

## Testing

Behaviour changes are test-first: add the failing test to `scripts/test-tri.mjs`, watch it fail, then implement. The suite builds throwaway workspaces in a temp directory, seeds real defects, and asserts the script rejects them. Prompt-only changes (command and skill files) have no automated test — review them by running the command against a real workspace before shipping.
