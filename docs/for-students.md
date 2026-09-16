# Lecture Cards: the two-minute version

You do not need to know anything about code.

## Get it running

Easiest: paste this into ChatGPT, Claude, or whatever AI you use, and let it
walk you through it. It knows what to do.

> Set up this app on my computer and tell me when it is ready:
> https://github.com/luimaee/flashcards

Doing it yourself instead: install Node.js (LTS) from https://nodejs.org,
download the ZIP from the GitHub page (green **Code** button), unzip it, open
a terminal in that folder, and run `npm run setup` then `npm run dev`. Open
http://localhost:3000.

## Use it

1. Upload one lecture PDF, or paste your notes. Click **Make my cards**.
2. Read the cards. Under each one, **From the lecture** shows the passage it
   came from. Fix or delete anything wrong.
3. Click **Study**. Tap to reveal, then **Got it** or **Not yet**. Missed
   cards come back until you know them.

Start with one lecture. Ten minutes, one win.

## Things to know

- Every deck you make is saved automatically in a folder called
  **LectureCards** in your home folder. The home screen lists them; open
  one to keep studying. Back that folder up like any other.
- Cards can be wrong. The passage is there so you can check.
- Without an API key you get simple "sample" cards. Ask whoever set it up
  about connecting Claude for better ones.
- If you use Anki, **Export CSV for Anki** works. If you do not, ignore it.
