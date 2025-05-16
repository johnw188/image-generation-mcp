import type { Bindings } from "./app";

export interface GoogleTokenResponse {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
    id_token?: string;
}

export interface GoogleUserInfo {
    id: string;
    email: string;
    verified_email: boolean;
    name: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
}

export interface GoogleOAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    allowedEmails: string[];
}

export class GoogleAuth {
    private config: GoogleOAuthConfig;

    constructor(config: GoogleOAuthConfig) {
        this.config = config;
    }

    getAuthorizationUrl(state: string, scope = "openid email profile"): string {
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            response_type: "code",
            scope,
            state,
            access_type: "offline",
            prompt: "consent",
        });

        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    async exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
        const tokenUrl = "https://oauth2.googleapis.com/token";
        const params = new URLSearchParams({
            code,
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            redirect_uri: this.config.redirectUri,
            grant_type: "authorization_code",
        });

        const response = await fetch(tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to exchange code for tokens: ${errorText}`);
        }

        return response.json();
    }

    async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
        const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new Error("Failed to fetch user info");
        }

        return response.json();
    }

    isEmailAllowed(email: string): boolean {
        return this.config.allowedEmails.includes(email.toLowerCase());
    }

    async verifyIdToken(idToken: string): Promise<any> {
        // For production, you should verify the JWT token properly
        // This is a simplified implementation
        const tokenParts = idToken.split(".");
        if (tokenParts.length !== 3) {
            throw new Error("Invalid ID token format");
        }

        const payload = JSON.parse(atob(tokenParts[1]));
        
        // Basic validation
        if (payload.aud !== this.config.clientId) {
            throw new Error("Invalid audience");
        }

        if (payload.exp * 1000 < Date.now()) {
            throw new Error("Token expired");
        }

        return payload;
    }
}

export async function createGoogleAuth(env: Bindings): Promise<GoogleAuth> {
    // These should be stored in environment variables or secrets
    const config: GoogleOAuthConfig = {
        clientId: env.GOOGLE_CLIENT_ID || "",
        clientSecret: env.GOOGLE_CLIENT_SECRET || "",
        redirectUri: env.GOOGLE_REDIRECT_URI || `${env.WORKER_URL || "http://localhost:8787"}/callback`,
        allowedEmails: (env.ALLOWED_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(e => e),
    };

    if (!config.clientId || !config.clientSecret) {
        throw new Error("Google OAuth credentials not configured");
    }

    if (config.allowedEmails.length === 0) {
        throw new Error("No allowed emails configured");
    }

    return new GoogleAuth(config);
}