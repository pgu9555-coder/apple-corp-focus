# Apple Corp Focus Machine v0.5.2 verification

## Status

On 2026-10-28, `node --test tests/*.test.js` passed 77 tests with zero failures after review. `node tests/independent-acceptance.mjs` passed seven additional controller checks. These are controlled automated checks, not a claim of real installed-browser or physical-hardware validation.

## Required checks

- Ten-second active blocked-site grace: focus time freezes, a timely leave resumes, host switching keeps the deadline, and expiry clears incomplete progress while preserving earned rewards.
- Quiet Flow earns one reward per full selected focus interval; partial intervals do not carry between manual runs.
- Pomodoro remains capped at one reward per focus session.
- Confirmed emergency pauses and break time are excluded from effective focus time.
- Popup closure does not stop the session; trusted checkpoints protect against restarts and long monitoring gaps.
- Schema-5 balances, claims, sessions, and history are preserved during the upgrade.
- USB claims use unique IDs and do not automatically resend after an uncertain reply.

## Boundaries

The automated checks use controlled clocks and mocked browser/serial APIs. Browser notification delivery and alarm timing depend on Chrome and the operating system. No physical Arduino, servo, LCD, sensor, power circuit, speaker output, or candy mechanism is verified by these tests. The included firmware is an LED-only protocol sketch.
