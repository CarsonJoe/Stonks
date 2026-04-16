# Stonks

Local-first iPhone-oriented investment thesis journal.

## Current foundation

- Create a thesis with summary, invalidation, benchmark, horizon, and first assumption.
- Log executed trades directly into the thesis timeline.
- Add follow-up assumptions and review notes over time.
- Store everything locally in IndexedDB.
- Probe passkey/Face ID support, storage persistence, and market data APIs.

## GitHub Pages deploy

1. Push this repo to GitHub.
2. In repository settings, set **Pages** to deploy from **GitHub Actions**.
3. The included workflow publishes the built app from `main`.

### Base path

- For a normal project Pages site, the workflow defaults to `/{repo-name}/`.
- If you use a custom domain or a user/org root site, set a repository variable named `VITE_BASE_PATH`.
- Example values:
  - `/<repo-name>/`
  - `/`

## iPhone install

1. Open the deployed site in Safari.
2. Tap **Share**.
3. Tap **Add to Home Screen**.
4. Launch Stonks from the new icon.

## Notes

- Passkeys are origin-specific. If you switch from localhost to GitHub Pages or a custom domain, register a new local passkey inside the app.
- Market API tokens are only stored on-device in browser storage. There is no server-side secret handling in this version.
