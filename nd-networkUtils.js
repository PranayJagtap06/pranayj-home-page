// networkUtils.js
import fetch from 'node-fetch'; // Or use global fetch in Node 18+

// Simple check if we can reach a reliable endpoint (like Dropbox API)
export const isOnline = async () => {
    try {
        // Use a lightweight Dropbox endpoint that doesn't require auth
        const response = await fetch('https://api.dropboxapi.com/2/check/user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'connection_test' }), // Minimal payload
            timeout: 5000 // 5 second timeout
        });
        // We don't care about the actual response status (401 Unauthorized is expected without token),
        // just that the request could be made.
        return true;
    } catch (error) {
        // Network errors (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, etc.) indicate offline
        console.warn('Network check failed, assuming offline:', error.code || error.message);
        return false;
    }
};