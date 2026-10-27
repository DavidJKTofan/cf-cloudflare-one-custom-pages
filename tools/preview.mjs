// Local preview for the Access custom page templates.
// Renders access-pages/*.html with LiquidJS and the sample data in
// access-pages/samples.json. Access injects the real sign-in and approval
// controls at the edge; here they are replaced with look-alike mocks.
//
//   npm run preview            -> http://localhost:4173
//   PORT=5000 npm run preview

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Liquid } from 'liquidjs';

const root = new URL('../access-pages/', import.meta.url);
const port = Number(process.env.PORT || 4173);
const engine = new Liquid({ strictVariables: false, strictFilters: true });

// Labels as the real authbox shows them: "<provider type> • <display name>".
const IDP_TYPES = { github: 'GitHub', google: 'Google', okta: 'Okta', saml: 'SAML', oidc: 'OpenID Connect', azureAD: 'Microsoft Entra ID', cloudflare: 'Cloudflare' };

const mockAuthbox = (data) => {
	const text = data.org?.text_color || '#333333';
	const accent = data.org?.accent_color || '#4687f1';
	const idps = (data.idps || [])
		.map((idp) => {
			const type = IDP_TYPES[idp.type] || idp.type;
			const label = idp.name && idp.name !== type ? `${type} • ${idp.name}` : type;
			return `<div style="padding:10px 12px;margin-bottom:8px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;color:#111">${label}</div>`;
		})
		.join('');
	const otp = data.has_onetimepin
		? `<div style="margin:16px 0 8px;text-align:center;color:#9ca3af;font-size:12px">or</div>
       <label style="display:block;margin-bottom:6px;color:${text}">Email</label>
       <div style="padding:10px 12px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;color:#9ca3af">example@email.com</div>
       <div style="margin-top:10px;padding:10px;border-radius:6px;background:linear-gradient(180deg,${accent}cc,${accent});color:#fff;text-align:center">Send login code</div>`
		: '';
	return `<cf-access-authbox data-preview><div style="margin-bottom:10px;color:${text}">Sign in with:</div>${idps}${otp}</cf-access-authbox>`;
};

const mockCliApproval = () =>
	`<cf-access-cli-approval data-preview><div style="display:flex;gap:10px">
     <div style="flex:1;padding:10px;border:1px solid #e5e7eb;border-radius:6px;text-align:center;color:#111">Deny</div>
     <div style="flex:1;padding:10px;border-radius:6px;background:#4687f1;color:#fff;text-align:center">Approve</div>
   </div></cf-access-cli-approval>`;

const index = (samples) => {
	const rows = Object.entries(samples)
		.map(([page, scenarios]) => `<li><b>${page}</b> ${Object.keys(scenarios).map((s) => `<a href="/${page}?sample=${s}">${s}</a>`).join(' · ')}</li>`)
		.join('');
	return `<!doctype html><meta charset="utf-8"><title>Access pages preview</title>
<style>body{font:15px/1.6 system-ui;margin:40px;background:#0f172a;color:#e2e8f0}a{color:#60a5fa}li{margin:6px 0}</style>
<h1>Access custom pages · local preview</h1><ul>${rows}</ul>
<p style="color:#94a3b8">Sign-in and approval controls are mocks. Validate and test the real thing against an isolated Access application.</p>`;
};

createServer(async (req, res) => {
	try {
		const url = new URL(req.url, `http://localhost:${port}`);
		const samples = JSON.parse(await readFile(new URL('samples.json', root), 'utf8'));
		const page = url.pathname.slice(1);
		if (!page) {
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			return res.end(index(samples));
		}
		if (!samples[page]) {
			res.writeHead(404).end('Unknown page');
			return;
		}
		const data = samples[page][url.searchParams.get('sample') || 'default'] || samples[page].default;
		const template = await readFile(new URL(`${page}.html`, root), 'utf8');
		const html = (await engine.parseAndRender(template, data))
			.replace(/<cf-access-authbox><\/cf-access-authbox>/, mockAuthbox(data))
			.replace(/<cf-access-cli-approval><\/cf-access-cli-approval>/, mockCliApproval());
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
		res.end(html);
	} catch (err) {
		res.writeHead(500, { 'content-type': 'text/plain' }).end(String(err.stack || err));
	}
}).listen(port, () => console.log(`Access pages preview: http://localhost:${port}`));
