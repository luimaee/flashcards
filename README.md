# Lecture Cards

Turn lecture notes into study cards. Upload a lecture PDF or paste your notes,
get 10 editable flashcards with the exact passage each one came from, and
export them as a CSV file that Anki can import.

Private beta. Nothing you upload is stored.

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

With no AI provider configured the app runs in **sample mode**: cards are
built directly from sentences in your material, and nothing leaves your
machine. See `CLAUDE.md` for how the provider boundary works.

## Check it

```bash
npm run check   # lint, type check, tests
```

## Importing the CSV into Anki

1. Click **Export CSV for Anki** on the results page.
2. In Anki: **File → Import**, choose the file.
3. Set the field separator to comma if Anki did not detect it.
4. Map columns: **Front** → Front, **Back** → Back, **Tags** → Tags.
   **Difficulty** and **Source** can be ignored or mapped to extra fields.

The file has a header row; tick "first row is column names" if Anki asks.

## Always review the cards

Cards are generated automatically. They can be wrong, incomplete, or miss
context. Every card shows the lecture excerpt it was based on. Check it.
