// Turns the request (query string from Access or Gateway, plus get-identity)
// into the view model the page renders. Query parameters are visitor-
// controlled: they are shown as context, never trusted for decisions.

const FILTERS = { http: 'web request', dns: 'DNS lookup', av: 'file download', l4: 'network connection' };

export function readSource(url) {
	const q = url.searchParams;
	if (q.has('cf_site_uri') || q.has('cf_filter') || q.has('cf_rule_id')) {
		const site = q.get('cf_site_uri') || '';
		return {
			kind: 'gateway',
			site,
			host: hostOf(site) || site,
			filter: FILTERS[q.get('cf_filter')] || 'request',
			categories: (q.get('cf_request_categories') || '').split(',').map((s) => s.trim()).filter(Boolean),
			application: q.get('cf_application_name') || '',
			ruleId: q.get('cf_rule_id') || '',
			reference: q.get('cf_request_id') || q.get('cf_query_id') || q.get('cf_connection_id') || '',
		};
	}
	if (q.has('kid') || q.has('original_url')) {
		const original = safeUrl(q.get('original_url'));
		return {
			kind: 'access',
			aud: q.get('kid') || '',
			originalUrl: original,
			host: hostOf(original),
		};
	}
	return { kind: 'identity' };
}

// Access sends original_url without a scheme (app.example.com/path).
// Only http(s) URLs survive, so a crafted link can't become javascript:.
export function safeUrl(value) {
	if (!value) return '';
	try {
		const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
	} catch {
		return '';
	}
}

function hostOf(value) {
	try {
		return new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`).hostname;
	} catch {
		return '';
	}
}

// get-identity returns groups as strings or objects, depending on the IdP.
export function groupNames(identity) {
	return (identity?.groups ?? []).map((g) => (typeof g === 'string' ? g : g?.name || g?.email || g?.id)).filter(Boolean);
}

export function postureResults(identity) {
	return Object.values(identity?.devicePosture ?? {}).map((rule) => ({
		name: rule.rule_name || rule.type || 'Posture check',
		type: rule.type || '',
		success: rule.success === true,
		detail: rule.success ? rule.description : rule.error || rule.description,
	}));
}

export function checks(identity, env) {
	if (!identity) return [];
	const amr = identity.amr ?? [];
	const list = [
		{
			label: 'Cloudflare One Client connected',
			ok: identity.is_warp === true,
			detail: identity.is_warp ? 'Traffic from this device goes through Cloudflare.' : 'Connect the client and make sure it shows Connected.',
		},
		{
			label: 'Gateway filtering',
			ok: identity.is_gateway === true,
			detail: identity.is_gateway ? 'Requests are filtered by Gateway.' : 'Gateway did not see this request.',
		},
		{
			label: 'Multi-factor sign-in',
			ok: amr.some((m) => ['mfa', 'hwk', 'swk', 'otp'].includes(m)),
			detail: amr.length ? `Methods: ${amr.join(', ')}` : 'Your identity provider did not report the sign-in method.',
		},
	];
	if (env.ACCOUNT_ID && identity.is_warp) {
		const enrolled = identity.gateway_account_id === env.ACCOUNT_ID;
		list.splice(1, 0, {
			label: 'Device enrolled in this organization',
			ok: enrolled,
			detail: enrolled ? 'The client is enrolled in the right Zero Trust organization.' : 'The client is enrolled in a different organization. Re-enroll with your work team name.',
		});
	}
	for (const p of postureResults(identity)) {
		list.push({ label: p.name, ok: p.success, detail: p.detail || `${p.type} posture check` });
	}
	return list;
}
