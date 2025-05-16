import { Hono } from "hono";
import {
	layout,
	homeContent,
	parseApproveFormBody,
	renderAuthorizationRejectedContent,
	renderAuthorizationApprovedContent,
	renderLoggedInAuthorizeScreen,
	renderLoggedOutAuthorizeScreen,
} from "./utils";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createGoogleAuth, type GoogleAuth } from "./googleAuth";
import { getCookie, setCookie } from "hono/cookie";

export type Bindings = Env & {
	OAUTH_PROVIDER: OAuthHelpers;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	GOOGLE_REDIRECT_URI?: string;
	ALLOWED_EMAILS: string;
	WORKER_URL?: string;
};

const app = new Hono<{
	Bindings: Bindings;
}>();

// Render a basic homepage placeholder to make sure the app is up
app.get("/", async (c) => {
	const content = await homeContent(c.req.raw);
	return c.html(layout(content, "MCP Remote Auth Demo - Home"));
});

// Render an authorization page
// If the user is logged in, we'll show a form to approve the appropriate scopes
// If the user is not logged in, we'll redirect to Google OAuth
app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	
	// Check if user is already authenticated
	const sessionEmail = getCookie(c, "auth_email");
	const sessionToken = getCookie(c, "auth_token");
	
	const oauthScopes = [
		{
			name: "read_profile",
			description: "Read your basic profile information",
		},
		{ name: "read_data", description: "Access your stored data" },
		{ name: "write_data", description: "Create and modify your data" },
	];

	if (sessionEmail && sessionToken) {
		// User is logged in, show authorization screen
		const content = await renderLoggedInAuthorizeScreen(oauthScopes, oauthReqInfo, sessionEmail);
		return c.html(layout(content, "MCP Remote Auth Demo - Authorization"));
	}

	// User not logged in, redirect to Google OAuth
	try {
		const googleAuth = await createGoogleAuth(c.env);
		
		// Store OAuth request info in KV for later retrieval
		const stateKey = crypto.randomUUID();
		await c.env.OAUTH_KV.put(
			`oauth_state:${stateKey}`,
			JSON.stringify(oauthReqInfo),
			{ expirationTtl: 600 } // 10 minutes
		);
		
		const authUrl = googleAuth.getAuthorizationUrl(stateKey);
		return c.redirect(authUrl);
	} catch (error) {
		console.error("Google OAuth error:", error);
		return c.html(
			layout(
				`<p class="error">OAuth configuration error. Please contact the administrator.</p>`,
				"Error"
			),
			500
		);
	}
});

// The /authorize page has a form that will POST to /approve
// This endpoint is responsible for completing the authorization request
// after the user has been authenticated via Google OAuth
app.post("/approve", async (c) => {
	const { action, oauthReqInfo } = await parseApproveFormBody(
		await c.req.parseBody(),
	);

	if (!oauthReqInfo) {
		return c.html("INVALID REQUEST", 401);
	}
	
	// Check if user is authenticated
	const sessionEmail = getCookie(c, "auth_email");
	const sessionToken = getCookie(c, "auth_token");
	
	if (!sessionEmail || !sessionToken) {
		return c.html(
			layout(
				`<p class="error">You must be logged in to authorize this application.</p>`,
				"Not Authenticated"
			),
			401
		);
	}
	
	// Verify session is still valid
	const sessionData = await c.env.OAUTH_KV.get(`session:${sessionToken}`);
	if (!sessionData) {
		return c.html(
			layout(
				`<p class="error">Your session has expired. Please login again.</p>`,
				"Session Expired"
			),
			401
		);
	}
	
	const session = JSON.parse(sessionData);
	if (Date.now() > session.expiresAt) {
		await c.env.OAUTH_KV.delete(`session:${sessionToken}`);
		return c.html(
			layout(
				`<p class="error">Your session has expired. Please login again.</p>`,
				"Session Expired"
			),
			401
		);
	}

	// The user must be successfully logged in and have approved the scopes, so we
	// can complete the authorization request
	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		request: oauthReqInfo,
		userId: sessionEmail,
		metadata: {
			label: session.name || sessionEmail,
			picture: session.picture,
		},
		scope: oauthReqInfo.scope,
		props: {
			userEmail: sessionEmail,
			userName: session.name,
		},
	});

	return c.html(
		layout(
			await renderAuthorizationApprovedContent(redirectTo),
			"MCP Remote Auth Demo - Authorization Status",
		),
	);
});

// Google OAuth callback handler
app.get("/callback", async (c) => {
	const code = c.req.query("code");
	const state = c.req.query("state");
	const error = c.req.query("error");

	if (error) {
		return c.html(
			layout(
				`<p class="error">Authorization failed: ${error}</p>`,
				"Authorization Failed"
			),
		);
	}

	if (!code || !state) {
		return c.html(
			layout(
				`<p class="error">Invalid authorization response</p>`,
				"Error"
			),
			400
		);
	}

	try {
		const googleAuth = await createGoogleAuth(c.env);
		
		// Retrieve the original OAuth request info
		const storedRequestInfo = await c.env.OAUTH_KV.get(`oauth_state:${state}`);
		if (!storedRequestInfo) {
			throw new Error("Invalid or expired state");
		}
		
		const oauthReqInfo = JSON.parse(storedRequestInfo);
		await c.env.OAUTH_KV.delete(`oauth_state:${state}`);
		
		// Exchange code for tokens
		const tokens = await googleAuth.exchangeCodeForTokens(code);
		
		// Get user info
		const userInfo = await googleAuth.getUserInfo(tokens.access_token);
		
		// Check if email is allowed
		if (!googleAuth.isEmailAllowed(userInfo.email)) {
			return c.html(
				layout(
					`<p class="error">Access denied. Your email (${userInfo.email}) is not authorized to use this service.</p>`,
					"Access Denied"
				),
				403
			);
		}
		
		// Set auth cookies
		setCookie(c, "auth_email", userInfo.email, {
			httpOnly: true,
			secure: true,
			sameSite: "Lax",
			maxAge: 3600, // 1 hour
		});
		
		const sessionToken = crypto.randomUUID();
		setCookie(c, "auth_token", sessionToken, {
			httpOnly: true,
			secure: true,
			sameSite: "Lax",
			maxAge: 3600, // 1 hour
		});
		
		// Store session info in KV
		await c.env.OAUTH_KV.put(
			`session:${sessionToken}`,
			JSON.stringify({
				email: userInfo.email,
				name: userInfo.name,
				picture: userInfo.picture,
				expiresAt: Date.now() + 3600000, // 1 hour
			}),
			{ expirationTtl: 3600 }
		);
		
		// Redirect back to authorize with session
		const oauthScopes = [
			{
				name: "read_profile",
				description: "Read your basic profile information",
			},
			{ name: "read_data", description: "Access your stored data" },
			{ name: "write_data", description: "Create and modify your data" },
		];
		
		const content = await renderLoggedInAuthorizeScreen(oauthScopes, oauthReqInfo, userInfo.email);
		return c.html(layout(content, "MCP Remote Auth Demo - Authorization"));
		
	} catch (error) {
		console.error("OAuth callback error:", error);
		return c.html(
			layout(
				`<p class="error">Authentication failed: ${error.message}</p>`,
				"Authentication Error"
			),
			500
		);
	}
});

// Logout endpoint
app.post("/logout", async (c) => {
	const sessionToken = getCookie(c, "auth_token");
	
	if (sessionToken) {
		await c.env.OAUTH_KV.delete(`session:${sessionToken}`);
	}
	
	// Clear cookies
	setCookie(c, "auth_email", "", { maxAge: 0 });
	setCookie(c, "auth_token", "", { maxAge: 0 });
	
	return c.redirect("/");
});

export default app;
