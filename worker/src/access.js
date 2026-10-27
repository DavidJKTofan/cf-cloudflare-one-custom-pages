// Data sources for the identity page.
// - get-identity needs only the Access JWT that Access adds to every request.
// - The Cloudflare API calls are optional and run only when API_TOKEN is set.

const API = 'https://api.cloudflare.com/client/v4';

export async function getIdentity(request, env) {
	const jwt = request.headers.get('cf-access-jwt-assertion');
	if (!jwt) return { error: 'no-jwt' };
	if (!env.TEAM_DOMAIN) return { error: 'no-team-domain' };

	const res = await fetch(`https://${env.TEAM_DOMAIN}/cdn-cgi/access/get-identity`, {
		headers: { cookie: `CF_Authorization=${jwt}` },
	});
	if (!res.ok) return { error: `get-identity returned ${res.status}` };
	try {
		return { identity: await res.json() };
	} catch {
		return { error: 'get-identity returned invalid JSON' };
	}
}

async function api(env, path, init = {}) {
	const res = await fetch(`${API}${path}`, {
		...init,
		headers: { authorization: `Bearer ${env.API_TOKEN}`, 'content-type': 'application/json', ...init.headers },
	});
	if (!res.ok) throw new Error(`${path} returned ${res.status}`);
	return res.json();
}

// Access appends ?kid=<application AUD> to the custom deny URL. Match it to an
// application to show a friendly name. The query string is visitor-controlled,
// so the result is display-only.
export async function getAppByAud(env, aud) {
	if (!env.API_TOKEN || !env.ACCOUNT_ID || !aud) return null;
	try {
		const { result } = await api(env, `/accounts/${env.ACCOUNT_ID}/access/apps?aud=${encodeURIComponent(aud)}`);
		const app = result?.find((a) => a.aud === aud);
		return app ? { name: app.name, domain: app.domain, type: app.type } : null;
	} catch {
		return null;
	}
}

// Recent failed Access logins for this user, from the GraphQL Analytics API.
// https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-access-login-events/
export async function getRecentFailures(env, userUuid, minutes = 30) {
	if (!env.API_TOKEN || !env.ACCOUNT_ID || !userUuid) return null;
	const query = `query ($account: String!, $user: String!, $since: Time!, $until: Time!) {
		viewer { accounts(filter: { accountTag: $account }) {
			accessLoginRequestsAdaptiveGroups(limit: 5, orderBy: [datetime_DESC], filter: {
				datetime_geq: $since, datetime_leq: $until, userUuid: $user, isSuccessfulLogin: 0
			}) { dimensions { datetime appId country identityProvider hasWarpEnabled hasGatewayEnabled } }
		} }
	}`;
	const until = new Date();
	const since = new Date(until.getTime() - minutes * 60_000);
	try {
		const body = JSON.stringify({
			query,
			variables: { account: env.ACCOUNT_ID, user: userUuid, since: since.toISOString(), until: until.toISOString() },
		});
		const data = await api(env, '/graphql', { method: 'POST', body });
		const rows = data?.data?.viewer?.accounts?.[0]?.accessLoginRequestsAdaptiveGroups ?? [];
		const names = await appNames(env, [...new Set(rows.map((r) => r.dimensions.appId).filter(Boolean))]);
		return rows.map(({ dimensions: d }) => ({ ...d, appName: names[d.appId] }));
	} catch {
		return null;
	}
}

async function appNames(env, ids) {
	const entries = await Promise.all(
		ids.map((id) =>
			api(env, `/accounts/${env.ACCOUNT_ID}/access/apps/${id}`)
				.then(({ result }) => [id, result?.name])
				.catch(() => [id, undefined]),
		),
	);
	return Object.fromEntries(entries);
}
