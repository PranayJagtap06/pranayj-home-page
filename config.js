const config = {
    DROPBOX_API_CONFIG: {
        clientId: process.env.DROPBOX_CLIENT_ID || '',
        clientSecret: process.env.DROPBOX_CLIENT_SECRET || '',
        // Default redirect URI - should match your app's configuration in Dropbox Developer Console
        // redirectUri: process.env.DROPBOX_REDIRECT_URI || 'http://localhost:3000/auth-callback',
        // Scopes required for file operations in app folder
        // scopes: ['files.app_folder']
    }
};

export default config;