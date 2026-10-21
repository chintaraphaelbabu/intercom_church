# 14: Installable release and one-click server

**What to build:** The Operator app ships as a signed APK that installs on the OnePlus and both tablets. A single launcher on the Director's laptop applies firewall rules, starts LiveKit and the control server, opens the Director page, writes logs, and keeps the laptop awake only while a Room is active. Setup instructions are enough for someone other than the author.

**Blocked by:** 12 — Operator Mixer/Live views and join failure states; 13 — Director Setup/Live views and diagnostics

**Status:** ready-for-agent

- [ ] The signed release APK installs and launches on the OnePlus and both tablets.
- [ ] One launcher applies firewall rules, starts both processes, opens the browser, and writes logs.
- [ ] The laptop stays awake while a Room is active and sleeps normally after it ends.
- [ ] Closing the launcher stops both processes.
- [ ] Setup documentation lets a non-author install the app on a fresh phone and start the server.
- [ ] No developer IP is hard-coded; a manual address exists only under Advanced.
- [ ] The release APK passes the 16 KB page-size alignment check.
