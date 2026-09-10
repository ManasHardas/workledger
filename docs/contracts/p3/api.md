# P3 API additions (frozen 2026-09-09)

```yaml
GET  /api/jobs?status                              → Job[] newest first
POST /api/jobs/scan                                → { orphaned: n, queued: m }
POST /api/jobs/repair       body { session: ulid, extract?: boolean, consent?: boolean }
                                                   → Job (202); extract without consent → 409 { code: "consent-required", estimate }
POST /api/jobs/backfill     body { since, concurrency?, extractFallback?, consent: boolean }
                                                   → { jobs: Job[], estimate } (202); dry estimate when consent is false (200)
POST /api/jobs/:id/cancel                          → Job
POST /api/jobs/:id/retry                           → Job
GET  /api/sessions/:ulid/excerpt?cp=<n>            → { cp, offset: [from, to], turns: Turn[] } where
                                                     Turn = { role: "user"|"assistant", text: string, tools: number }
                                                     read from the transcript on this machine; 404 if the file is gone;
                                                     tool inputs/outputs are counted, not returned
SSE  job.changed { id, status }                    added to /api/events
```

`Job` = the `jobs` row from `docs/contracts/p3/cli.md`. Excerpts are served from
`~/.workledger/cache/` after a first render from the transcript; nothing under `.workledger/` ever
contains transcript text. `LedgerSource` gains `listJobs`, `scan`, `repair`, `backfill`, `cancelJob`,
`retryJob`, `excerpt(ulid, cp)`; `capabilities.provenance` becomes true for `LocalServerSource`.
