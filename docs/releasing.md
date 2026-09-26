# Releasing CodeFlow

CodeFlow packages use one shared version. A release publishes the scoped packages first and `@codeflow/cli` last so npm can resolve every runtime dependency.

## Before You Release

1. Update the version in every publishable package manifest.
2. Move user-visible changes from `Unreleased` into a dated section of [CHANGELOG.md](../CHANGELOG.md).
3. Run the complete release check locally:

   ```bash
   npm run release:check
   npm run release:publish -- --dry-run
   ```

4. Confirm that the npm account owns the `@codeflow` scope. The CLI package publishes as `@codeflow/cli` and installs the `codeflow` command.
5. Add an `NPM_TOKEN` repository secret with publish permissions. Trusted publishing also needs the workflow's `id-token: write` permission, which the release workflow already requests.

## Publish

Open the GitHub Actions **Release** workflow and first run it with **dry_run** enabled. After reviewing the checks, run it again with **dry_run** disabled. The workflow builds, tests, verifies each package, then publishes packages in dependency order with npm provenance.

After npm publishes successfully, create a GitHub release and use the matching changelog section as its release notes.
