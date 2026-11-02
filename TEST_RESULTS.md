# Apple Corp Focus Machine v0.5.3 verification

## Status

On 2026-11-01, `node --test tests/*.test.js` passed 114 tests with zero failures after review. `node tests/independent-acceptance.mjs` passed seven additional controller checks. These are controlled automated checks, not a claim of real installed-browser or physical-hardware validation.

## Required checks

- Ten-second active blocked-site grace: focus time freezes, a timely leave resumes, host switching keeps the deadline, and expiry clears incomplete progress while preserving earned rewards.
- Quiet Flow earns one reward per full selected focus interval; partial intervals do not carry between manual runs.
- Pomodoro remains capped at one reward per focus session.
- Confirmed emergency pauses and break time are excluded from effective focus time.
- Popup closure does not stop the session; trusted checkpoints protect against restarts and long monitoring gaps.
- Schema-5 balances, claims, sessions, and history are preserved during the upgrade.
- USB claims use unique IDs and do not automatically resend after an uncertain reply.

## v0.5.3 regression checks

- Pomodoro's completed goal does not advertise another reward. Quiet Flow displays time to its next selected interval and waits for authoritative reward confirmation at the boundary.
- Autosave failure exits the Saving state and offers a functioning Retry control. Unchanged polling preserves preset elements and their keyboard focus.
- This-run rewards, available balance, and lifetime earned rewards are labeled separately. Setup and breaks do not show a previous focus run as current.
- Finish & take a break is a manual, goal-guarded transition. Duplicate requests do not restart a break or add a reward; grace expiry prevents the transition. Finish without break remains available.
- Page-warning permission requests are limited to configured blocked hosts. Grant, deny, revoke, and regrant paths are exercised with mocked browser APIs.
- Actual background-module integration injects warnings only with a grant, clears them on safe-tab activation, and continues timing when injection fails.
- The actual banner script is exercised in a VM DOM mock: sender validation, singleton injection, countdown, pagehide/visibility cleanup, expiry wording, and malformed-message rejection.

UI tests run the actual popup script against DOM mocks; these checks do not replace rendered-layout, keyboard, permission-dialog, notification, or screen-reader testing in an installed Chrome extension.

## Boundaries

The automated checks use controlled clocks and mocked browser/serial APIs. Browser notification delivery, content-script injection, and alarm timing depend on Chrome, page restrictions, and the operating system. Real Chrome toolbar behavior, user-granted website permissions, audible output, and long-duration operation remain unverified. No physical Arduino, servo, LCD, sensor, power circuit, speaker output, or candy mechanism is verified by these tests. The included firmware is an LED-only protocol sketch.
