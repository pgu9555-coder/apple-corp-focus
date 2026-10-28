# Apple Corp Focus Machine v0.5.2

Apple Corp Focus Machine is an English-only Chrome extension for user-controlled focus sessions, local blocked-site checks, and optional Arduino reward collection. The timer, pause, break, reward, and device actions are available in the popup; **Edit websites** opens the separate website-rules page.

## Install from a release

1. Download the `apple-corp-focus-v0.5.2.zip` asset from the [latest release](https://github.com/pgu9555-coder/apple-corp-focus/releases/latest).
2. Extract it to a stable folder. Find the `extension` subfolder containing `manifest.json`.
3. Open `chrome://extensions` in desktop Chrome and enable **Developer mode**.
4. Choose **Load unpacked** and select that `extension` subfolder.
5. Pin Apple Corp Focus Machine and click its toolbar icon.

Disable an older copy so that two timers are not running at the same time. Updating the same installation preserves schema-5 settings, blocked hosts, balances, claims, sessions, and history. A fresh folder may have separate local settings.

To update an existing unpacked installation, finish or pause the current session, replace the files in its previously loaded extension folder, and click **Reload** on its Chrome extensions card. Check that the popup says **v0.5.2**. Legacy schema 1–4 data follows the one-time reset of rewards and history; settings are retained. Do not import older storage backups.

## Session rules

- Choose any whole-number focus duration from 1–180 minutes and a positive break duration up to 180 minutes. There is no fixed ratio or automatic rest calculation.
- The built-in 25/5 and 50/10 presets can be deleted with their `×` controls. **Save preset** stores a reusable custom pair; the active fields are saved automatically for the next block.
- Start each focus and break manually. Quiet Flow earns one reward for every full selected focus interval. For example, a 1-minute selection earns at 1 and 2 minutes, while a 100-minute selection earns at 100 and 200 minutes. Partial intervals do not carry into a later manual run. Pomodoro is capped at one reward per focus session.
- Finish is unavailable before the focus goal. Cancel requires confirmation, clears incomplete progress, earns no reward, and does not create a break.
- Emergency pause requires confirmation. Paused time is excluded; resume is manual. Closing the popup does not stop a session.
- Quiet Flow does not interrupt at reward milestones. Pomodoro gives a goal reminder. Neither starts a break automatically. A confirmed emergency pause during a website warning cancels that warning; resuming focus still requires leaving blocked sites.
- During focus, an active blocked website starts a ten-second grace period. Focus time is frozen while the warning is active. Leaving any blocked host before the deadline resumes the session; switching between blocked hosts does not restart the countdown. Expiry ends the block, clears incomplete progress, and keeps rewards already earned.
- Browser close, restart, lock, long monitoring gaps, or backwards clock changes pause at the last trusted checkpoint. Short sleep periods cannot always be distinguished from normal browser scheduling, so pause manually before sleep when exact exclusion is required.

## History, sounds, and device claims

Recent activity keeps the latest eight records from a local history of up to 100 events. It includes completed sessions, per-interval rewards, cancellations, warnings, failures, pauses, and claims. Success uses a short ascending cue; blocked-site failure uses a descending cue. Sound can be muted in Preferences.

The reward bank is separate from physical dispensing. After connecting a device, **Collect** sends one unique claim to the Arduino. The claim is persisted before sending and is not automatically resent after a timeout, disconnect, or uncertain reply.

The included `firmware/FocusMachineBankTest/FocusMachineBankTest.ino` is an LED-only Arduino protocol test sketch. It does not drive a servo, LCD, candy dispenser, or feedback sensors. Simulated serial tests verify protocol logic only; physical dispensing, power, sensor feedback, and mechanical jam behavior still require hardware testing.

## Development

```text
npm test
node tests/independent-acceptance.mjs
```

Tests use simulated clocks and browser/serial interfaces. They do not prove a real installed toolbar session, uninterrupted long-duration timing, or physical hardware behavior. See `TEST_RESULTS.md` for the current run and its limits. This repository is released under the MIT License; see `PRIVACY.md` for local data handling.

Pushes and pull requests run the test suite. Maintainers publish a release by updating the version and pushing its matching `v` tag, for example `v0.5.2`; the release workflow tests again, checks the manifest version, and attaches an installable ZIP. Ordinary pushes do not create releases. The firmware and tests are available in the repository/source archives, not the extension-only release asset.
