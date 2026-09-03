# Contributing

Thanks for helping. This is a small app with a narrow purpose: turn lecture
material into editable flashcards a student can trust and export. Please keep
it that way.

## Ground rules

- **Small and calm.** No accounts, payments, social features, spaced
  repetition, dashboards, or analytics. Open an issue first if you think one
  of those is needed.
- **Honest cards.** Anything that reaches the student must pass the strict
  schema, the duplicate filter, and the "excerpt exists in the source" check.
  Never weaken those to make output look better.
- **No secrets in code.** API keys come from environment variables only. Never
  commit `.env.local`. Never use a personal login, session, or OAuth token
  inside the app.
- **Lecture text stays private.** Do not log it, store it, or send it anywhere
  except the configured provider.

## Setup

```bash
npm install
cp .env.example .env.local   # optional; sample mode works with no env file
npm run dev
```

## Before you open a pull request

```bash
npm run check   # lint + typecheck + tests
```

All three must pass. Add a test for every bug fix (the `regressions.test.ts`
file shows the pattern: name the bug, prove the failure, prove the fix).

## Where things live

See `CLAUDE.md` for the folder map, the provider boundary, and the data
contract. In short:

- `src/lib/flashcards/` — schema, provider interface, mock and Anthropic
  providers, generation pipeline
- `src/lib/` — text handling, PDF extraction, CSV export, upload checks,
  rate limit, page state reducer
- `src/app/api/generate/route.ts` — the one API route
- `src/components/` — the form and the card editor
- `src/lib/__tests__/` — vitest suites and fixtures

## Adding a provider

Implement `FlashcardProvider` from `src/lib/flashcards/provider.ts`, set
`sendsTextExternally: true`, read your key from the environment, return raw
cards without ids, and register the name in `getProvider()` in
`service.ts`. Add tests that inject a fake HTTP layer rather than calling the
real API.

## Test corpus

`test/fixtures/` holds one real open-access paper (CC BY 4.0). You can drop
other PDFs in that folder for local testing; they are ignored by git. Do not
add copyrighted papers to the repo.

## Reporting bugs

Include: what you uploaded or pasted (or a description if it is private),
which provider mode was on, what you expected, what happened, and the
`event` line from the server log if you have it. Never paste an API key.
