# Changelog

## 0.6.0 — 2026-11-10

- Added on-device camera attention monitoring to focus sessions, enabled by default with a setting to turn it off. Added setup calibration and a practice flow for head turns and leaving the frame.
- Added visible countdown windows for look-away and blocked-site grace periods, and a paused notice when looking away exceeds its deadline.
- Added separate lower threshold for downward head tilt.
- Retry browser-state reads during normal tab/window changes instead of treating transient activity races as monitor failures.
- Pause the session and show a recovery prompt if camera access fails or frames stop arriving.
- Kept the existing session, reward, website, logo, and Arduino release behavior.


## 0.5.5 — 2026-11-04

- Added `firmware/FocusMachineServo`, Arduino Uno firmware that drives the dispenser servo and confirms each treat with the chute sensor. It stays in LED test mode until the servo positions are calibrated. It compiles for the Uno; it has not yet run on the real machine.
- Added `firmware/mac-upload.sh` to compile and upload the firmware from macOS.
- The release ZIP now includes the `firmware` folder.
- The incompatible-firmware message now points to the servo sketch. No timer, reward, or website behavior changed.

## 0.5.4 — 2026-11-04

- Replaced the extension logo with the Apple Corp padlock apple: new toolbar and extension icons at 16/32/48/128 px, and a matching header mark in the popup and website rules page.

## 0.5.3 — 2026-11-01

- Added an optional on-page ten-second countdown with explicit permission for blocked domains only. Denying access leaves the timer, popup countdown, badge, and supported browser notifications available.
- Added a manual **Finish & take a break** transition after the focus goal, alongside **Finish without break**. Early finish and duplicate transitions cannot create extra rewards or restart a break.
- Fixed the Pomodoro label advertising a nonexistent next reward after its single reward had been earned.
- Made Quiet Flow's next-reward countdown and this-run/available reward counts clearer.
- Added explicit mode descriptions, an autosave retry action, and stable preset elements during polling.
- Preserved schema-5 balances, settings, history, and the existing pause, grace, and reward rules. No new hardware behavior is claimed.

## 0.5.2 — 2026-10-28

- Added a ten-second grace period when a focused tab enters a blocked website.
- Frozen focus time during the grace period; leaving in time resumes the same session.
- Kept the grace deadline when switching between blocked hosts.
- Ended the session and cleared incomplete progress when the grace period expires, while preserving earned rewards.
- Added browser notifications and an attention badge for the grace period.
- Updated documentation and release metadata for the public Apple Corp repository.

- Included the previously unreleased Quiet Flow fix: each full user-selected interval earns another reward; popup labels show the actual count.
