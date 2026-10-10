# Brain Battle Arena

Brain Battle Arena is an Android-friendly Progressive Web App (PWA) with a real-time four-player game server. Players can install it from Chrome on Android after it is deployed over HTTPS. It also runs in desktop and mobile browsers.

## How a match works

- Every match has exactly four seats. Public matchmaking starts immediately when four humans are waiting; if fewer arrive, it waits 20 seconds and fills open seats with clearly labeled AI opponents.
- Private rooms use a six-character invite code. The host can start with AI or wait for invited players; choosing wait starts the match when the fourth human joins.
- A match has five quick puzzles and three stages in the final challenge. Each player sees the same puzzle and server deadline. The production timers are 20 seconds for quick puzzles and 25 seconds for final stages.
- Puzzles are drawn from the original server-side bank and include multiple choice, logic, patterns, math, memory, and word answers. Correct answers earn points and a speed bonus; wrong answers earn zero without a penalty. Final stages award more points. Ties share the win.
- The server validates answers, enforces one scored submission per player per puzzle, and computes the scores and winners. Other answers are not shown before the reveal.
- Preset reactions are available. The game has no free-text chat.

## Run locally on Windows

1. Install Node.js 20 or newer from [nodejs.org](https://nodejs.org/). The normal Windows installer includes npm.
2. Open PowerShell in this project folder.
3. Install the packages:

   ```powershell
   npm install
   ```

4. Start the server:

   ```powershell
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000). Keep the PowerShell window open while playing.
6. To test on an Android phone on the same Wi-Fi, find the computer's local IPv4 address with `ipconfig`, then open `http://<computer-ip>:3000` in Chrome. Browser service-worker/PWA installation requires a secure origin; use HTTPS for the install check. Localhost is treated as secure for development, but another device's plain HTTP address is not.

Run the automated multiplayer checks from PowerShell with:

```powershell
npm test
```

The test suite starts a local server with shortened timers so a complete match can be checked quickly. It does not change the 20/25 second production defaults. If you use pnpm instead of npm, run `pnpm install`, `pnpm start`, and `pnpm test`.

## Deploy the Node.js server to Render

This project does not deploy itself or create a hosting account. You will need a GitHub repository that contains this project and a Render account.

1. Push the project to a private or public GitHub repository. Do not commit `.env`, OAuth secrets, or a `SESSION_SECRET`.
2. In Render, choose **New → Web Service**, connect the repository, and select this project folder as the root directory if the repository contains other folders.
3. Choose the Node runtime and enter:

   - **Build command:** `npm install`
   - **Start command:** `npm start`

4. Add an environment variable named `SESSION_SECRET` in the Render service settings. Generate a random value locally, for example with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, and paste it directly into Render. Do not send it in chat or add it to Git. A stable value keeps guest sessions valid across restarts.
5. Leave `PORT` unset; Render supplies it automatically. `GOOGLE_CLIENT_ID` is optional. Save the service and wait for the deploy to finish.
6. Open the Render HTTPS URL and check that `/health` returns JSON with `"ok": true`. Share that URL with players. Chrome on Android can then offer **Install app** or **Add to Home screen** from its menu.

Render's free web services may spin down after inactivity. Consult [Render pricing](https://render.com/pricing) for the current limits and prices before choosing a plan. No paid hosting is required for local development.

## Optional Google sign-in

Guest play works without OAuth setup. The server issues a signed 30-day session token. Without a configured Google client ID, the client explains that Google sign-in is unavailable and guest play remains enabled; the server rejects Google credential exchange with a clear 503 setup message.

To enable Google sign-in:

1. Create an OAuth **Web application** client ID in Google Cloud's credentials settings.
2. Add the exact deployed HTTPS origin to the authorized JavaScript origins for that client.
3. Set the resulting `GOOGLE_CLIENT_ID` in Render's environment settings and redeploy. Keep credentials in the hosting settings, not source code.
4. Verify the Google button and sign-in using your own configured account. The server verifies the returned ID token.

## Project layout and server model

- `public/` contains the responsive interface, original CSS arena artwork, install manifest, 192×192 and 512×512 PNG icons, and service worker.
- `server.js` serves the PWA and runs Socket.IO. The server owns rooms, puzzle answers, deadlines, AI actions, scoring, and match results.
- `test/game.test.js` starts four independent Socket.IO clients and checks complete matches, scoring, reconnect behavior, duplicate submissions, queue fills, private-room controls, PWA responses, and the missing-Google-configuration response.
- Accounts and active game state are held in server memory. Player names/colors are stored in each browser. There is no match-history database, cross-device profile store, or persistent leaderboard.

## Verification and known limits

Verified in the local environment: the Node server starts; all automated tests pass; four independent client sessions finish a full eight-puzzle match on one server; deadlines are identical across those sessions; score updates and winner data are produced; a reconnect resumes an answered round without awarding another score; the short-timer matchmaking test fills seats with AI; private-room wait and start-with-AI paths work; PWA manifest/icons and service-worker assets are served; and Google auth returns a clear setup error when no client ID is configured. A browser smoke check also opened the home page, private lobby, and live game UI with no browser console errors.

Not verified here: installation on a physical Android device, a successful Google OAuth exchange (no OAuth client ID was provided), or play between users over the public internet (the server has not been deployed). Confirm Android installation from the deployed HTTPS URL and test Google sign-in after adding your own OAuth client ID.

Active matches and rooms are stored in memory, so a server restart ends them. This version is designed for one server instance; multiple instances need shared state or a Socket.IO adapter. Production launch should also add persistent accounts/history as needed, abuse controls/rate limits, and operational monitoring.
