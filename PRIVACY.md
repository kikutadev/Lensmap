# Deep Reader Privacy Policy

Last updated: 2026-08-14

Deep Reader is a local-first tool for reading PDFs and asking grounded questions about selected passages. This document describes the data handled by the open-source Deep Reader software distributed through GitHub.

## Summary

Deep Reader does not operate a developer-owned cloud backend, analytics service, advertising system, or telemetry pipeline. PDF storage, indexing, chat history, source provenance, and Insight artifacts are stored locally on the user's machine.

When the user asks an AI question, Deep Reader uses the locally installed Codex app-server. The question and the book excerpts needed to answer it are therefore provided to the user's configured Codex/OpenAI service. Deep Reader does not intentionally send the entire PDF to the model merely because the PDF was imported.

## Data handled locally

Deep Reader may process and store the following on the user's machine:

- imported PDF files;
- PDF URLs and document identifiers;
- extracted/indexed PDF text and document structure;
- selected quotations and source anchors;
- locally retrieved surrounding passages or search results;
- Deep Dive questions and AI responses;
- conversation summaries and source/citation provenance;
- saved Insight artifacts, versions, tags, and related metadata;
- local application logs used for diagnosis;
- limited Chrome extension state such as the active PDF, selected sources, and recent assistant state.

The server stores its persistent application data in the configured Deep Reader data directory. The Chrome extension uses `chrome.storage.local` for ordinary extension state. Deep Reader does not use `chrome.storage.sync` for book or chat data.

## Data sent for AI processing

When the user starts a Deep Dive, Deep Reader may provide Codex with:

- the user's question;
- the explicitly selected passages;
- a bounded conversation summary when relevant;
- additional passages retrieved locally from the same book through Deep Reader's read-only book tools when the initial excerpts are insufficient;
- metadata needed to preserve source labels and citations.

The full PDF is indexed locally. Additional book text is sent to the model only when it becomes part of the prompt or a model-requested book-tool result.

Use of Codex/OpenAI services is governed by the terms and privacy choices applicable to the user's OpenAI account and service. See OpenAI's current policies at:

- https://openai.com/policies/privacy-policy/
- https://openai.com/policies/terms-of-use/

## PDF source websites

For a web-hosted PDF, the Chrome extension fetches the PDF from the URL the user is currently viewing. The request can use the browser's existing credentials so authenticated PDFs can be read. The operator of that PDF website may therefore receive the normal network information associated with that request under its own policies.

Deep Reader does not send the fetched PDF to a developer-operated server. It is imported into the user's local Deep Reader Server.

## Authentication and local capability token

Production startup generates a random local capability token used to protect the loopback HTTP API from unrelated webpages or processes that do not possess the capability.

The token is:

- generated locally for the running server;
- stored in a runtime file restricted to the local user;
- transferred to the Chrome extension through Native Messaging;
- held by the extension in `chrome.storage.session` only;
- rotated when the production server process is started again.

The capability token is not intended to be telemetry, an account identifier, or a cross-device identifier.

## Analytics, advertising, and sale of data

The open-source Deep Reader application currently contains no Deep Reader-owned analytics or telemetry integration and no advertising SDK. The project does not sell user data.

Third-party services explicitly invoked by the user, including Codex/OpenAI and the website hosting a PDF, operate under their own terms and privacy policies.

## Retention and deletion

Local PDF, index, chat, and Insight data remain on the user's machine until the corresponding local data is removed. Removing the Chrome extension clears Chrome extension local storage, but does not automatically remove the separate Deep Reader Server data directory.

The local capability token is session-oriented security material rather than user content; the extension-side copy is cleared when Chrome clears extension session storage, and the runtime token is replaced when the production server starts again.

Any content processed by Codex/OpenAI is subject to the retention and data-control rules applicable to the user's OpenAI service and account; Deep Reader does not control that external retention.

## Network exposure

The production Deep Reader Server is designed to bind to the loopback interface (`127.0.0.1`) rather than a LAN/public interface. Except for the health endpoint, production API requests require the local capability token.

Users who modify the source, environment variables, server bind address, or authentication behavior are responsible for the security and privacy implications of those changes.

## Changes

Material changes to Deep Reader's data flow should be reflected in this file together with the code change that introduces them.
