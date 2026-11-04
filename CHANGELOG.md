# Changelog

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
