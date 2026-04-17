# Stonks

A personal investment thesis journal that holds you accountable to your thinking — not just your returns.

## What it does

Most trading apps track what you did. Stonks tracks what you thought, and whether you were right.

You write a thesis: a stock, a direction, a conviction level, a time horizon, and the reason you believe it. You describe what would prove you wrong. Then you either log a real trade or just record the idea without committing capital. Either way, the app starts watching.

Over time, Stonks compares the stock's actual movement to your thesis. It tracks whether your supporting assumptions are holding up or breaking down. It notifies you when the price drifts outside what your thesis would predict — so you can decide if the market is wrong, or if you are.

The goal is not just to know your P&L. It's to understand whether your thesis had merit regardless of outcome.

## Beating the average, not the dollar

Stonks deliberately avoids measuring performance in raw dollar terms. Instead, every thesis is benchmarked against an index or ticker of your choice — SPY, QQQ, BTC, whatever makes sense for the trade.

The reason: a thesis that says "this stock will go up" is trivially confirmed during a bull run and unfairly punished during a crash. Measuring against a dollar baseline lets inflation, interest rate cycles, and geopolitical noise take credit for (or blame for) your thinking. That's not useful.

The real question is: did your pick beat the alternative? If the whole market rose 20% and your stock rose 15%, you underperformed despite being nominally profitable. Stonks shows you that clearly, continuously.

## How the tracking works

When you create a thesis, you set:

- **Symbol** — the stock or asset you're watching
- **Direction** — long or short
- **Conviction** — 0 to 100
- **Destination** — your expected return target
- **Time horizon** — how long you expect it to take
- **Error band** — how much uncertainty you're willing to accept (expressed as a standard deviation)
- **Benchmark** — what you're measuring against
- **Invalidation** — what would tell you the thesis is wrong

The app models your expected return as a probability distribution that evolves over time. As the thesis matures, the band narrows. You can see at any point whether the stock is tracking inside your predicted range or diverging from it. When it crosses a significant percentile boundary, you get a notification.

This isn't a trading bot or signal service. It's a mirror. You make the calls. Stonks just makes sure you remember what you said.

## All data stays on your device

There is no backend. No account. No server. Everything — your theses, trades, assumptions, reviews, and market snapshots — is stored locally in your browser's IndexedDB. Your API keys (Twelve Data, for market data) never leave your device.

This means:

- Nothing about your portfolio, positions, or thinking is transmitted to anyone
- The app works offline for everything except live market data
- You own your data completely — but you're also responsible for it

There's no export button yet, no cloud sync, no backup service. If you clear your browser storage, your data is gone.

## Stability and self-hosting

Stonks is a PWA deployed on GitHub Pages. The hosted version at the project URL may change at any time — features get added, schemas get migrated, the UI shifts. Because all data lives in your browser, a schema migration in a new version could affect how your existing data is read. The app has built-in migration logic, but it's not bulletproof, and there's no rollback mechanism.

**If you want stability, clone the repo and self-host it.** Pin a commit you trust, build it yourself, and serve it from your own domain or localhost. That way, you control when (or whether) you update. The app is entirely static — it's just HTML, CSS, and JavaScript. Any static host works.

```bash
git clone https://github.com/carsonjoe/stonks.git
cd stonks
npm install
npm run build
# serve the dist/ folder from any static host
```

For local development:

```bash
npm run dev
```

## Installing as a mobile app (iPhone)

1. Open the site in Safari
2. Tap **Share → Add to Home Screen**
3. Launch Stonks from your home screen

It runs fullscreen with no browser chrome, like a native app.

## GitHub Pages deploy (for forks)

1. Push your fork to GitHub
2. In repository settings, enable **Pages** → deploy from **GitHub Actions**
3. The included workflow builds and publishes on every push to `main`

If you're deploying to a project subdomain (not a root domain), set a repository variable `VITE_BASE_PATH` to match:

- `/<repo-name>/` for a project Pages site
- `/` for a custom domain or user/org root site

## Passkeys

Stonks supports Face ID / Touch ID via WebAuthn passkeys for local device security. Passkeys are origin-specific — if you switch from localhost to your deployed domain (or vice versa), you'll need to register a new passkey inside the app's settings.

## Contributing

The codebase is React + TypeScript, built with Vite. The database layer is Dexie (IndexedDB wrapper). There's no backend to worry about — every feature lives in the client.

A few areas where contributions are most valuable:

- **Data export / backup** — there's currently no way to snapshot or restore your data
- **Notification delivery** — reminders are stored but browser push requires more plumbing
- **Additional chart types** — the thesis projection and alpha charts work but there's room to grow
- **Mobile UX polish** — the app is built for iPhone but edge cases exist

Open an issue before starting a large feature so we can align on approach.
