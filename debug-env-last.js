// auth-manager.js
import { Dropbox } from 'dropbox';

class AuthenticationManager {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.isInitialized = false;
        this.isAuthenticating = false;
        
        // Authentication state keys
        this.AUTH_STATE_KEY = 'dropbox_auth_state';
        this.TOKEN_EXPIRY_KEY = 'dropbox_token_expiry';
        this.TOKEN_EXPIRY_DAYS = 30;
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            // Only initialize if Dropbox is available
            console.log('Initializing authentication manager...');
            if (typeof Dropbox === 'undefined') {
                throw new Error('Dropbox SDK not loaded');
            }
            const storedAuth = localStorage.getItem(this.AUTH_STATE_KEY);
            const tokenExpiry = localStorage.getItem(this.TOKEN_EXPIRY_KEY);

            if (storedAuth && tokenExpiry) {
                const expiryDate = new Date(parseInt(tokenExpiry));
                if (expiryDate > new Date()) {
                    console.log('Found valid stored authentication');
                    const { access_token, refresh_token } = JSON.parse(storedAuth);
                    this.client = new Dropbox({
                        accessToken: access_token,
                        refreshToken: refresh_token,
                        clientId: this.config.DROPBOX_API_CONFIG.clientId,
                        clientSecret: this.config.DROPBOX_API_CONFIG.clientSecret
                    });
                } else {
                    console.log('Token expired, attempting refresh...');
                    await this.refreshToken();
                }
            }

            if (!this.client) {
                console.log('Creating new Dropbox client...');
                this.client = new Dropbox({
                    clientId: this.config.DROPBOX_API_CONFIG.clientId,
                    clientSecret: this.config.DROPBOX_API_CONFIG.clientSecret
                });
            }
            
            this.isInitialized = true;
            console.log('Authentication manager initialized');
        } catch (error) {
            console.error('Failed to initialize auth manager:', error);
            this.clearAuth();
            throw error;
        }
    }

    async authenticate() {
        if (this.isAuthenticating) return false;
        this.isAuthenticating = true;

        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            if (!this.client) {
                console.warn('Dropbox client not available');
                return false;
            }

            const redirectUri = `${window.location.origin}/auth-callback`;
            const scopes = [
                "account_info.read",
                "files.metadata.read",
                "files.content.write",
                "files.content.read"
            ];

            const authUrl = await this.client.auth.getAuthenticationUrl(
                redirectUri,
                null,
                'code',
                'offline',
                scopes,
                'none',
                false
            );

            return new Promise((resolve) => {
                const handleAuth = async (event) => {
                    if (event.origin !== window.location.origin) return;
                    
                    try {
                        const { code } = event.data;
                        if (code) {
                            await this.handleAuthCode(code, redirectUri);
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    } catch (error) {
                        console.error('Auth handler error:', error);
                        resolve(false);
                    } finally {
                        window.removeEventListener('message', handleAuth);
                        this.isAuthenticating = false;
                    }
                };

                window.addEventListener('message', handleAuth, { once: true });
                window.open(authUrl, '_blank');
            });
        } catch (error) {
            console.error('Authentication failed:', error);
            this.isAuthenticating = false;
            return false;
        }
    }

    async handleAuthCode(code, redirectUri) {
        this.client.auth.setClientSecret(this.config.DROPBOX_API_CONFIG.clientSecret);
        const response = await this.client.auth.getAccessTokenFromCode(redirectUri, code);
        const { access_token, refresh_token } = response.result;
        this.storeAuth(access_token, refresh_token);
    }

    storeAuth(access_token, refresh_token) {
        const authState = JSON.stringify({ access_token, refresh_token });
        localStorage.setItem(this.AUTH_STATE_KEY, authState);
        
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + this.TOKEN_EXPIRY_DAYS);
        localStorage.setItem(this.TOKEN_EXPIRY_KEY, expiryDate.getTime().toString());
    }

    async refreshToken() {
        try {
            const storedAuth = localStorage.getItem(this.AUTH_STATE_KEY);
            if (!storedAuth) return false;

            const { refresh_token } = JSON.parse(storedAuth);
            const response = await this.client.auth.refreshAccessToken(refresh_token);
            const { access_token: new_access_token, refresh_token: new_refresh_token } = response.result;

            this.storeAuth(new_access_token, new_refresh_token);
            return true;
        } catch (error) {
            console.error('Token refresh failed:', error);
            this.clearAuth();
            return false;
        }
    }

    clearAuth() {
        console.log('Clearing authentication state...');
        // Clear any local storage items
        localStorage.removeItem(this.AUTH_STATE_KEY);
        localStorage.removeItem(this.TOKEN_EXPIRY_KEY);

        // Clear any session storage items
        sessionStorage.removeItem('dropbox_auth_code');
        
        // Reset client and initialization state
        this.client = null;
        this.isInitialized = false;
        this.isAuthenticating = false;
    }

    getClient() {
        return this.client;
    }
}

export default AuthenticationManager;