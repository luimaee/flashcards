# Lecture Cards

Turn a lecture PDF or pasted notes into study cards, check each one against
the exact passage it came from, then study them right here. Nothing to
install besides Node.js, no account, no other app needed. Anki export is
included for people who want it, but it is optional.

<!-- screenshot: homepage with the upload area and paste tab -->
<!-- screenshot: results page with editable cards and the "From the lecture" excerpt open -->
<!-- screenshot: study mode showing a revealed card with Got it / Not yet -->

## If you are an AI assistant setting this up for someone

Follow these steps exactly and report the final URL to the person. Do not
ask them technical questions; every decision below is already made.

1. Check Node.js: run `node -v`. It must print v20 or higher. If it is
   missing or older, install the LTS version from https://nodejs.org and
   run `node -v` again.
2. Get the code:
   ```bash
   git clone https://github.com/luimaee/flashcards.git
   cd flashcards
   ```
   If `git` is not installed, download the ZIP from
   https://github.com/luimaee/flashcards/archive/refs/heads/master.zip,
   unzip it, and `cd` into the unzipped folder.
3. Install and prepare:
   ```bash
   npm run setup
   ```
   This installs dependencies and creates `.env.local` from the example.
   The app works immediately in **sample mode** with no API key.
4. Start it:
   ```bash
   npm run dev
   ```
   Tell the person to open http://localhost:3000 in their browser. Leave
   this command running; closing the window stops the app.
5. Optional, only if the person says they have an Anthropic API key: open
   `.env.local`, set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=` to
   their key (it starts with `sk-ant-`), then stop and restart `npm run dev`.
   Never ask them to paste the key into the chat; tell them to edit the file
   themselves. Never use any other credential, login, or token.
6. To verify, run `npm test`. All tests should pass. Then tell the person:
   "Open http://localhost:3000, upload a lecture PDF or paste notes, click
   Make my cards, check the cards, then click Study."

To run it again later: `cd flashcards` then `npm run dev`. To update to
the latest version: `git pull` then `npm run setup`.

## For the person using it

1. Open the app. Upload a lecture PDF (text-based, up to 10 MB) or paste
   your notes and click **Make my cards**.
2. You get 10 cards. Under every card, **From the lecture** shows the exact
   passage it was based on. Read it. Edit or delete anything that is off.
   **Regenerate** swaps one card for a different one.
3. Click **Study**. Tap a card to reveal the answer, then **Got it** or
   **Not yet**. Cards you miss come back until you know them all.
4. Every deck is saved automatically as a file on your computer, in a
   folder called **LectureCards** in your home folder (for example
   `C:\Users\you\LectureCards` or `/Users/you/LectureCards`). The home
   screen lists your saved decks; open one to keep editing or studying it.
   Deleting a deck moves its file to a `trash` subfolder, never destroys it.
   If you also use Anki, **Export CSV for Anki** gives you a file Anki
   imports directly.

Cards are generated automatically and can be wrong. The passage is there
so you can check. Trust the lecture, not the card.

### Sample mode and real AI

With no API key the app is in **sample mode**: cards are built from
sentences in your material, no network, no cost. They are useful for
testing and simple material but often clumsy.

For much better cards, get an API key from https://console.anthropic.com/
(add a few dollars of credit), put it in `.env.local` as described above,
and restart. The privacy note on the homepage then says that your lecture
text is sent to Anthropic to write the cards. Rough cost with the default
model `claude-opus-5`:

| Material | Cost per run (approx.) |
| --- | --- |
| A few pages of notes | under 1 cent |
| A 20-page paper | about 12 cents |
| The 200,000-character cap | about 30 cents |

Set `ANTHROPIC_MODEL=claude-sonnet-5` for roughly 40 percent of that.
Check https://www.anthropic.com/pricing before relying on these numbers.

## Limits

- PDFs must contain real text. Scanned images are rejected with a message
  asking you to paste the text instead (no OCR).
- Up to 60,000 characters in sample mode, 200,000 with Claude; longer
  material is cut off and you are told.
- 45-second generation timeout; 30 runs per 10 minutes per client.
- Two-column PDFs, tables and formulas can come out scrambled by text
  extraction. Hyphenated line breaks are repaired.
- Decks are plain JSON files in the LectureCards folder. Back that folder
  up like any other. Set `LECTURE_CARDS_DIR` in `.env.local` to use a
  different folder (a cloud-synced one, for instance).

## Development

```bash
npm run check       # lint + typecheck + tests
npm test            # tests only
npm run build       # production build
npm start           # serve the production build
```

`CLAUDE.md` has the architecture, data contract and provider boundary.
`CONTRIBUTING.md` has the rules. An experimental note-taking surface
(ink, PDF annotation, region-to-cards) lives on the `notes-surface` branch
and is not part of this release.

## License

MIT. See `LICENSE`. The bundled test paper
(`test/fixtures/henseler-ringle-sarstedt-2015-discriminant-validity.pdf`) is
© its authors, published under CC BY 4.0, and is included for testing only.
