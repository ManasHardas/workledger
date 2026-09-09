# workledger

A local observer for coding-agent sessions. The agent that ran a session writes a short structured
digest at checkpoints — what was done, what remains, what it learned, what it needs from a human —
the ledger lives in your repo under `.workledger/`, and everything carries provenance.

Requires **Node ≥ 22**. The package is a single bundled file with no runtime dependencies.

```bash
npx workledger --version
pnpm add -g workledger      # once published
```

Source, issues and the full design: https://github.com/ManasHardas/workledger
