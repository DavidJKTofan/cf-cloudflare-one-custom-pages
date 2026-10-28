// Server-rendered, script-free HTML. Styling mirrors access-pages/*.html so
// switching an application between the Liquid template and this Worker keeps
// the same look.

import { checks, groupNames } from './context.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Tagged template: interpolations are escaped unless wrapped in raw().
const RAW = Symbol('raw');
const raw = (html) => ({ [RAW]: html });
const html = (strings, ...values) =>
	raw(
		strings.reduce((out, str, i) => {
			const v = values[i - 1];
			const part = Array.isArray(v) ? v.map((x) => x?.[RAW] ?? esc(x)).join('') : v?.[RAW] ?? (v === false || v == null ? '' : esc(v));
			return out + part + str;
		}),
	);

const HERO = {
	access: { badge: '✕', tone: 'fail', eyebrow: 'Access denied' },
	gateway: { badge: '!', tone: 'warn', eyebrow: 'Blocked by Gateway' },
	identity: { badge: '✓', tone: 'info', eyebrow: 'Identity' },
};

function hero(source, identity, app) {
	const h = HERO[source.kind];
	let title, lead;
	if (source.kind === 'access') {
		title = `You don't have access to ${app?.name || source.host || 'this application'}`;
		lead = identity?.email
			? html`You're signed in as <strong>${identity.email}</strong>, but this application's policy didn't allow the request. The checks below show what Access sees for your session and device.`
			: html`This application's policy didn't allow the request. The checks below show what Access sees for your session and device.`;
	} else if (source.kind === 'gateway') {
		title = `${source.host || 'This site'} is blocked`;
		lead = html`Your organization's security policy blocked this ${source.filter}. If you need it for work, ask your administrator and include the reference below.`;
	} else {
		title = identity?.name || identity?.email || 'Your Cloudflare One identity';
		lead = html`What Cloudflare Access and Gateway know about this session and device.`;
	}
	return html`<section class="hero">
		<div class="badge badge--${h.tone}" aria-hidden="true">${h.badge}</div>
		<div><p class="eyebrow eyebrow--${h.tone}">${h.eyebrow}</p><h1>${title}</h1><p class="lead">${lead}</p></div>
	</section>`;
}

function target(source, app) {
	if (source.kind === 'identity') return '';
	const name = source.kind === 'gateway' ? source.application || source.host : app?.name || source.host;
	const sub = source.kind === 'gateway' ? source.site : source.originalUrl || app?.domain;
	if (!name && !sub) return '';
	return html`<div class="app"><div class="app-logo">${(name || '?').slice(0, 1).toUpperCase()}</div><div><b>${name}</b><span>${sub}</span></div></div>`;
}

const mark = (ok) => (ok ? html`<span class="mark mark--ok" aria-hidden="true">✓</span>` : html`<span class="mark mark--fail" aria-hidden="true">✕</span>`);

function checksPanel(identity, env, error) {
	if (!identity) {
		return html`<section class="panel"><h2>Identity unavailable</h2>
			<p class="hint">This page couldn't read your Access session (${error}). Protect this Worker's hostname with an Access application, set <code>TEAM_DOMAIN</code>, and try again.</p></section>`;
	}
	const list = checks(identity, env);
	const failed = list.filter((c) => !c.ok).length;
	return html`<section class="panel"><h2>Session and device checks</h2>
		<p class="hint">${failed ? `${failed} of ${list.length} checks need attention.` : `All ${list.length} checks look good.`}</p>
		<div class="box"><ul class="rules">${list.map(
			(c) => html`<li class="rule">${mark(c.ok)}<div class="rule-body"><b>${c.label}</b><small>${c.detail}</small></div>
				<span class="rule-state rule-state--${c.ok ? 'ok' : 'fail'}">${c.ok ? 'OK' : 'Check'}</span></li>`,
		)}</ul></div></section>`;
}

function gatewayPanel(source) {
	if (source.kind !== 'gateway') return '';
	return html`<section class="panel"><h2>What Gateway matched</h2><dl>
		<dt>Blocked</dt><dd>${source.filter}</dd>
		${source.categories.length ? html`<dt>Categories</dt><dd>${source.categories.join(', ')}</dd>` : ''}
		${source.application ? html`<dt>Application</dt><dd>${source.application}</dd>` : ''}
		${source.ruleId ? html`<dt>Policy ID</dt><dd class="mono">${source.ruleId}</dd>` : ''}
	</dl></section>`;
}

function historyPanel(failures) {
	if (!failures?.length) return '';
	return html`<section class="panel"><h2>Recent failed sign-ins</h2><p class="hint">Last 30 minutes, newest first.</p>
		<div class="box"><ul class="rules">${failures.map(
			(f) => html`<li class="rule">${mark(false)}<div class="rule-body"><b>${f.appName || 'Access application'}</b>
				<small>${new Date(f.datetime).toUTCString()} · ${f.country || '??'} · ${f.identityProvider || 'IdP'} · client ${f.hasWarpEnabled ? 'on' : 'off'}</small></div></li>`,
		)}</ul></div></section>`;
}

function actionsPanel(source, identity, env, reference) {
	const steps = [];
	if (identity && !identity.is_warp) steps.push(['Connect the Cloudflare One Client', 'This resource may require a managed, connected device.']);
	// No /cdn-cgi/access/logout link: it revokes the user in every application
	// and forces Cloudflare One Client re-authentication.
	if (source.kind === 'access') steps.push(['Use another account', 'Open the application in a private window and sign in with your work identity.']);
	if (source.kind === 'gateway') steps.push(['Check the address', 'Look for typos, or use the approved tool for this task.']);
	steps.push(['Ask for access', 'Contact your administrator and include the reference below.']);
	return html`<section class="panel"><h2>What you can do</h2>
		<ol class="steps">${steps.map(([b, t]) => html`<li><b>${b}</b>${t}</li>`)}</ol>
		${source.originalUrl ? html`<a class="cta" href="${source.originalUrl}">Try again</a>` : ''}
		${env.SUPPORT_URL ? html`<a class="cta cta--ghost" href="${env.SUPPORT_URL}">Contact support</a>` : ''}
		<div class="ray">Reference<code>${reference}</code></div></section>`;
}

function sessionPanel(identity, env) {
	if (!identity) return '';
	const groups = groupNames(identity);
	const flagged = env.TARGET_GROUP && groups.includes(env.TARGET_GROUP);
	return html`<section class="panel"><h2>Your session</h2><dl>
		${identity.name ? html`<dt>Name</dt><dd>${identity.name}</dd>` : ''}
		${identity.email ? html`<dt>Email</dt><dd>${identity.email}</dd>` : ''}
		${identity.idp?.type ? html`<dt>Signed in with</dt><dd>${identity.idp.type}</dd>` : ''}
		${identity.geo?.country ? html`<dt>Location</dt><dd>${identity.geo.country}</dd>` : ''}
		${identity.device_id ? html`<dt>Device ID</dt><dd class="mono">${identity.device_id.slice(0, 8)}…</dd>` : ''}
	</dl>
	${flagged ? html`<p class="flag">You're in the <b>${env.TARGET_GROUP}</b> group, which restricts access to some applications.</p>` : ''}
	${groups.length ? html`<details><summary>Your groups (${groups.length})</summary><div class="groups">${groups.slice(0, 40).map((g) => html`<span>${g}</span>`)}</div></details>` : ''}
	</section>`;
}

export function renderPage({ source, identity, error, app, failures, ray }, env) {
	const brand = env.BRAND_NAME || 'Cloudflare One';
	const reference = source.reference || ray;
	const title = source.kind === 'gateway' ? 'Blocked' : source.kind === 'access' ? 'Access denied' : 'Identity';
	return `<!doctype html>${
		html`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="robots" content="noindex"><title>${title} · ${brand}</title>
${env.BRAND_LOGO ? html`<link rel="icon" href="${env.BRAND_LOGO}">` : ''}<style>${raw(CSS)}</style></head>
<body><header class="topbar"><div class="wrap"><span class="brand">${env.BRAND_LOGO ? html`<img src="${env.BRAND_LOGO}" alt="" width="32" height="32">` : ''}${brand}</span><small>Cloudflare One · Workers</small></div></header>
<main class="wrap">${hero(source, identity, app)}${target(source, app)}
<div class="grid"><div>${gatewayPanel(source)}${checksPanel(identity, env, error)}${historyPanel(failures)}</div>
<aside>${actionsPanel(source, identity, env, reference)}${sessionPanel(identity, env)}</aside></div></main>
<footer><div class="wrap"><span>Protected by Cloudflare One · ${brand}</span><span>Rendered by a Cloudflare Worker</span></div></footer>
</body></html>`[RAW]
	}`;
}

const CSS = `
:root{--bg:#0b1120;--brand:#0f172a;--panel:#111a2e;--panel-2:#0d1526;--border:#1e2a44;--text:#e2e8f0;--strong:#f8fafc;--muted:#94a3b8;--subtle:#64748b;--accent:#60a5fa;--ok:#34d399;--warn:#fbbf24;--fail:#f87171;--radius:14px;
--sans:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color-scheme:dark}
*{box-sizing:border-box}html{background:var(--bg)}
body{margin:0;min-height:100vh;color:var(--text);font:15px/1.55 var(--sans);background:radial-gradient(900px 420px at 15% -120px,rgba(96,165,250,.12),transparent 70%),linear-gradient(180deg,var(--brand) 0%,var(--bg) 420px);-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}code{font-family:var(--mono);font-size:.9em}
.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
.topbar{border-bottom:1px solid var(--border)}.topbar .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;height:64px}
.brand{display:flex;align-items:center;gap:10px;color:var(--strong);font-weight:600}.brand img{width:32px;height:32px;border-radius:8px}.topbar small{color:var(--muted);font-size:13px}
.hero{display:flex;gap:20px;align-items:flex-start;padding:40px 0 28px}
.badge{flex:none;display:grid;place-items:center;width:56px;height:56px;border-radius:14px;font-size:26px;font-weight:700;border:1px solid}
.badge--fail{color:var(--fail);background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.35)}
.badge--warn{color:var(--warn);background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.35)}
.badge--info{color:var(--accent);background:rgba(96,165,250,.12);border-color:rgba(96,165,250,.35)}
.eyebrow{margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.eyebrow--fail{color:var(--fail)}.eyebrow--warn{color:var(--warn)}.eyebrow--info{color:var(--accent)}
h1{margin:0;color:var(--strong);font-size:clamp(26px,4vw,34px);line-height:1.15;letter-spacing:-.02em;overflow-wrap:anywhere}
.lead{margin:10px 0 0;max-width:680px;color:var(--muted);font-size:16px}.lead strong{color:var(--text);font-weight:500}
.app{display:flex;align-items:center;gap:14px;margin-bottom:24px;padding:16px 18px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius)}
.app-logo{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:#1d2b4a;color:var(--accent);font-weight:700}
.app b{display:block;color:var(--strong);font-weight:600;overflow-wrap:anywhere}.app span{color:var(--muted);font-family:var(--mono);font-size:13px;overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;align-items:start;padding-bottom:40px}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:22px}.panel+.panel{margin-top:20px}
h2{margin:0 0 6px;color:var(--strong);font-size:17px;letter-spacing:-.01em}.hint{margin:0 0 18px;color:var(--muted);font-size:14px}
.box{border:1px solid var(--border);border-radius:12px;background:var(--panel-2)}
.rules{list-style:none;margin:0;padding:4px 16px 8px}.rule{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid rgba(30,42,68,.6)}.rule:first-child{border-top:0}
.mark{flex:none;display:grid;place-items:center;width:22px;height:22px;margin-top:1px;border-radius:50%;font-size:12px;font-weight:700}
.mark--ok{color:var(--ok);background:rgba(52,211,153,.12)}.mark--fail{color:var(--fail);background:rgba(248,113,113,.12)}
.rule-body{flex:1;min-width:0}.rule-body b{display:block;color:var(--text);font-weight:500;overflow-wrap:anywhere}.rule-body small{color:var(--subtle);font-size:12px}
.rule-state{flex:none;font-size:12px;font-weight:600}.rule-state--ok{color:var(--ok)}.rule-state--fail{color:var(--fail)}
.steps{margin:0;padding:0;list-style:none;counter-reset:step}.steps li{position:relative;padding:0 0 14px 34px;color:var(--muted);font-size:14px;counter-increment:step}.steps li:last-child{padding-bottom:0}
.steps li::before{content:counter(step);position:absolute;left:0;top:0;display:grid;place-items:center;width:22px;height:22px;border:1px solid var(--border);border-radius:50%;color:var(--text);font-size:12px;font-weight:600}
.steps b{display:block;color:var(--text);font-weight:600}
dl{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;margin:0;font-size:13px}dt{color:var(--subtle)}dd{margin:0;color:var(--text);text-align:right;overflow-wrap:anywhere}.mono{font-family:var(--mono);font-size:12px}
details{margin-top:16px;border-top:1px solid var(--border);padding-top:12px}summary{cursor:pointer;color:var(--muted);font-size:13px}
.groups{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.groups span{padding:2px 8px;border:1px solid var(--border);border-radius:6px;color:var(--muted);font-size:12px}
.flag{margin:16px 0 0;padding:10px 12px;border:1px solid rgba(251,191,36,.35);border-radius:10px;background:rgba(251,191,36,.08);color:#fde68a;font-size:13px}
.cta{display:block;margin-top:18px;padding:10px 14px;border-radius:10px;background:#2563eb;color:#fff;font-weight:600;text-align:center}.cta:hover{background:#1d4ed8;text-decoration:none}
.cta--ghost{margin-top:10px;background:transparent;border:1px solid var(--border);color:var(--text)}.cta--ghost:hover{background:var(--panel-2)}
.ray{margin-top:16px;padding:12px;border:1px dashed var(--border);border-radius:10px;color:var(--muted);font-size:12px}.ray code{display:block;margin-top:2px;color:var(--strong);font-size:14px;user-select:all;overflow-wrap:anywhere}
footer{padding:24px 0 32px;border-top:1px solid var(--border);color:var(--subtle);font-size:12px}footer .wrap{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}
@media (max-width:860px){.grid{grid-template-columns:minmax(0,1fr)}.hero{padding-top:28px}}
@media (max-width:480px){.hero{flex-direction:column;gap:14px}.badge{width:44px;height:44px;font-size:20px}.panel{padding:18px 16px}.topbar small{display:none}}
`;
