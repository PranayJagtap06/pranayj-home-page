import { Dropbox } from 'dropbox';
import { parse } from 'url';
import { randomBytes, createHash } from 'crypto';
import config from './config.js';

console.log('DropBox ID,Secret:', {
    DROPBOX_CLIENT_ID: config.DROPBOX_API_CONFIG.clientId,
    DROPBOX_CLIENT_SECRET: config.DROPBOX_API_CONFIG.clientSecret,
});

let client;

export const initializeClient = async () => {
    client = new Dropbox({
        clientId: config.DROPBOX_API_CONFIG.clientId,
        clientSecret: config.DROPBOX_API_CONFIG.clientSecret
    });
}

function generateRandomString(length) {
    return randomBytes(length).toString('hex').slice(0, length);
}

function generateCodeChallenge(codeVerifier) {
    const sha256 = createHash('sha256').update(codeVerifier).digest('base64');
    return sha256.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const authenticate = async () => {
    try {
        if (!client) {
            await initializeClient();
        }
        const codeVerifier = generateRandomString(128);
        const codeChallenge = generateCodeChallenge(codeVerifier);

        const scopes = [
            "account_info.read",
            "files.metadata.read",
            "files.content.write",
            "files.content.read"
        ];

        // Use the current origin as the redirect URI
        const redirectUri = `${window.location.origin}/auth-callback.html`;

        const authUrl = await client.auth.getAuthenticationUrl(
            redirectUri,
            null,
            'code',
            'offline',
            scopes,
            'none',
            false  // Set PKCE to false since we're using client secret
        );

        // Store the current URL to return to after auth
        sessionStorage.setItem('auth_redirect_uri', window.location.href);

        // Redirect to Dropbox auth page
        window.location.href = authUrl;

        console.log('\nPlease visit this URL to authenticate:');
        console.log(authUrl);
        console.log('\nWaiting for authentication...\n');

       return new Promise((resolve) => {
            window.addEventListener('message', async function handleAuthMessage(event) {
            if (event.origin !== window.location.origin) return;
                try{
                    const { code } = event.data;
                     if (code) {
                        client.auth.setClientSecret(config.DROPBOX_API_CONFIG.clientSecret);
                            const tokenResponse = await client.auth.getAccessTokenFromCode(
                            `${window.location.origin}/auth-callback.html`, 
                            code
                            );
                            const { access_token, refresh_token } = tokenResponse.result;

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
                             resolve(false)
                        }
                    } catch (error) {
                        console.error('Failed to retrieve access token from Dropbox:', error);
                        window.removeEventListener('message', handleAuthMessage);
                        resolve(false)
                    }
                }, { once: true });

            window.open(authUrl, '_blank');
        });
    } catch (error) {
        console.error('Dropbox authentication failed:', error);
        return false;
    }
}

export default {
    authenticate,
    initializeClient
};