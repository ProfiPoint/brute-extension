# Chrome Web Store Listing — FEL CTU BRUTE Deadline Manager

> Last Updated: 2026-09-26

## Store Listing

**Extension Name** [REQUIRED]
FEL CTU BRUTE Deadline Manager

**Short Description** [REQUIRED]
Manage homework deadlines, track completion stats, monitor plagiat incidents, and toggle Classic UI on FEL CTU BRUTE.

**Detailed Description** [REQUIRED]
FEL CTU BRUTE Deadline Manager enhances the student experience on the Czech Technical University (CTU / ČVUT FEL) BRUTE course platform (`brute.fel.cvut.cz` and `cw.felk.cvut.cz`).

Key Features:
- Task State Workflow: Assign and toggle status for upcoming events and homework assignments (To-Do, Completed, Highlighted, Cancelled, Default) across both the updated Bootstrap 5 BRUTE UI and the classic UI.
- Classic BRUTE UI (Old Style) Toggle: Optionally switch the new BRUTE interface back to the classic Bootstrap 3 look, colors, compact spacing, and element positions directly from the extension popup.
- Plagiat Incident Alert Monitor: Automatically detects and hides navbar warning banners on BRUTE, storing incident stats safely in your extension dashboard.
- Live Statistics Dashboard: Click the extension icon anytime to view total tracked homeworks, completion breakdown of active tasks, and extension version.
- Data Management: Easily reset or delete your local task tracking data with one click.
- Backwards Compatible: Works smoothly with your existing saved deadlines and states across both old and new BRUTE domains.

How to use:
1. Open any BRUTE course or student page (`brute.fel.cvut.cz/brute/student/*` or `cw.felk.cvut.cz/brute/student/*`).
2. Click the gear icon (`⚙️`) on any course card or deadline panel header to reveal and cycle through status icons for deadlines.
3. Click the extension icon in your browser toolbar to open the popup dashboard, review your progress stats, or toggle "Classic BRUTE UI (Old Style)".

Privacy & Permissions:
All data is stored locally in your browser (sync/local storage). No personal data or browsing history is collected or sent to external servers.

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Provides task management workflows, optional classic UI styling, and plagiat alert monitoring for FEL CTU BRUTE student pages.

**Primary Language** [REQUIRED]
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | icons/brute128.png |
| Small Icon | 16×16 PNG | ✅ Ready | icons/brute16.png |
| Medium Icon | 48×48 PNG | ✅ Ready | icons/brute48.png |
| Large Icon | 96×96 PNG | ✅ Ready | icons/brute96.png |

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| storage | permissions | Required to store user task completion statuses, UI style preferences, and plagiat monitoring logs locally across sessions. |
| https://brute.fel.cvut.cz/brute/student/* | host_permissions | Required to inject deadline management controls, optional classic UI styles, and detect plagiat alerts on the new FEL CTU BRUTE student portal. |
| https://cw.felk.cvut.cz/brute/student/* | host_permissions | Required for backwards compatibility on the legacy FEL CTU BRUTE student portal domain. |
| https://cw.fel.cvut.cz/brute/student/* | host_permissions | Required for FEL CTU BRUTE student portal alias domain support. |
| https://brute.felk.cvut.cz/brute/student/* | host_permissions | Required for FEL CTU BRUTE student portal alias domain support. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Distribution

**Visibility**: Public
**Regions**: All regions
**Pricing**: Free

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.2 | 2026-09-26 | Added support for the new BRUTE UI (`brute.fel.cvut.cz`, Bootstrap 5 cards & responsive wrappers), added a popup toggle to restore the Classic BRUTE UI (Old Style & Layout), and automatically updated footer copyright year and `BRUTE++` branding. | Ready |
| 1.1 | 2026-08-21 | Added popup dashboard, plagiat incident detection and banner removal, stats visualization, data reset. | Published |
| 1.0 | 2026-08-20 | Initial release with task status cycling (Done, Todo, Highlight, Cancel). | Published |
