// Applies this repo to a Cloudflare One account through the Cloudflare API.
//
//   export CLOUDFLARE_ACCOUNT_ID=...  CLOUDFLARE_API_TOKEN=...
//   export CF1_TEAM_DOMAIN=<team>.cloudflareaccess.com   (needed by deploy:pages)
//   npm run validate                    check the Access templates, change nothing
//   npm run deploy:pages                create or update the four Access templates (matched by name)
//   npm run deploy:branding             brand the App Launcher and the Gateway block page
//   npm run demo:mode -- <app-id> template
//   npm run demo:mode -- <app-id> worker https://identity.example.com/
//
// Token permissions: Access: Custom Pages Write, Access: Apps and Policies Write,
// Zero Trust Write (Gateway settings).

import { readFile } from 'node:fs/promises';

const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
const root = new URL('../', import.meta.url);
const brand = JSON.parse(await readFile(new URL('brand.json', root), 'utf8'));

// The templates link to the App Launcher through a placeholder team domain so
// the public repo never carries a real one. It lands inside a Liquid string,
// so only a plain <team>.cloudflareaccess.com hostname is accepted.
const TEAM_PLACEHOLDER = 'your-team.cloudflareaccess.com';
const teamDomain = (process.env.CF1_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
if (teamDomain && !/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamDomain)) {
	console.error(`CF1_TEAM_DOMAIN must look like <team>.cloudflareaccess.com, got "${teamDomain}".`);
	process.exit(1);
}

async function cf(method, path, body) {
	const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
		method,
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: body && JSON.stringify(body),
	});
	const json = await res.json();
	if (!json.success) throw new Error(`${method} ${path}: ${JSON.stringify(json.errors)}`);
	return json.result;
}

async function validate() {
	const out = {};
	for (const [type, page] of Object.entries(brand.accessPages)) {
		const source = await readFile(new URL(page.file, root), 'utf8');
		const template = teamDomain ? source.replaceAll(TEAM_PLACEHOLDER, teamDomain) : source;
		const result = await cf('POST', '/access/custom_pages/validate', { type, template });
		for (const f of result.errors) console.error(`✕ ${page.file} [${f.tier}] ${f.message}${f.ref ? ` @ ${f.ref}` : ''}`);
		for (const f of result.warnings) console.warn(`! ${page.file} [${f.tier}] ${f.message}${f.ref ? ` @ ${f.ref}` : ''}`);
		if (!result.errors.length) console.log(`✓ ${page.file} (contract v${result.version})`);
		out[type] = { ...page, template, version: result.version, ok: !result.errors.length };
	}
	if (Object.values(out).some((p) => !p.ok)) throw new Error('Fix the template errors above first.');
	return out;
}

async function deployPages() {
	if (!teamDomain) throw new Error('Set CF1_TEAM_DOMAIN=<team>.cloudflareaccess.com so the App Launcher links point at your organization.');
	const pages = await validate();
	const existing = await cf('GET', '/access/custom_pages');
	for (const [type, page] of Object.entries(pages)) {
		// contract_version marks the page as a sanitized Liquid template.
		// Without it Access treats the HTML as a legacy page and skips Liquid.
		const body = { name: page.name, type, custom_html: page.template, contract_version: page.version };
		const match = existing.find((p) => p.name === page.name && p.type === type);
		const saved = match ? await cf('PUT', `/access/custom_pages/${match.uid}`, body) : await cf('POST', '/access/custom_pages', body);
		console.log(`${match ? 'Updated' : 'Created'} ${type}: ${page.name} (${saved.uid})`);
	}
}

async function deployBranding() {
	const { logo, colors } = brand;
	const launcher = (await cf('GET', '/access/apps')).find((a) => a.type === 'app_launcher');
	if (!launcher) throw new Error('No App Launcher application found.');
	await cf('PUT', `/access/apps/${launcher.id}`, {
		...writable(launcher),
		app_launcher_logo_url: logo,
		header_bg_color: colors.primary,
		bg_color: colors.surface,
		footer_links: brand.appLauncher.footerLinks ?? launcher.footer_links,
		landing_page_design: {
			title: brand.appLauncher.title,
			message: brand.appLauncher.message,
			image_url: logo,
			button_color: colors.primary,
			button_text_color: colors.onPrimary,
		},
	});
	console.log('Branded the App Launcher');

	// A PATCH carrying only block_page dropped other settings (inspection,
	// host_selector, sandbox) on a test account, so send them all back.
	const g = brand.gatewayBlockPage;
	const { settings } = await cf('GET', '/gateway/configuration');
	await cf('PATCH', '/gateway/configuration', {
		settings: {
			...withoutReadOnly(settings),
			block_page: {
				enabled: true,
				mode: 'customized_block_page',
				name: brand.name,
				logo_path: logo,
				header_text: g.headerText,
				footer_text: g.footerText,
				mailto_address: g.mailtoAddress,
				mailto_subject: g.mailtoSubject,
				background_color: colors.primary,
				suppress_footer: false,
			},
		},
	});
	console.log('Branded the Gateway block page');
}

// Switches an application's denial pages between the Liquid templates and
// the Worker. The branded login and CLI approval templates stay in both modes.
async function mode(appId, which, workerUrl) {
	if (!appId || !['template', 'worker'].includes(which) || (which === 'worker' && !workerUrl)) {
		throw new Error('Usage: npm run demo:mode -- <app-id> template | worker <worker-url>');
	}
	const app = await cf('GET', `/access/apps/${appId}`);
	const pages = await cf('GET', '/access/custom_pages');
	const uid = (type) => pages.find((p) => p.type === type && p.name === brand.accessPages[type].name)?.uid;
	const always = [uid('login'), uid('interstitial')];
	const denial = which === 'template' ? [uid('identity_denied'), uid('forbidden')] : [];
	await cf('PUT', `/access/apps/${appId}`, {
		...writable(app),
		custom_pages: [...always, ...denial].filter(Boolean),
		custom_deny_url: which === 'worker' ? workerUrl : '',
		custom_non_identity_deny_url: which === 'worker' ? workerUrl : '',
	});
	console.log(`${app.name}: denial pages now use the ${which === 'worker' ? `Worker (${workerUrl})` : 'Liquid templates'}`);
}

function withoutReadOnly(settings) {
	const READ_ONLY = new Set(['version', 'read_only', 'source_account', 'updated_at', 'binding_status', 'qs_pack_id']);
	const clean = (value) =>
		value && typeof value === 'object' && !Array.isArray(value)
			? Object.fromEntries(Object.entries(value).filter(([k]) => !READ_ONLY.has(k)).map(([k, v]) => [k, clean(v)]))
			: value;
	return clean(settings);
}

// PUT replaces the whole application, so send back what GET returned,
// minus read-only fields, with policies as references.
function writable(app) {
	const { id, aud, created_at, updated_at, policies, ...rest } = app;
	return { ...rest, policies: (policies ?? []).map((p) => ({ id: p.id, precedence: p.precedence })) };
}

const [command, ...args] = process.argv.slice(2);
const commands = { validate, pages: deployPages, branding: deployBranding, mode };
if (!commands[command]) {
	console.error('Commands: validate | pages | branding | mode <app-id> template|worker [url]');
	process.exit(1);
}
if (!account || !token) {
	console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
	process.exit(1);
}
await commands[command](...args).catch((err) => {
	console.error(err.message);
	process.exit(1);
});
