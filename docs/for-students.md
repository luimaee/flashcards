# Lecture Cards: a five-minute guide for students

You do not need to know anything about code. Pick one of the two ways below
to open the app, then follow "Your first study session".

## Way 1: use a link someone deployed for you (easiest)

If a friend put the app online, they will give you a link that looks like
`https://something.vercel.app`. Open it in Safari on your iPad or in any
browser. Tap the share icon, then **Add to Home Screen**, so it opens like an
app. That is it. Skip to "Your first study session".

## Way 2: run it on your own computer

This takes about ten minutes the first time and thirty seconds after that.

1. **Install Node.js.** Go to https://nodejs.org and download the "LTS"
   version. Run the installer and accept the defaults. Node is the program
   that runs the app.
2. **Download the app.** Go to https://github.com/luimaee/flashcards, click
   the green **Code** button, then **Download ZIP**. Unzip it somewhere easy
   to find, like your Desktop. (If you know git: `git clone` works too.)
3. **Open a terminal in that folder.**
   - Windows: open the unzipped folder, click the address bar at the top,
     type `cmd`, press Enter.
   - Mac: open Terminal, type `cd ` (with a space), drag the folder into the
     window, press Enter.
4. **Install and start.** Type these two lines, pressing Enter after each.
   The first one runs once and takes a minute.

   ```
   npm install
   npm run dev
   ```

5. **Open the app.** In your browser go to http://localhost:3000

Next time, only steps 3, 4 (just `npm run dev`) and 5.

To use it on an iPad while it runs on your laptop, both on the same Wi-Fi:
start it with `npm run dev -- --hostname 0.0.0.0`, find your laptop's
address (Windows: type `ipconfig`, look for "IPv4 Address"; Mac: System
Settings, Wi-Fi, Details), and open `http://THAT-ADDRESS:3000` on the iPad.

## Your first study session

1. Tap **Notes** (top of the homepage).
2. Type a notebook name for your course, tap **Add**.
3. Either tap **Import PDF** and pick one lecture, or tap **New note** and
   type or handwrite your notes.
4. Tap **Select**, drag a box over the part you want to learn (typed text
   or the PDF text; handwriting is not read yet).
5. Tap **Make cards from this**.
6. Read each card. Tap **From the lecture** under a card to see the exact
   passage it came from. Fix anything that is off. Delete anything useless.
7. Tap **Study**. Tap a card to reveal the answer, then **Got it** or
   **Not yet**. Cards you miss come back until you know them all.

Start with one page of one lecture. Ten minutes, one win.

## Things to know

- **Your notes stay on this device**, in this browser. Nothing is uploaded.
  If you clear the browser's data, they are gone. Once a week, tap
  **Export all notes to a file** on the Notes page and keep that file
  somewhere safe. **Import a notes file** brings it back, on any device.
- **Search everything** with Cmd+K (Mac) or Ctrl+K (Windows). You never
  have to scroll through pages to find something.
- **Cards can be wrong.** They are generated. The passage under each card is
  there so you can check. Trust the lecture, not the card.
- **Sample mode vs real AI.** Without an API key, cards are simple sentence
  flips ("What is X?"). With a Claude API key set up by whoever runs the
  app, cards are much better. Ask them.
- **Anki users:** on any deck, tap **Export CSV for Anki** and import the
  file in Anki. Optional; the built-in Study works on its own.
- **Handwriting feel** can be tuned at `/ink-test` if letters look mushy.
