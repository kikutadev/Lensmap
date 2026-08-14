# Security Policy

Deep Reader is a local-first Chrome extension and companion Node.js server. Security reports are welcome, especially for issues that could expose local PDFs, selected text, Codex credentials, or the loopback API.

## Supported versions

Security fixes are provided for the latest code on `main` and, once GitHub Releases are published, the latest release only. Older releases may be asked to upgrade before a fix is investigated.

## Reporting a vulnerability

Please use GitHub Private Vulnerability Reporting / a private Security Advisory for this repository when available.

Do **not** publish the following in a public Issue, Discussion, pull request, or log attachment:

- authentication tokens or Codex credentials;
- contents of private PDFs or extracted book text;
- local capability tokens;
- exploit steps for an unpatched vulnerability;
- private filesystem paths when they reveal sensitive information.

If private vulnerability reporting is not available, open a minimal public issue stating only that you need a private security contact. Do not include exploit details until a private channel has been established.

A useful report includes the affected commit/release, operating system and Chrome version, impact, reproduction conditions, and a minimal proof of concept that does not contain unrelated private data.

## Security model

Deep Reader intentionally uses a narrow local architecture:

- the HTTP server binds to `127.0.0.1` by default;
- `/api/health` is public only for local availability checks;
- other production API endpoints require a per-server random capability token;
- the token is generated on server start, stored in an owner-only runtime file, and delivered to the extension only through Chrome Native Messaging;
- the extension keeps the token in `chrome.storage.session`, not persistent extension storage;
- the Native Messaging host is restricted to the configured Deep Reader extension ID;
- arbitrary PDF websites are accessed through the temporary `activeTab` grant rather than persistent `<all_urls>` access;
- local PDF access requires the user to explicitly enable Chrome's file-URL access for the extension.

Direct development/test server startup may run without a capability token unless `DEEP_READER_CAPABILITY_TOKEN` is explicitly configured. This mode is for local development and isolated tests only; do not expose it to untrusted networks.

## Out of scope

The following are generally not Deep Reader vulnerabilities by themselves:

- security properties of Chrome, Node.js, Codex, or OpenAI services that are outside this repository;
- access by a process that already has equivalent local-user privileges and can directly read the user's Deep Reader data directory;
- malicious PDFs that only affect an upstream PDF parser without a Deep Reader-specific exploit path.

Upstream vulnerabilities that materially affect a Deep Reader release are still useful to report so dependencies can be updated promptly.
