# Bulwark Webmail Integration for Toowix Mail Platform

[Bulwark](https://bulwarkmail.org) is an open-source, JMAP-native webmail client built with Next.js and TypeScript, purpose-built to pair with **Stalwart Mail Server**.

## Overview
* **Image**: `ghcr.io/bulwarkmail/webmail:latest`
* **Protocol**: JMAP (RFC 8620)
* **Default Port**: Host port `8888` (mapped to container `3000`)
* **Stalwart Connection**:
* **Stalwart Connection**:
  * **Development**: `http://localhost:8888` (Bulwark runs with `server-proxy.js` which proxies JMAP calls to `http://stalwart:8080` and UI calls to Next.js on port 3001, providing a unified **same-origin** experience with zero CORS or certificate issues).
  * **Production**: `https://mail.toowix.com` (public HTTPS reverse-proxy endpoint sharing the same domain/CORS boundary).

## Key Advantages over Legacy Webmail (Roundcube)
1. **Native JMAP Protocol**: Single-request delta syncs instead of chatty multi-connection IMAP loops.
2. **Server-Side Threading**: Stalwart assembles message threads directly; Bulwark renders them natively.
3. **Modern Suite**: Includes Mail, Calendar (CalDAV/iMIP), Contacts (CardDAV), and Files (JMAP FileNode) in a unified interface.
4. **Stalwart-Specific Integration**: Native password changes, Sieve filtering, and responsive PWA support.

## Configuration & Storage
* `server-proxy.js`: Built-in Node reverse proxy ensuring all JMAP endpoints (`/.well-known/jmap`, `/jmap/session`, `/jmap/`) and WebSocket connections (`/jmap/ws`) are exposed on the exact same port (`8888`) as the Webmail UI.
* `/app/data/settings`: Encrypted user preferences and theme settings (`toowix-mail-bulwark-settings`).
* `/app/data/admin`: Admin configuration, branding, and policy storage (`toowix-mail-bulwark-admin`).
* `JMAP_SERVER_URL`: Set to `http://localhost:8888` in development.
