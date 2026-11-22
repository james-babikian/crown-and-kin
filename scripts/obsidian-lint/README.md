# Official Obsidian lint tool

`eslint-plugin-obsidianmd` checks `src/` against the rules of the Obsidian plugin review. It is not part of `npm run lint` and it is not in `package.json`. It runs in CI as the job `obsidian-lint` (`.github/workflows/ci.yml`) and on request on the development computer.

The tool is installed in a folder **outside** the checkout, with its own pinned helpers, so that it cannot change the dependencies of the project. The config `eslint.config.mjs` in this folder loads the plugin from the folder named in `OBSIDIAN_LINT_DIR`.

## Local run (Git Bash, from the repository root)

```sh
TOOL="$TEMP/obsidian-lint"
mkdir -p "$TOOL" && (cd "$TOOL" && npm init -y && npm install --legacy-peer-deps --no-audit --no-fund eslint-plugin-obsidianmd@0.6.0 eslint@9.39.5 typescript-eslint@8.73.0 @eslint/js@9.39.5 @eslint/json@0.14.0 obsidian@1.14.4 typescript@5.9.3 jiti@2.7.0)
OBSIDIAN_LINT_DIR="$TOOL" "$TOOL/node_modules/.bin/eslint" --config scripts/obsidian-lint/eslint.config.mjs src
```

## Local run (PowerShell, from the repository root)

```powershell
$tool = Join-Path $env:TEMP 'obsidian-lint'
New-Item -ItemType Directory -Force $tool | Out-Null
Push-Location $tool
npm init -y
npm install --legacy-peer-deps --no-audit --no-fund eslint-plugin-obsidianmd@0.6.0 eslint@9.39.5 typescript-eslint@8.73.0 '@eslint/js@9.39.5' '@eslint/json@0.14.0' obsidian@1.14.4 typescript@5.9.3 jiti@2.7.0
Pop-Location
$env:OBSIDIAN_LINT_DIR = $tool
& "$tool\node_modules\.bin\eslint.cmd" --config scripts/obsidian-lint/eslint.config.mjs src
```

Install the tool one time; later runs need only the last command. The project needs its own `node_modules` (`npm ci`), because the type-aware rules read the types of `obsidian` and `node` from there. A run takes about 20 seconds.

## Result

A clean run has 0 errors. Warnings do not fail the run. Two warnings stay, each with a reason (0.6.2, D382):

- `@typescript-eslint/no-deprecated` on `keyCode === 229` (5 sites: `list-window.ts`, `picture-picker.ts`, `sheet-parts.ts`, `succession-rules-ui.ts`, `window-shell.ts`). It is the IME check: a key press that the input method handles has `isComposing` false on Safari for the confirming key, and only `keyCode` 229 marks it. No other property does this on iPhone Safari, so the check stays.
- `no-restricted-globals` on `fetch` in `save-font.ts` (`pageFontEnv.read`). It reads a font file at an `app://` address (a CSS snippet's `@font-face`) for the saved PNG. `requestUrl` sends http and https requests through the network layer and cannot read an `app://` address. The `fetch` of the page can, and it is the same request that the page made to load the font. Nothing leaves the computer.

The tool is version 0.6.0 of the plugin (0.6.0 notes: `docs/configuration.md`, "Upgrading to 0.6.0"). Its recommended config sets `@typescript-eslint/no-deprecated` to a warning by itself, so the project config does not repeat it.

No rule is switched off in the project config. `@codemirror/state` and `@codemirror/view` are listed in `devDependencies` (exact versions of the `obsidian` peer range) so that `import/no-extraneous-dependencies` is satisfied. The bundle still marks them as external (`esbuild.config.mjs`): Obsidian gives them at run time.
