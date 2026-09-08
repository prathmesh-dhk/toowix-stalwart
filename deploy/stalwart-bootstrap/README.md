# Stalwart First-Run Bootstrap Guide

This directory contains automation and instructions for initializing a fresh Stalwart Community Edition instance to work seamlessly with the Toowix Multi-Tenant Control Plane.

## Purpose

Stalwart Community Edition operates as a flat mail server with a master administrator. Toowix connects to Stalwart using a dedicated service account (`toowix-service@toowix.test`) that has administrative permissions to create/delete domains, accounts, and reset passwords.

Tenants and Tenant Admins **never** interact with or obtain Stalwart credentials.

## Automated Bootstrap

Run `bootstrap.sh` against the running Stalwart instance:

```bash
chmod +x bootstrap.sh
./bootstrap.sh http://localhost:8080 admin@toowix.test <MASTER_ADMIN_PASSWORD> toowix-service@toowix.test <DESIRED_SERVICE_PASSWORD>
```

This script:
1. Validates connectivity and master admin authentication via `/api/account`.
2. Creates the system root domain (e.g. `toowix.test`) via the Stalwart JMAP directory management protocol (`x:Domain/set`).
3. Provisions the dedicated `toowix-service` User account with role `admin` and credentials via `x:Account/set`.

## Manual Bootstrap via Stalwart WebUI

If preferred, the service account can be provisioned through the Stalwart Web Admin UI:

1. Log into Stalwart WebUI (`http://localhost:8080` or `https://mail.toowix.test`) as master administrator.
2. Navigate to **Directory** -> **Domains** -> **Add Domain**.
   - Name: `toowix.test`
3. Navigate to **Directory** -> **Accounts** -> **Add Account**.
   - Type: `User`
   - Name: `toowix-service`
   - Domain: `toowix.test`
   - Role: `admin` (or assign permissions for Domain/Account management)
   - Password: Set a strong password (at least 14 characters with uppercase, lowercase, numbers, and symbols).
4. Enter these credentials into the Toowix Backend `.env` file (`STALWART_USER` and `STALWART_PASSWORD`).
