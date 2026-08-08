# Releasing Captiono

Captiono releases are created automatically by GitHub Actions when a semantic version tag is pushed.
No browser interaction is required.

## Prepare a version

1. Update the same version in `package.json`, `package-lock.json`, and `extension/manifest.json`.
2. Add the new section to `CHANGELOG.md`.
3. Add `.github/release-notes/vX.Y.Z.md`.
4. Run:

   ```sh
   npm run build:extension
   npm test
   ```

5. Commit and push the release changes to `main`.

## Publish

Create and push an annotated tag:

```sh
git tag -a vX.Y.Z -m "Release Captiono vX.Y.Z"
git push origin vX.Y.Z
```

The `Release Captiono` workflow then:

1. verifies that the tag, package version, and extension manifest version match;
2. installs dependencies and runs the full test suite;
3. builds a fresh extension ZIP and verifies its archived contents;
4. creates a SHA-256 checksum;
5. publishes the GitHub Release with the ZIP, checksum, and prepared notes.

Do not replace an asset attached to an already published version. Publish a new patch version so
the same version number always identifies the same bytes.
