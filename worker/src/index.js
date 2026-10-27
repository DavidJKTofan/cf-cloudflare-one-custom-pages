// Branded Cloudflare One identity page, based on cloudflare/cf-identity-dynamic.
//
// Use it as:
//   - an Access "Custom Redirect URL" for identity / non-identity denials
//     (Access appends ?kid=<aud>&account_id=...&original_url=...)
//   - a Gateway block page "URL redirect" with "Send policy context" on
//     (Gateway appends ?cf_site_uri=...&cf_rule_id=...&cf_filter=...)
//   - a plain "who am I" page when opened directly
//
// Put the Worker's hostname behind an Access application so requests carry
// the Access JWT that get-identity needs.

import { getAppByAud, getIdentity, getRecentFailures } from './access.js';
import { readSource } from './context.js';
import { renderPage } from './page.js';
import { SAMPLES } from './samples.js';

const SECURITY_HEADERS = {
	'content-type': 'text/html; charset=utf-8',
	'cache-control': 'no-store',
	'content-security-policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	'referrer-policy': 'no-referrer',
	'x-content-type-options': 'nosniff',
};

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === '/favicon.ico' && env.BRAND_LOGO) return Response.redirect(env.BRAND_LOGO, 302);
		if (url.pathname === '/api/identity') return identityJson(request, env);
		if (url.pathname !== '/') return new Response('Not found', { status: 404 });

		const ray = request.headers.get('cf-ray') || 'local';
		const demo = env.DEMO === 'true' && SAMPLES[url.searchParams.get('demo')];
		if (demo) {
			const demoUrl = new URL(`${url.origin}/?${demo.query}`);
			return page({ source: readSource(demoUrl), identity: demo.identity, app: demo.app, failures: demo.failures, ray }, env);
		}

		const source = readSource(url);
		const { identity, error } = await getIdentity(request, env);
		const [app, failures] = await Promise.all([
			source.kind === 'access' ? getAppByAud(env, source.aud) : null,
			getRecentFailures(env, identity?.user_uuid),
		]);
		return page({ source, identity, error, app, failures, ray }, env);
	},
};

const page = (model, env) => new Response(renderPage(model, env), { headers: SECURITY_HEADERS });

// Raw get-identity output, for building and debugging the page. Off by default.
async function identityJson(request, env) {
	if (env.DEBUG !== 'true') return new Response('Not found', { status: 404 });
	const { identity, error } = await getIdentity(request, env);
	return Response.json(identity ?? { error }, { status: identity ? 200 : 401, headers: { 'cache-control': 'no-store' } });
}
