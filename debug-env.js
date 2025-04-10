// debug-env.js
import config from './config.js';
import { Dropbox } from 'dropbox';
import { randomBytes, createHash } from 'crypto';

console.log('DropBox ID,Secret:', {
    DROPBOX_CLIENT_ID: config.DROPBOX_API_CONFIG.clientId ? 'present' : 'not present',
    DROPBOX_CLIENT_SECRET: config.DROPBOX_API_CONFIG.clientSecret ? 'present' : 'not present',
});

let client;
const AUTH_STATE_KEY = 'dropbox_auth_state';
const TOKEN_EXPIRY_KEY = 'dropbox_token_expiry';
const TOKEN_EXPIRY_DAYS = 15; // Token valid for 15 days

export const initializeClient = async () => {
    // if (client) return client;
    try {
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
                console.log('Stored token expired');
                clearStoredAuth();
            }
        }

        client = new Dropbox({
            clientId: config.DROPBOX_API_CONFIG.clientId,
            clientSecret: config.DROPBOX_API_CONFIG.clientSecret
        });
        return client;
    } catch (err) {
        console.error("Failed to initialize Dropbox client:", err);
        return null;
    }
};

export const clearStoredAuth = () => {
    localStorage.removeItem(AUTH_STATE_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    client = null;
    console.log('Cleared stored auth');
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
    console.log('Stored auth state with expiry:', expiryDate);
}

export const refreshAccessToken = async () => {
    try {
        const storedAuth = localStorage.getItem(AUTH_STATE_KEY);
        if (!storedAuth) throw new Error('No refresh token available');

        const { refresh_token } = JSON.parse(storedAuth);
        console.log('Attempting to refresh token...');
        const response = await client.auth.refreshAccessToken(refresh_token);
        const { access_token: new_access_token, refresh_token: new_refresh_token } = response.result;

        storeAuthState(new_access_token, new_refresh_token);
        console.log('Token refreshed successfully...');
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
                console.log('Stored token expired, attempting refresh');
                const refreshed = await refreshAccessToken();
                if (refreshed) return true;
            }
        }

        return false;
    } catch (error) {
        console.error('Failed to initialize authentication:', error);
        return false;
    }
};

// Add a new function to handle the actual popup opening
export const openAuthPopup = async () => {
    try {
        if (!client) {
            await initializeClient();
        }
        // If no valid stored auth, proceed with new authentication
        console.log('Proceeding with new authentication');
        const scopes = [
            "account_info.read",
            "files.metadata.read",
            "files.content.write",
            "files.content.read"
        ];

        const redirectUri = `${window.location.origin}/auth-callback.html`;
        console.log('Redirect URI:', redirectUri);
        const authUrl = await client.auth.getAuthenticationUrl(
            redirectUri,
            null,
            'code',
            'offline',
            scopes,
            'none',
            false
        );

        console.log('Authentication URL generated');

        return new Promise((resolve) => {
            // Listen for message from auth callback page
            const messageHandler = function(event) {
                console.log('Received event:', event.origin, window.location.origin);
                
                // Accept messages from our origin or any origin during development
                if (event.origin !== window.location.origin && event.origin !== '*') {
                    console.warn('Ignoring message from unknown origin:', event.origin);
                    return;
                }

                try {
                    console.log('Processing auth message:', event.data);
                    const { code, error } = event.data;
                    
                    if (error) {
                        console.error('Auth error received:', error);
                        window.removeEventListener('message', messageHandler);
                        resolve(false);
                        return;
                    }
                    
                    if (code) {
                        // Process the authentication code
                        (async () => {
                            try {
                                console.log('Setting client secret and getting token');
                                client.auth.setClientSecret(config.DROPBOX_API_CONFIG.clientSecret);
                                const tokenResponse = await client.auth.getAccessTokenFromCode(
                                    redirectUri,
                                    code
                                );

                                const { access_token, refresh_token } = tokenResponse.result;
                                console.log('Received tokens from Dropbox');

                                // Store the authentication state
                                storeAuthState(access_token, refresh_token);

                                // Recreate client with the token
                                client = new Dropbox({
                                    accessToken: access_token,
                                    refreshToken: refresh_token,
                                    clientId: config.DROPBOX_API_CONFIG.clientId,
                                    clientSecret: config.DROPBOX_API_CONFIG.clientSecret
                                });

                                console.log('Successfully authenticated with Dropbox!');
                                window.removeEventListener('message', messageHandler);
                                resolve(true);
                            } catch (err) {
                                console.error('Error exchanging code for token:', err);
                                window.removeEventListener('message', messageHandler);
                                resolve(false);
                            }
                        })();
                    } else {
                        console.error('No code or error in message');
                        window.removeEventListener('message', messageHandler);
                        resolve(false);
                    }
                } catch (err) {
                    console.error('Error processing auth message:', err);
                    window.removeEventListener('message', messageHandler);
                    resolve(false);
                }
            };
            
            // Add event listener before opening popup
            window.addEventListener('message', messageHandler);
            
            // Open the auth popup
            console.log('Opening auth popup');
            const popup = window.open(authUrl, 'DropboxAuth', 
                'width=800,height=600,menubar=no,toolbar=no,location=no,status=no');
                
            if (!popup || popup.closed) {
                console.error('Popup blocked or failed to open');
                window.removeEventListener('message', messageHandler);
                resolve(false);
            }
            
            // Also set a timeout in case the popup is closed without sending a message
            setTimeout(() => {
                if (popup && !popup.closed) {
                    console.log('Authentication timed out');
                    window.removeEventListener('message', messageHandler);
                    resolve(false);
                }
            }, 120000); // 2 minute timeout
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