// dropboxSyncManager.js
import config from './config.js';
// var Dropbox = require('dropbox').Dropbox;

class DropboxSyncManager {
    constructor() {
        this.Dropbox = window.Dropbox || (typeof Dropbox !== 'undefined' ? Dropbox : null);
        if (!this.Dropbox) {
            console.warn('Dropbox library not loaded');
        }
        this.DROPBOX_API_CONFIG = window.config?.DROPBOX_API_CONFIG || {};
        this.isAuthenticated = false;
        this.searchHistory = [];
        this.favorites = [];
        this.localCache = new Map();
        this.offlineQueue = [];
        this.lastSync = null;
        this.client = null;
        
        // File paths in Dropbox app folder
        this.filePaths = {
            history: '/search_history.json',
            favorites: '/favorites.json'
        };
    }

    // Initialize Dropbox client
    async initializeClient() {
        this.client = new Dropbox(this.DROPBOX_API_CONFIG);

    }

    // Authentication method
    async authenticate() {
        try {
            if (!this.client) {
                await this.initializeClient();
            }

            // Generate authentication URL
            const authUrl = this.client.getAuthenticationUrl(
                window.location.origin + '/auth-callback'
            );

            // Open auth window and handle callback
            const token = await new Promise((resolve) => {
                const authWindow = window.open(authUrl, '_blank');
                window.addEventListener('message', (event) => {
                    if (event.data.type === 'DROPBOX_TOKEN') {
                        resolve(event.data.token);
                        authWindow.close();
                    }
                });
            });

            this.client.setAccessToken(token);
            this.isAuthenticated = true;
            await this.syncData();
            return true;
        } catch (error) {
            console.error('Dropbox authentication failed:', error);
            return false;
        }
    }

    // File operations
    async readFile(path) {
        try {
            const response = await this.client.filesDownload({ path });
            return JSON.parse(await response.fileBlob.text());
        } catch (error) {
            if (error.status === 409) { // File not found
                return null;
            }
            throw error;
        }
    }

    async writeFile(path, data) {
        try {
            await this.client.filesUpload({
                path,
                contents: JSON.stringify(data),
                mode: 'overwrite'
            });
        } catch (error) {
            console.error(`Failed to write to ${path}:`, error);
            throw error;
        }
    }

    // Sync operations
    async syncData() {
        if (!navigator.onLine || !this.isAuthenticated) return;

        try {
            await Promise.all([
                this.syncSearchHistory(),
                this.syncFavorites()
            ]);

            // Process offline queue
            while (this.offlineQueue.length > 0) {
                const task = this.offlineQueue.shift();
                await this.processOfflineTask(task);
            }

            this.lastSync = Date.now();
        } catch (error) {
            console.error('Sync failed:', error);
            throw error;
        }
    }

    // Process offline tasks
    async processOfflineTask(task) {
        switch (task.type) {
            case 'searchHistory':
                await this.syncSearchHistory();
                break;
            case 'favorites':
                await this.syncFavorites();
                break;
        }
    }

    // Search history sync
    async syncSearchHistory() {
        try {
            const serverData = await this.readFile(this.filePaths.history) || [];
            this.searchHistory = this.mergeSearchHistory(this.searchHistory, serverData);
            await this.writeFile(this.filePaths.history, this.searchHistory);
        } catch (error) {
            console.error('Failed to sync search history:', error);
            throw error;
        }
    }

    // Favorites sync
    async syncFavorites() {
        try {
            const serverData = await this.readFile(this.filePaths.favorites) || [];
            this.favorites = this.mergeFavorites(this.favorites, serverData);
            await this.writeFile(this.filePaths.favorites, this.favorites);
        } catch (error) {
            console.error('Failed to sync favorites:', error);
            throw error;
        }
    }

    // The merge methods can remain the same as in the Google Drive version
}

export default DropboxSyncManager;