# AGENTS.md

Guidance for AI coding agents working on this repository. Read [README.md](README.md) first for what the repo does and how people use it. This file covers what you need in order to change it safely.

## What this is

A public demo repo of branded Cloudflare One (Zero Trust) user-facing pages, in a dark navy theme (`#0F172A`):

- `access-pages/*.html`: Access custom page templates (HTML + Liquid) for the four page types: Login, Identity denied, Forbidden, Interstitial
- `brand.json`: brand name, logo, colors, template names, App Launcher and Gateway block page copy
- `tools/preview.mjs`: local renderer (LiquidJS + `access-pages/samples.json`), because the dashboard editor doesn't render
- `tools/cf1.mjs`: Cloudflare API deploy tool (validate, deploy templates, apply branding, switch an app between template and Worker)
- `worker/`: a Workers identity and denial page based on [cloudflare/cf-identity-dynamic](https://github.com/cloudflare/cf-identity-dynamic)

## Commands

```bash
npm install && npm run preview            # http://localhost:4173, templates with sample data
npm run validate                          # needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
npm run deploy:pages | deploy:branding
npm run demo:mode -- <app-id> template|worker [url]
cd worker && npm install && cp .dev.vars.example .dev.vars && npx wrangler dev   # http://localhost:8787/?demo=access|gateway|identity
```

`.claude/launch.json` defines both preview servers (`access-pages-preview`, `worker-dev`). There is no test suite. Verify by rendering: local preview first, then a live, isolated Access application.

## Tools you may have

- **Cloudflare API MCP Server** (Code Mode): `search` queries the Cloudflare OpenAPI spec, and `execute` runs JavaScript with `cloudflare.request({ method, path, body })` against the account. Use it to read and change Access custom pages, applications, organization settings, and Gateway configuration. The user supplies the account ID in the session. Never commit it, and never commit API tokens.
- **Cloudflare documentation search** (MCP): use it before relying on memory. Access custom pages launched on 2026-10-27, and much of the detail lives only in the dashboard.
- **Browser**: render live pages to verify them. Cloudflare dashboard sign-in belongs to the user: never enter credentials.

## Rules for changing the live account

This is a real account with production applications. Treat every write as production.

1. **Read before write, snapshot, then diff.** Save the GET result before any PUT or PATCH, and compare afterwards. Keep rollback copies outside the repo.
2. **Gateway configuration:** a `PATCH /gateway/configuration` with only `settings.block_page` removed `inspection`, `host_selector` and `sandbox` from the account. Send back the full current settings without read-only fields (`tools/cf1.mjs` does this), then verify every key.
3. **Access applications:** `PUT /access/apps/{id}` replaces the whole object. Send the GET result back without `id`, `aud`, `created_at` and `updated_at`, with `policies` as `[{ id, precedence }]`. Reusable and inline policies can't be mixed on one app.
   **Access organization:** `PUT /access/organizations` also replaces everything. Send the GET result without `created_at`, `updated_at`, `has_migrated_private_apps`, `trusted_accounts` and `service_token_inactivity`. When disabled, that last one reads back with `null` threshold and action, which fails with `12062 invalid_org_config`.
4. **Don't set account defaults** for custom pages, or assign templates to existing apps, without asking. Defaults apply to every app, including private ones.
5. **DNS changes need explicit user approval** (new hostnames, Worker custom domains). To test without DNS, add a temporary, path-scoped self-hosted app on an existing proxied hostname, set `app_launcher_visible: false`, and delete it, plus any probe templates, when you're done.
6. Report what you changed, and anything you couldn't verify.
7. Testing Gateway block pages: browsers with their own Secure DNS (DoH to 1.1.1.1) bypass Gateway DNS. Network (L4) policies run before HTTP policies and close the connection without a block page, so the result is `ERR_CONNECTION_CLOSED`. Check `cdn-cgi/trace`, `dig` against the client resolver, and the Gateway network and HTTP logs before blaming the block page.

## Access custom page templates

### Liquid variables (contract v2)

From the dashboard editor's **Variables** panel, plus live renders:

| Type | Variables |
| --- | --- |
| All | `request.country` (may be absent), `request.is_warp`, `request.is_gateway`, `locale` (BCP-47) |
| Login | `app_name`, `app_domain`, `org.{name, logo_url, bg_color, accent_color, text_color}`, `idps[].{index, name, type}`, `has_onetimepin`, `message.{text, level}` (level is `info`, `warning` or `error`; always present, `text` often empty) |
| Identity denied / Forbidden | `app.{name, domain, type, logo_url}`, `ray_id`, `user.{email, name, given_name, surname, groups[].{name, email}, idp.{type, name}, risk_score, amr[], mfa_authenticators[], attributes, posture[].{rule_name, type, success, description, error}}`, `policy_evaluation.policies[].{name, decision, status, rules[].{type, name, context, status}}` |
| Interstitial | `app.{name, domain}`, `requesting_tool` (`"cloudflared"`), `user.{email, groups[]}` |

`decision` is `allow`, `deny`, `bypass` or `non_identity`. Both `status` fields are `success` or `fail`. A rule's `context` is `include`, `exclude` or `require`. The editor lists `posture` next to `user.*`, so the templates read `user.posture` and fall back to `posture`.

Observed live:
- `app.domain` is the bare hostname.
- `org.*` mirrors the account's login design.
- An IdP's `name` can be empty (the Cloudflare IdP).
- `ray_id` came back empty on a Forbidden page.
- `policy_evaluation` is absent when a service-auth (`non_identity`) policy fails.
- `request.is_warp` and `request.is_gateway` didn't reflect a connected client: absent on Login, and `false` on Forbidden, while `cdn-cgi/trace` showed `warp=on` and `gateway=on`. Forbidden also reported a different `request.country` from Login. The org had WARP authentication identity (`allow_authenticate_via_warp`) turned off, which may be the cause; this is untested. Only show these values when `true`, and never print "off" or "not detected".
- Newly created Access apps can take more than 10 minutes to load at the edge. Until then the path returns error 1043 ("Cannot find Access application").
- Identity denied and Interstitial have only been rendered locally, because they need a real sign-in.

### Sandbox rules (enforced by `POST /access/custom_pages/validate`)

- Disallowed: `<script>`, `on*` attributes, `<svg>`, `<button>`, `<form>`, `<link>`, `<meta http-equiv>`, and `@import`/`url()` in CSS. Allowed: `<style>`, inline `style`, CSS variables, media queries, gradients, `<details>`, and HTTPS `<img>`. Use system fonts and Unicode glyphs.
- Login needs exactly one `<cf-access-authbox>`, and Interstitial exactly one `<cf-access-cli-approval>`. Keep them outside Liquid conditions and loops.
- `include`, `render`, `layout`, `echo` and `raw` are unavailable. Unknown variables and filters pass validation but can fail at render time, and Access then falls back to its built-in page, so stick to standard filters.
- **Empty strings are truthy.** Use `{% if x.size > 0 %}` for strings, not `{% if x %}`.
- The authbox and approval controls are closed shadow DOM: they inherit `font` and `color`, but draw white buttons and labels in `org.text_color`. That's why they sit on a light panel.

### Creating templates through the API

1. Validate, then create or update with `contract_version` set to the `version` the validator returned. Without it the page is stored as a legacy page (`contract_version: 0`) and the Liquid is shown verbatim.
2. Template type is fixed after creation. Names must be unique: `tools/cf1.mjs` matches on the names in `brand.json`.
3. Assign templates per app with the `custom_pages: [uid, …]` array. Account defaults for `identity_denied` and `forbidden` live in the organization's `custom_pages`.
4. When uploading through MCP `execute`, embed the file in `String.raw` (the templates contain no backticks, `${` or backslashes, so keep it that way). Replace `your-team.cloudflareaccess.com` with the real team domain, as `tools/cf1.mjs` does. Then compare the SHA-256 against the local file with the same replacement applied, before saving. For small edits, GET the live template, apply the same string replacement, and check the hash.

## Conventions

- Templates stay standalone so they can be pasted into the dashboard. Brand values are duplicated on purpose: when you change them, update all four templates, `brand.json`, and `worker/wrangler.jsonc` `vars`.
- The repo is public. Keep account-specific values out of it: account, zone, app and template IDs, the real team domain (templates use `your-team.cloudflareaccess.com`, filled from `CF1_TEAM_DOMAIN` at deploy time), real user or group names, and details of what the account protects. Commits use the author's GitHub noreply address.
- Commit messages and PR descriptions: plain, with no AI co-author trailers, "generated with" footers, or mentions of the tool or model used.
- When the variable contract changes, update `access-pages/samples.json` with it.
- `docs/screenshots/*.png` come from the local previews: headless Chromium at 1280px wide (390px for mobile) and 2× scale, full page for the denial pages, using only the sample data. Retake them when a template's look changes. Never capture live pages: they show real app names, identity providers and the team domain.
- Say "Cloudflare One Client", not "WARP". `is_warp` is still the variable name.
- Never link to `/cdn-cgi/access/logout`. It revokes the user's Access sessions in every application, not just one. The Cloudflare One Client stays enrolled and connected, and Gateway is unaffected. But apps with **Authenticate with Cloudflare One Client** on, and any Gateway policy with `check_session`, then prompt the client to re-authenticate. Tell users to switch accounts in a private window instead.
- An app's `allow_authenticate_via_warp` always overrides the org-wide value, which only sets the default. Test it with a cookie-less `curl` through the connected client: you get the origin's response instead of a 302 to `/cdn-cgi/access/login`. If the client's identity doesn't pass the app's policies, Access still redirects to sign-in.
- The Worker has no runtime dependencies and ships no client JavaScript: server-rendered HTML through the escaping `html` tag in `worker/src/page.js`, plus a strict CSP. Treat redirect query parameters as untrusted, and pass URLs through `safeUrl`.
- Formatting: tabs in `.js`/`.mjs`/`.jsonc`; two spaces in HTML, CSS and JSON. Keep comments sparse and explain why, not what.
- Sample data uses `example.com` identities. Don't put real user data in the repo.

## References

Cloudflare One
- [Access custom pages](https://developers.cloudflare.com/cloudflare-one/reusable-components/custom-pages/access-custom-pages/) and [changelog (2026-10-27)](https://developers.cloudflare.com/changelog/post/2026-10-27-access-custom-pages/)
- [Access custom block pages (legacy, redirect URL parameters)](https://developers.cloudflare.com/cloudflare-one/reusable-components/custom-pages/access-block-page/)
- [Access login page](https://developers.cloudflare.com/cloudflare-one/reusable-components/custom-pages/access-login-page/)
- [App Launcher customization](https://developers.cloudflare.com/cloudflare-one/reusable-components/custom-pages/app-launcher-customization/) and [App Launcher](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/app-launcher/)
- [Gateway block page (policy context parameters)](https://developers.cloudflare.com/cloudflare-one/reusable-components/custom-pages/gateway-block-page/) and [HTTP policies](https://developers.cloudflare.com/cloudflare-one/traffic-controls/http-policies/)
- [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/) and [self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Application token and `get-identity`](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/) and [validating JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare One Client](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/)
- [Connect through Access using a CLI (`cloudflared access login`)](https://developers.cloudflare.com/cloudflare-one/tutorials/cli/)
- [Querying Access login events (GraphQL)](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-access-login-events/)

API
- [Access custom pages](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/custom_pages/), [Access applications](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/), [Gateway configurations](https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/configurations/)

Workers
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

For agents
- [Cloudflare One docs index (`llms.txt`)](https://developers.cloudflare.com/cloudflare-one/llms.txt). Append `index.md` to any docs URL for Markdown.
- [Agent setup](https://developers.cloudflare.com/agent-setup/)
