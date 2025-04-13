// debug-env.js
import config from './nd-config.js';
import { Dropbox } from 'dropbox';
import { randomBytes, createHash } from 'crypto';
import readline from 'readline/promises'; // Use promises interface
import { readAuthState, writeAuthState, clearAuthState as clearStoredAuthFile } from './nd-fileStorage.js';
import fetch from 'node-fetch'; // For Dropbox SDK dependency, use global in Node 18+

// Polyfill fetch for Dropbox SDK if needed (Node < 18)
if (!globalThis.fetch) {
    globalThis.fetch = fetch;
}


console.log('DropBox ID,Secret:', {
    DROPBOX_CLIENT_ID: config.DROPBOX_API_CONFIG.clientId ? 'present' : 'not present',
    DROPBOX_CLIENT_SECRET: config.DROPBOX_API_CONFIG.clientSecret ? 'present' : 'not present',
});

let client;
const TOKEN_EXPIRY_DAYS = 15; // Token valid for 15 days - NOTE: Dropbox refresh tokens don't expire this way typically
// Access tokens expire much sooner (hours). We rely on refresh token.
// The expiry check might be less relevant with PKCE+refresh tokens.
const REDIRECT_URI = 'http://localhost'; // Must match one registered in your Dropbox App console

export const initializeClient = async () => {
    // if (client) return client; // Keep client instance if already initialized
    try {
        const storedAuth = await readAuthState();

        if (storedAuth?.access_token && storedAuth?.refresh_token) {
            // Basic check if tokens exist - more robust expiry check happens during requests/refresh
            console.log('Found stored auth state.');
            try {
                client = new Dropbox({
                    fetch: fetch, // Pass fetch implementation
                    accessToken: storedAuth.access_token,
                    refreshToken: storedAuth.refresh_token,
                    clientId: config.DROPBOX_API_CONFIG.clientId,
                    clientSecret: config.DROPBOX_API_CONFIG.clientSecret
                });
                // Optional: Verify token immediately (makes startup slower)
                // await client.usersGetCurrentAccount();
                console.log('Dropbox client initialized with stored tokens.');
                return client;
            } catch (error) {
                console.warn('Failed to initialize client with stored tokens (might be invalid):', error);
                await clearStoredAuthFile(); // Clear invalid tokens
            }
        }

        // Initialize without tokens if none stored or stored were invalid
        client = new Dropbox({
            fetch: fetch, // Pass fetch implementation
            clientId: config.DROPBOX_API_CONFIG.clientId,
            clientSecret: config.DROPBOX_API_CONFIG.clientSecret
        });
        console.log('Dropbox client initialized without tokens.');
        return client;
    } catch (err) {
        console.error("Failed to initialize Dropbox client:", err);
        return null;
    }
};

export const clearStoredAuth = async () => {
    await clearStoredAuthFile();
    client = null; // Reset the client instance
    console.log('Cleared stored auth and client instance.');
}

// Crypto functions remain the same as they use Node's 'crypto'
function generateRandomString(length) {
    return randomBytes(length).toString('hex').slice(0, length);
}

function generateCodeChallenge(codeVerifier) {
    const hash = createHash('sha256').update(codeVerifier).digest();
    return Buffer.from(hash).toString('base64url'); // Use base64url encoding
}

async function storeAuthState(access_token, refresh_token) {
    const authState = { access_token, refresh_token, timestamp: Date.now() };
    await writeAuthState(authState);
    console.log('Stored new auth state.');

    // Re-initialize client with new tokens
    client = new Dropbox({
        fetch: fetch,
        accessToken: access_token,
        refreshToken: refresh_token,
        clientId: config.DROPBOX_API_CONFIG.clientId,
        clientSecret: config.DROPBOX_API_CONFIG.clientSecret
    });
    console.log('Client updated with new tokens.');
}

export const refreshAccessToken = async () => {
    if (!client) {
        console.error('Client not initialized, cannot refresh token.');
        return false;
    }
    // The SDK handles refresh internally if refreshToken is provided during construction.
    // We just need to ensure the client object has the refreshToken.
    // If an API call fails with 401, the SDK *should* attempt refresh automatically.
    // This function might be redundant unless we want to force a refresh test.
    console.log('Attempting to force refresh token check (via SDK internal mechanism)...');
    try {
        // Get current refresh token from the client if available
        const currentRefreshToken = client.auth.getRefreshToken(); // Check SDK method name
        if (!currentRefreshToken) {
            const storedAuth = await readAuthState();
            if (!storedAuth?.refresh_token) {
                console.error('No refresh token available in client or storage.');
                await clearStoredAuth();
                return false;
            }
            // Manually set refresh token if client didn't have it
            client.auth.setRefreshToken(storedAuth.refresh_token);
            console.log('Manually set refresh token on client from storage.');
        }

        // Trigger a refresh explicitly if needed (SDK >= v10 handles internally, but let's try)
        // NOTE: Check Dropbox SDK docs for the correct way to force refresh if required.
        // The 'auth.checkAndRefreshAccessToken' might be internal.
        // A simple API call might trigger it.
        await client.usersGetCurrentAccount(); // This call should trigger auto-refresh if needed
        console.log('Token refresh check successful (either refreshed or still valid).');

        // Update stored tokens if they were refreshed by the SDK call
        const newAccessToken = client.auth.getAccessToken();
        const newRefreshToken = client.auth.getRefreshToken(); // SDK might provide a new one
        const stored = await readAuthState();
        if (newAccessToken && (!stored || newAccessToken !== stored.access_token)) {
            console.log('Access token changed, updating storage.');
            await storeAuthState(newAccessToken, newRefreshToken || currentRefreshToken); // Store potentially new refresh token
        }

        return true;
    } catch (error) {
        console.error('Failed during token refresh check:', error);
        if (error.status === 401 || (error.error?.error_summary?.includes('invalid_grant'))) {
            console.error('Refresh failed (likely invalid grant), clearing stored auth.');
            await clearStoredAuth(); // Clear bad tokens
        }
        return false;
    }
}

// Checks if we have tokens (doesn't guarantee validity)
export const hasStoredAuth = async () => {
    const storedAuth = await readAuthState();
    return !!(storedAuth?.access_token && storedAuth?.refresh_token);
};

// Tries to authenticate using stored tokens, returns true if potentially valid, false otherwise
export const authenticate = async () => {
    try {
        if (!client) {
            await initializeClient();
        }

        // Check if client has an access token (meaning it was loaded from storage or newly acquired)
        if (client?.auth?.getAccessToken()) {
            console.log('Client has an access token.');
            // Optionally, test the token here
            try {
                await client.usersGetCurrentAccount();
                console.log('Stored token appears valid.');
                return true;
            } catch (testError) {
                if (testError.status === 401) {
                    console.log('Stored token invalid/expired, attempting refresh...');
                    const refreshed = await refreshAccessToken(); // Relies on SDK's internal refresh
                    return refreshed;
                } else {
                    console.error('Error validating token:', testError);
                    return false; // Other error
                }
            }
        } else {
            console.log('No access token found in client. Authentication needed.');
            return false;
        }
    } catch (error) {
        console.error('Failed during authentication check:', error);
        return false;
    }
};

// Replaces openAuthPopup - guides user through manual auth flow
export const performManualAuthFlow = async () => {
    try {
        if (!client) {
            await initializeClient();
        }
        if (!config.DROPBOX_API_CONFIG.clientId || !config.DROPBOX_API_CONFIG.clientSecret) {
            throw new Error("Dropbox Client ID or Secret is not configured.");
        }

        console.log('Starting manual Dropbox authentication flow...');
        const scopes = [
            "account_info.read",
            "files.metadata.read", // ".metadata.write" might also be needed depending on ops
            "files.content.write",
            "files.content.read"
        ];

        // const scopeString = scopes.join('%20'); // Join with spaces

        // PKCE Code Generation
        const codeVerifier = generateRandomString(128);
        const codeChallenge = generateCodeChallenge(codeVerifier);

        const authUrl = await client.auth.getAuthenticationUrl(
            REDIRECT_URI,
            null, // Optional: Can omit if null or add a value if needed
            'code',
            'offline',
            scopes,
            'none',
            false,
            { // Pass PKCE data as an object
                codeChallenge: codeChallenge,
                codeChallengeMethod: 'S256'
            }
        );

        console.log('\n--- PLEASE AUTHENTICATE WITH DROPBOX ---');
        console.log('1. Open the following URL in your web browser:');
        console.log(`\n${authUrl}\n`);
        console.log('2. Authorize the application.');
        console.log(`3. You will be redirected to ${REDIRECT_URI} (it might show an error - this is OK).`);
        console.log('4. Copy the value of the "code" parameter from the address bar.');
        console.log('   (It looks like: code=XXXXXXXXXXXXXX)');
        console.log('5. Paste the code here and press Enter:');

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const code = await rl.question('> ');
        rl.close();

        if (!code) {
            console.error('No code provided. Authentication cancelled.');
            return false;
        }

        console.log('Received code, exchanging for tokens...');

        // Exchange code for tokens using PKCE
        // Ensure client secret is set if not done during init
        client.auth.setClientSecret(config.DROPBOX_API_CONFIG.clientSecret);

        console.log('Using Code Verifier:', codeVerifier ? 'Present' : 'MISSING!!!');

        const tokenResponse = await client.auth.getAccessTokenFromCode(
            REDIRECT_URI,
            code,
            codeVerifier // Provide the verifier for PKCE
        );

        const { access_token, refresh_token } = tokenResponse.result;
        console.log('Received tokens from Dropbox.');

        // Store the authentication state
        await storeAuthState(access_token, refresh_token);

        console.log('Successfully authenticated with Dropbox!');
        return true;

    } catch (error) {
        console.error('Dropbox authentication failed:', error?.error || error?.message || error);
        // Log the full error if available
        if (error.error) {
            console.error("Dropbox API Error:", JSON.stringify(error.error, null, 2));
        }
        if (error.response) {
            console.error("Dropbox API Response Status:", error.response.status);
            try {
                const body = await error.response.text();
                console.error("Dropbox API Response Body:", body);
            } catch (e) {/*ignore*/ }
        }
        return false;
    }
};