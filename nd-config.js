// config.js (Corrected Node.js version)
import dotenv from 'dotenv';

// Try to load environment variables from .env file first.
// This should be called right at the beginning.
try {
    dotenv.config();
    // console.log('.env file loaded (if exists)');
} catch (error) {
    console.warn("Could not load .env file (this might be normal if not using one):", error.message);
}


// Define the config object directly using process.env
// process.env will contain variables from the system environment AND those loaded by dotenv.
const config = {
    DROPBOX_API_CONFIG: {
        // Ensure fallback to empty string if undefined
        clientId: process.env.DROPBOX_CLIENT_ID || '',
        clientSecret: process.env.DROPBOX_CLIENT_SECRET || '',
    }
};

// Check and warn if variables are missing AFTER defining the config object
if (!config.DROPBOX_API_CONFIG.clientId || !config.DROPBOX_API_CONFIG.clientSecret) {
    console.warn(`
    ***********************************************************
    * WARNING: Dropbox Client ID or Secret is missing.        *
    * Please set DROPBOX_CLIENT_ID and DROPBOX_CLIENT_SECRET  *
    * environment variables OR create a correctly named .env  *
    * file in the project root directory.                     *
    *                                                         *
    * Example .env file:                                      *
    * DROPBOX_CLIENT_ID=your_app_key_here                     *
    * DROPBOX_CLIENT_SECRET=your_app_secret_here              *
    ***********************************************************
    `);
} else {
    // Only log success if they are present.
    console.log('Dropbox config loaded successfully.');
    // You can uncomment these for debugging if needed:
    // console.log('Loaded DropBox ID:', config.DROPBOX_API_CONFIG.clientId ? 'present' : 'not present');
    // console.log('Loaded DropBox Secret:', config.DROPBOX_API_CONFIG.clientSecret ? 'present' : 'not present');
}

// Export the config object. This is now guaranteed to run after dotenv.config()
export default config;