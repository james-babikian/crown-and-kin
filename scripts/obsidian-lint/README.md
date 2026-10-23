# Official Obsidian lint tool

`eslint-plugin-obsidianmd` checks `src/` against the rules of the Obsidian plugin review. It is not part of `npm run lint` and it is not in `package.json`. It runs in CI as the job `obsidian-lint` (`.github/workflows/ci.yml`) and on request on the development computer.

The tool is installed in a folder **outside** the checkout, with its own pinned helpers, so that it cannot change the dependencies of the project. The config `eslint.config.mjs` in this folder loads the plugin from the folder named in `OBSIDIAN_LINT_DIR`.

## Local run (Git Bash, from the repository root)

```sh
TOOL="$TEMP/obsidian-lint"
mkdir -p "$TOOL" && (cd "$TOOL" && npm init -y && npm install --legacy-peer-deps --no-audit --no-fund eslint-plugin-obsidianmd@0.4.2 eslint@9.39.5 typescript-eslint@8.72.0 @eslint/js@9.39.5 @eslint/json@0.14.0 obsidian@1.12.3 typescript@5.9.3 jiti@2.7.0)
OBSIDIAN_LINT_DIR="$TOOL" "$TOOL/node_modules/.bin/eslint" --config scripts/obsidian-lint/eslint.config.mjs src
```

## Local run (PowerShell, from the repository root)

```powershell
$tool = Join-Path $env:TEMP 'obsidian-lint'
New-Item -ItemType Directory -Force $tool | Out-Null
Push-Location $tool
npm init -y
npm install --legacy-peer-deps --no-audit --no-fund eslint-plugin-obsidianmd@0.4.2 eslint@9.39.5 typescript-eslint@8.72.0 '@eslint/js@9.39.5' '@eslint/json@0.14.0' obsidian@1.12.3 typescript@5.9.3 jiti@2.7.0
Pop-Location
$env:OBSIDIAN_LINT_DIR = $tool
& "$tool\node_modules\.bin\eslint.cmd" --config scripts/obsidian-lint/eslint.config.mjs src
```

Install the tool one time; later runs need only the last command. The project needs its own `node_modules` (`npm ci`), because the type-aware rules read the types of `obsidian` and `node` from there. A run takes about 20 seconds.

## Result

A clean run has 0 errors and 4 warnings: `@typescript-eslint/no-deprecated` on the `keyCode === 229` checks (the IME check; Safari has no replacement). Any error makes the CI job fail.

## Switched-off rules

| Rule | Reason |
|---|---|
| `no-control-regex` | The code refuses control characters in imported text on purpose; the regexes name them. |
| `import/no-extraneous-dependencies` | `@codemirror/state` and `@codemirror/view` come from Obsidian at run time. They are external in the bundle and not in `package.json`. |

`@typescript-eslint/no-deprecated` stays a warning in the config (not an inline disable at each site), so that a new use of a deprecated API shows up at once.
