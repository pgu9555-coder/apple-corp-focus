# Changelog

## 0.5.2 — 2026-10-28

- Added a ten-second grace period when a focused tab enters a blocked website.
- Frozen focus time during the grace period; leaving in time resumes the same session.
- Kept the grace deadline when switching between blocked hosts.
- Ended the session and cleared incomplete progress when the grace period expires, while preserving earned rewards.
- Added browser notifications and an attention badge for the grace period.
- Updated documentation and release metadata for the public Apple Corp repository.

- Included the previously unreleased Quiet Flow fix: each full user-selected interval earns another reward; popup labels show the actual count.
