# Privacy

Apple Corp Focus Machine is a local Chrome extension. It does not include analytics, advertising, remote accounts, or a hosted backend.

The extension stores settings, timer checkpoints, reward counts, claim identifiers, and recent activity in Chrome extension storage on the user's device. Recent activity can include the hostname of a blocked site that ended a focus block, because that information is needed to explain the interruption. The extension does not upload browsing history or page contents.

The extension receives tab and navigation events and reads active-tab URLs to check focus sessions and whether starting or resuming is allowed. It can also query tab URLs to reuse its existing settings page. It does not read page contents. Website rules remain in local extension storage; the default list can be edited. USB collection sends a claim to a locally connected Arduino only after the user selects **Collect**.

The manifest requests `tabs` and `webNavigation` for website checks, `storage` for local state, `alarms` for timing, `notifications` for reminders, `idle` for lock detection, and `offscreen` for sound and the optional USB worker. These browser permissions are broader than the focus checks themselves. USB access additionally requires the user's device selection. Chrome and connected hardware may have their own logs outside this project.

To remove locally stored data, remove the extension from Chrome or clear its extension storage in Chrome's developer tools. This project does not control Chrome's own browsing-data retention.
