# Lecture Cards

Turn lecture notes into study cards you can actually trust.

Upload a lecture PDF or paste your notes. You get 10 editable flashcards, each
one showing the exact passage of the lecture it was based on, and a one-click
export to a CSV file that Anki imports directly.

<!-- screenshot: homepage with the upload area and paste tab -->
<!-- screenshot: results page with editable cards and the "From the lecture" excerpt open -->

## Why this exists

Students already have the material. What they lack is time. Most flashcard
tools either make you write every card by hand or hand you AI output you
cannot check. Lecture Cards sits in between: cards are generated, but every
card carries its source excerpt, every field is editable, and nothing is
saved anywhere you did not ask for.

## What it does

- Reads a text-based PDF or pasted text (in memory, never written to disk)
- Generates 10 cards: question, answer, difficulty, tags, source excerpt
- Drops duplicates and any card whose excerpt cannot be found in the source
- Lets you edit, delete, or regenerate any card
- Exports an Anki-ready CSV with proper quoting and Anki header directives
- Runs in **sample mode** with no API key, so you can try it for free

## What it does not do

No accounts, no saved decks, no spaced repetition, no OCR, no mobile app.
Refreshing the page clears your cards. That is on purpose.

## Setup

You need Node.js 20 or newer.

```bash
git clone https://github.com/luimaee/flashcards.git
cd flashcards
npm install
npm run dev
```

Open http://localhost:3000. With no configuration the app runs in sample
mode: cards are built directly from sentences in your material, nothing leaves
your machine, and no key is needed. Sample-mode cards are simple and sometimes
clumsy; they exist so the whole flow can be tested without spending money.

## Connecting the Claude API

Real card generation uses Anthropic's Claude.

1. Create an account at https://console.anthropic.com/ and add a small amount
   of credit.
2. Create an API key there. It starts with `sk-ant-`.
3. Copy `.env.example` to `.env.local` and set:

   ```
   AI_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...
   ```

4. Restart `npm run dev`.

The homepage privacy note switches automatically to say that lecture text is
sent to Anthropic. Never put a personal login, session token, or OAuth token
in that file. Never commit `.env.local` (it is git-ignored).

### Roughly what a run costs

The default model is `claude-opus-5` (about $5 per million input tokens and
$25 per million output tokens at the time of writing). A generation run sends
the lecture text plus a short instruction and gets back about 10 cards.

| Material | Input tokens (approx.) | Cost per run (approx.) |
| --- | --- | --- |
| A few pages of notes (5,000 characters) | 1,500 | under 1 cent |
| A 20-page paper (80,000 characters) | 20,000 | about 12 cents |
| The 200,000-character cap | 50,000 | about 30 cents |

Output is small (a few thousand tokens, a few cents). Regenerating one card
re-sends the whole text, so it costs about the same as a full run. Set
`ANTHROPIC_MODEL=claude-sonnet-5` in `.env.local` for roughly 40 percent of
the price if you prefer. Check current prices at
https://www.anthropic.com/pricing before relying on these numbers.

### Timeouts and limits

- PDFs up to 10 MB, text-based only
- Up to 60,000 characters of text in sample mode, 200,000 with Claude (longer
  material is cut off and you are told)
- 45-second generation timeout
- 30 generation requests per 10 minutes per client (in-memory rate limit)

## Importing into Anki

1. Click **Export CSV for Anki**.
2. In Anki: **File → Import**, choose the file.
3. Anki reads the `#` lines at the top of the file and pre-fills the
   separator, the column names, and the tags column. Check that **Front** and
   **Back** map to your note type's fields.
4. **Difficulty** and **Source** are extra columns. Map them to extra fields or
   ignore them.

The file is UTF-8 with a byte-order mark, comma separated, every field quoted.
Other spreadsheet programs will show the `#` lines as ordinary rows; delete
them there if they bother you.

## Always review the cards

Generated cards can be wrong, incomplete, or miss context. Every card shows
the passage it came from. Open it, check it, edit what is off. The app will
never tell you a card is correct, because it cannot know.

## Known limitations

Found while testing against real open-access marketing papers (see
`test/fixtures/README.md`):

- **Sample mode is a stand-in, not a tutor.** It turns sentences into
  "What is X?" cards. On real papers a few cards per set are still vague
  ("What is the result?"). Connect Claude for real quality.
- **PDF text extraction is imperfect.** Two-column layouts, tables, and
  formulas can come out scrambled. Hyphenated line breaks are repaired;
  formulas rendered with special fonts often are not, and such sentences are
  skipped in sample mode.
- **No OCR.** Scanned PDFs, including ones with a single text cover sheet,
  are rejected with a message asking you to paste the text.
- **Long material is truncated** at the limits above. Paste the section you
  care about for better results.
- **Rate limiting is per server process** and trusts the `x-forwarded-for`
  header. Fine for a small deployment; put a real rate limiter in front for
  anything public.
- **Cards live in the browser tab.** Export before you close it.

## Development

```bash
npm run check       # lint + typecheck + tests
npm test            # tests only
npm run test:watch  # tests in watch mode
```

See `CONTRIBUTING.md` for the rules and `CLAUDE.md` for the architecture,
the data contract, and the provider boundary.

## License

MIT. See `LICENSE`. The bundled test paper
(`test/fixtures/henseler-ringle-sarstedt-2015-discriminant-validity.pdf`) is
© its authors, published under CC BY 4.0, and is included for testing only.
