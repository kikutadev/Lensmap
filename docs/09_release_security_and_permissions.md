# Release Security / Chrome Permission Review

Updated: 2026-08-14

This document records the release-security decisions for the GitHub Releases distribution model. Chrome Web Store publication is not assumed.

## Local API capability boundary

Production startup creates a random 256-bit capability token. The controller passes it to the local Fastify server through `DEEP_READER_CAPABILITY_TOKEN` and stores a copy at `.runtime/capability-token` with owner-only permissions.

The Native Messaging host is the capability broker:

```text
Chrome Extension
  -> Native Messaging: ensure-server
  -> Native Host verifies/starts protected Server
  <- capability token
  -> chrome.storage.session
  -> Authorization: Bearer <capability>
  -> http://127.0.0.1:4317/api/*
```

`GET /api/health` intentionally remains unauthenticated so an extension without a current token can distinguish "server absent" from "server present". All other production HTTP endpoints require the capability. A server restart rotates the token; the extension retries once after `401` by obtaining the new capability through Native Messaging.

Direct development/test startup leaves the capability unset unless `DEEP_READER_CAPABILITY_TOKEN` is explicitly configured. This keeps isolated Fastify tests and the standalone dev workflow simple without weakening production controller startup.

## Chrome permission decision

The production manifest is checked by `npm run extension:permissions:check` after build.

| Permission | Decision | Reason |
| --- | --- | --- |
| `contextMenus` | Keep | Primary user gesture for "Deep Readerで深掘り / 引用に追加". |
| `storage` | Keep | Per-tab extension state and session-only capability storage. |
| `activeTab` | Keep | Temporary access to the explicitly invoked PDF tab and its origin; avoids persistent access to arbitrary websites. |
| `nativeMessaging` | Keep | Required to start/synchronize the local companion Server and capability. |
| `sidePanel` | Keep | Core Chrome Side Panel UI. WXT emits this permission for the side-panel entrypoint. |
| `tabs` | **Removed** | Tabs API methods used by Deep Reader do not themselves require broad `tabs`; sensitive URL access is limited to `activeTab`/host permission. Navigation cleanup now falls back to load-state detection if Chrome withholds a URL. |

## Host permissions

| Host permission | Decision | Reason |
| --- | --- | --- |
| `http://127.0.0.1/*` | Keep | Local Deep Reader API. Chrome match patterns cannot express the intended API path alone, so server-side capability auth is the enforcement boundary. |
| `file:///*` | Keep | Required for user-authorized local PDF reading; Chrome still requires the user to enable file-URL access explicitly. |
| `http://localhost/*` | **Removed** | Production uses `127.0.0.1`; no extension code requires a second loopback hostname. |
| `<all_urls>` / arbitrary `http(s)` hosts | Not requested | The current PDF is accessed under the temporary `activeTab` grant after an explicit user action. |

## Navigation behavior after removing `tabs`

Deep Reader does not need broad visibility into every tab URL. When Chrome exposes the current URL through the existing `activeTab` or host grant, the state machine compares canonical PDF URLs as before. If a navigation begins after that temporary grant has been revoked and Chrome withholds the destination URL, Deep Reader conservatively clears document-bound state rather than retaining stale PDF state on an unrelated page.

Citation navigation initiated by Deep Reader is temporarily exempted from this conservative reset while `tabs.update()` + `tabs.reload()` applies the PDF page fragment.

## Regression gates

Release validation must include:

```bash
npm run check
npm run test:native-host
npm run e2e:extension:native-startup
```

`npm run check` now validates the built manifest and fails if the broad `tabs` permission or an unexpected host permission is introduced without updating the explicit permission allowlist.
