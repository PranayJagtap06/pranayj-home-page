// debug-env-lastlatest.js
import { Dropbox } from 'dropbox';
import { parse } from 'url';
import { randomBytes, createHash } from 'crypto';
import config from './config.js';

console.log('DropBox ID,Secret:', {
    DROPBOX_CLIENT_ID: config.DROPBOX_API_CONFIG.clientId,
    DROPBOX_CLIENT_SECRET: config.DROPBOX_API_CONFIG.clientSecret,
});

let client;
const AUTH_STATE_KEY = 'dropbox_auth_state';
const TOKEN_EXPIRY_KEY = 'dropbox_token_expiry';
const TOKEN_EXPIRY_DAYS = 30; // Token valid for 7 days

export const initializeClient = async () => {
    // if (client) return client;

    const storedAuth = localStorage.getItem(AUTH_STATE_KEY);
    const tokenExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);

    if (storedAuth && tokenExpiry) {
        const expiryDate = new Date(parseInt(tokenExpiry));
        if (expiryDate > new Date()) {
            try {
                const { access_token, refresh_token } = JSON.parse(storedAuth);
                client = new Dropbox({
                    accessToken: access_token,
                    refreshToken: refresh_token,
                    clientId: config.DROPBOX_API_CONFIG.clientId,
                    clientSecret: config.DROPBOX_API_CONFIG.clientSecret
                });
                return client;
            } catch (error) {
                console.warn('Failed to restore client from stored auth:', error);
                clearStoredAuth();
            }
        } else {
            clearStoredAuth();
        }
    }

    client = new Dropbox({
        clientId: config.DROPBOX_API_CONFIG.clientId,
        clientSecret: config.DROPBOX_API_CONFIG.clientSecret
    });
    return client;
};

export const clearStoredAuth = () => {
    localStorage.removeItem(AUTH_STATE_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    client = null;
}

function generateRandomString(length) {
    return randomBytes(length).toString('hex').slice(0, length);
}

function generateCodeChallenge(codeVerifier) {
    const sha256 = createHash('sha256').update(codeVerifier).digest('base64');
    return sha256.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function storeAuthState(access_token, refresh_token) {
    const authState = JSON.stringify({ access_token, refresh_token });
    localStorage.setItem(AUTH_STATE_KEY, authState);
    
    // Set token expiry
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + TOKEN_EXPIRY_DAYS);
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiryDate.getTime().toString());
}

export const refreshAccessToken = async () => {
    try {
        const storedAuth = localStorage.getItem(AUTH_STATE_KEY);
        if (!storedAuth) throw new Error('No refresh token available');

        const { refresh_token } = JSON.parse(storedAuth);
        const response = await client.auth.refreshAccessToken(refresh_token);
        const { access_token: new_access_token, refresh_token: new_refresh_token } = response.result;

        storeAuthState(new_access_token, new_refresh_token);
        return true;
    } catch (error) {
        console.error('Failed to refresh token:', error);
        clearStoredAuth();
        return false;
    }
}

export const authenticate = async () => {
    try {
        if (!client) {
            await initializeClient();
        }

        // Check if there's valid stored authentication
        const storedAuth = localStorage.getItem(AUTH_STATE_KEY);
        const tokenExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);

        if (storedAuth && tokenExpiry) {
            const expiryDate = new Date(parseInt(tokenExpiry));
            
            if (expiryDate > new Date()) {
                console.log('Using stored authentication');
                return true;
            } else {
                // Try to refresh the token
                const refreshed = await refreshAccessToken();
                if (refreshed) return true;
            }
        }

        // If no valid stored auth, proceed with new authentication
        const scopes = [
            "account_info.read",
            "files.metadata.read",
            "files.content.write",
            "files.content.read"
        ];

        const redirectUri = `${window.location.origin}/auth-callback`;
        const authUrl = await client.auth.getAuthenticationUrl(
            redirectUri,
            null,
            'code',
            'offline',
            scopes,
            'none',
            false
        );

        return new Promise((resolve) => {
            window.addEventListener('message', async function handleAuthMessage(event) {
                if (event.origin !== window.location.origin) return;
                
                try {
                    const { code } = event.data;
                    if (code) {
                        client.auth.setClientSecret(config.DROPBOX_API_CONFIG.clientSecret);
                        const tokenResponse = await client.auth.getAccessTokenFromCode(
                            `${window.location.origin}/auth-callback`,
                            code
                        );
                        
                        const { access_token, refresh_token } = tokenResponse.result;
                        
                        // Store the authentication state
                        storeAuthState(access_token, refresh_token);

                        client = new Dropbox({
                            accessToken: access_token,
                            refreshToken: refresh_token,
                            clientId: config.DROPBOX_API_CONFIG.clientId,
                            clientSecret: config.DROPBOX_API_CONFIG.clientSecret
                        });

                        console.log('Successfully authenticated with Dropbox!');
                        window.removeEventListener('message', handleAuthMessage);
                        resolve(true);
                    } else {
                        console.error('Failed to retrieve code from URL');
                        window.removeEventListener('message', handleAuthMessage);
                        resolve(false);
                    }
                } catch (error) {
                    console.error('Failed to retrieve access token from Dropbox:', error);
                    window.removeEventListener('message', handleAuthMessage);
                    resolve(false);
                }
            }, { once: true });

            window.open(authUrl, '_blank');
        });
    } catch (error) {
        console.error('Dropbox authentication failed:', error);
        return false;
    }
};

export default {
    authenticate,
    initializeClient
};