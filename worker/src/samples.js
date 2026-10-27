// Fake data for local development and screenshots: /?demo=access|gateway|identity.
// Served only when the DEMO variable is "true" (see .dev.vars.example).

const identity = {
	email: 'alex@example.com',
	name: 'Alex Rivera',
	idp: { id: 'example', type: 'github' },
	geo: { country: 'DE' },
	amr: ['pwd'],
	user_uuid: '00000000-0000-4000-8000-000000000000',
	device_id: '7c1e0b2a-4f7d-4c8e-9a51-2d3c4b5a6f70',
	gateway_account_id: 'demo-account',
	is_warp: true,
	is_gateway: true,
	groups: [{ name: 'Engineering' }, { name: 'All staff' }, { name: 'Contractors' }],
	devicePosture: {
		a: { rule_name: 'macOS 15 or later', type: 'os_version', success: true, description: 'OS version is 15.4' },
		b: { rule_name: 'Disk encryption', type: 'disk_encryption', success: false, error: 'FileVault is turned off on this device' },
		c: { rule_name: 'Firewall on', type: 'firewall', success: true, description: 'Firewall is enabled' },
	},
};

export const SAMPLES = {
	access: {
		query: 'kid=demo-aud&account_id=demo-account&original_url=finance.example.com%2Freports',
		app: { name: 'Demo · Finance Portal', domain: 'finance.example.com' },
		identity,
		failures: [
			{ datetime: new Date().toISOString(), appName: 'Demo · Finance Portal', country: 'DE', identityProvider: 'github', hasWarpEnabled: 1 },
		],
	},
	gateway: {
		query: 'cf_site_uri=https%3A%2F%2Ffiles.example.net%2Fshare&cf_filter=http&cf_request_categories=File%20Sharing,Newly%20Seen%20Domains&cf_rule_id=6d48997c-a1ec-4b16-b42e-d43ab4d071d1&cf_request_id=f8dc6fd3-a7a5-44dd-8b77-08430bb4fac3',
		identity: { ...identity, amr: ['pwd', 'mfa'] },
	},
	identity: {
		query: '',
		identity: { ...identity, amr: ['pwd', 'mfa'], devicePosture: { a: identity.devicePosture.a, c: identity.devicePosture.c } },
	},
};
