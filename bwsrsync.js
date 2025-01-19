// browserSyncManager.js
import { initializeClient, authenticate, clearStoredAuth, refreshAccessToken } from './debug-env.js';

class browserSyncManager {
    constructor() {
        // this.authManager = new AuthenticationManager(config);
        this.dbx = null;
        this.isAuthenticated = false;
        this.localCache = new Map();
        this.offlineQueue = [];
        this.lastSync = null;
        this.syncInProgress = false;

        // File paths in Dropbox
        this.filePaths = {
            history: '/Dropbox/Apps/pranayj-home-page/search_history.json',
            favorites: '/Dropbox/Apps/pranayj-home-page/favorites.json'
        };

        // Initialize offline handling
        this.setupOfflineHandling();
    }

    setupOfflineHandling() {
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    }

    async initialize() {
        try {
            if (!this.dbx) {
                this.dbx = await initializeClient();
            }

            if (!this.isAuthenticated) {
                await authenticate();
                this.isAuthenticated = true;
                console.log('Authentication successful');
            }

            if (this.isAuthenticated) {
                // Verify Dropbox connection with a simple test
                try {
                    await this.testConnection(this.dbx);
                    console.log('Dropbox connection verified');
                    await this.syncData();
                } catch (error) {
                    console.error('Failed to verify Dropbox connection:', error);
                    this.isAuthenticated = false;
                    return false;
                }
            }

            return this.isAuthenticated;
        } catch (error) {
            console.error('Failed to initialize sync manager:', error);
            this.isAuthenticated = false;
            return false;
        }
    }

    async testConnection(client) {
        // const client = this.authManager.getClient();
        try {
            // Try to get account information as a connection test
            const user = await client.usersGetCurrentAccount();
            console.log(user)
        } catch (error) {
            if (error.status === 401) {
                // Token might be expired, try to refresh
                const refreshed = await refreshAccessToken();
                if (!refreshed) {
                    throw new Error('Failed to refresh authentication token');
                }
            } else {
                throw error;
            }
        }
    }

    async handleOnline() {
        console.log('Device is online, processing queued operations...');
        await this.processOfflineQueue();
    }

    handleOffline() {
        console.log('Device is offline, operations will be queued');
    }

    async processOfflineQueue() {
        if (!navigator.onLine || this.syncInProgress) return;

        this.syncInProgress = true;

        try {
            while (this.offlineQueue.length > 0) {
                const task = this.offlineQueue.shift();
                await this.processTask(task);
            }
        } catch (error) {
            console.error('Failed to process offline queue:', error);
            // Re-queue failed tasks
            this.offlineQueue.unshift(...this.offlineQueue);
        } finally {
            this.syncInProgress = false;
        }
    }

    async processTask(task) {
        try {
            switch (task.type) {
                case 'write':
                    await this.writeFile(task.path, task.data);
                    break;
                case 'delete':
                    await this.deleteItem(task.path, task.id);
                    break;
                case 'reorder':
                    await this.updateOrder(task.path, task.order);
                    break;
            }
        } catch (error) {
            console.error(`Failed to process task ${task.type}:`, error);
            throw error;
        }
    }

    queueOperation(operation) {
        this.offlineQueue.push({
            ...operation,
            timestamp: Date.now()
        });

        if (navigator.onLine) {
            this.processOfflineQueue();
        }
    }

    async readFile(path) {
        if (!this.isAuthenticated) {
            console.log('Not authenticated, returning null for path:', path);
            return null;
        }

        try {
            // const client = this.authManager.getClient();
            const client = this.dbx;
            console.log('Attempting to read file:', path);

            // First check if the file exists
            try {
                await this.dbx.filesGetMetadata({ path });
            } catch (error) {
                if (error.status === 409) {
                    console.log('File does not exist, creating empty file:', path);
                    // Create empty file
                    await this.dbx.filesUpload({
                        path,
                        contents: JSON.stringify([]),
                        mode: 'add',
                        autorename: true,
                        mute: false
                    });
                    console.log('File uploaded successfully');
                    const data = JSON.parse(await response.fileBlob);

                    // Update cache
                    this.localCache.set(path, {
                        data,
                        timestamp: Date.now()
                    });
                    return [];
                }
                // throw error;
                console.error(`Failed to get file metadata ${path}:`, error);
            }

            const response = await this.dbx.filesDownload({ path });
            console.log('File downloaded successfully');
            const blob = await response.fileBlob;
            // const data = await blob.JSON();
            // const data = JSON.parse(text);

            // Update cache
            this.localCache.set(path, {
                blob,
                timestamp: Date.now()
            });

            return blob;
        } catch (error) {
            console.error(`Failed to read file ${path}:`, error);
            // Check if it's an authentication error
            if (error.status === 401) {
                console.log('Authentication error, attempting to refresh token...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    // Retry the operation
                    return this.readFile(path);
                }
            }
            return this.localCache.get(path)?.data || null;
        }
    }

    async writeFile(path, data) {
        if (!this.isAuthenticated) {
            console.log('Not authenticated, queuing operations for path:', path);
            this.queueOperation({ type: 'write', path, data });
            return;
        }

        try {
            // const client = this.authManager.getClient();
            const client = this.dbx;
            console.log('Attempting to write file:', path);

            await this.dbx.filesUpload({
                path,
                contents: JSON.stringify(data),
                mode: 'overwrite',
                autorename: false,
                mute: false
            });
            console.log('File uploaded successfully.');

            // Update cache

            this.localCache.set(path, {
                data,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error(`Failed to write to ${path}:`, error);
            // Check if it's an authentication error
            if (error.status === 401) {
                console.log('Authentication error, attempting to refresh token...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    // Retry the operation
                    return this.writeFile(path, data);
                }
            }
            this.queueOperation({ type: 'write', path, data });
        }
    }

    async deleteItem(path, itemId) {
        if (!this.isAuthenticated) {
            console.log('Not authenticated, queuing operations for path:', path);
            this.queueOperation({ type: 'delete', path, itemId });
            return;
        }

        try {
            // const client = this.authManager.getClient();
            const client = this.dbx;
            const data = await this.readFile(path) || [];
            console.log('Attempting to read file:', path);

            // First check if the file exists
            try {
                await this.dbx.filesGetMetadata({ path });
            } catch (error) {
                if (error.status === 409) {
                    console.log('File does not exist, nothing to delete:', path);
                    return [];
                }
                throw error;
            }

            const updatedData = data.filter(item => {
                return path === this.filePaths.history ?
                    item.term !== itemId :
                    item.url !== itemId;
            });

            await this.writeFile(path, updatedData);
        } catch (error) {
            console.error(`Failed to delete item from ${path}:`, error);
            // Check if it's an authentication error
            if (error.status === 401) {
                console.log('Authentication error, attempting to refresh token...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    // Retry the operation
                    return this.deleteItem(path, itemId);
                }
            }
            this.queueOperation({ type: 'delete', path, itemId });
        }
    }

    async updateOrder(path, newOrder) {
        if (!this.isAuthenticated) {
            console.log('Not authenticated, queuing operations for path:', path);
            this.queueOperation({ type: 'reorder', path, order: newOrder });
            return;
        }

        try {
            // const client = this.authManager.getClient();
            const client = this.dbx;
            const data = await this.readFile(path) || [];
            console.log('Attempting to read file:', path);

            // First check if the file exists
            try {
                await this.dbx.filesGetMetadata({ path });
            } catch (error) {
                if (error.status === 409) {
                    console.log('File does not exist, nothing to update:', path);
                    return null;
                }
                throw error;
            }

            const reorderedData = newOrder.map(index => ({
                ...data[index],
                lastModified: Date.now()
            }));

            await this.writeFile(path, reorderedData);
        } catch (error) {
            console.error('Failed to update order:', error);
            // Check if it's an authentication error
            if (error.status === 401) {
                console.log('Authentication error, attempting to refresh token...');
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    // Retry the operation
                    return this.updateOrder(path, newOrder);
                }
            }
            this.queueOperation({ type: 'reorder', path, order: newOrder });
        }
    }

    async syncData() {
        if (this.syncInProgress) return;
        this.syncInProgress = true;

        try {
            await Promise.all([
                this.syncSearchHistory(),
                this.syncFavorites()
            ]);

            this.lastSync = Date.now();
        } catch (error) {
            console.error('Sync failed:', error);
        } finally {
            this.syncInProgress = false;
        }
    }

    normalizeSearchHistory(history) {
        console.log(`Data: ${JSON.stringify(history)}`);
        console.log(`Data type: ${typeof history}`);
        return history.forEach(item => ({
           term: item.term || item, // Handle both string and object format
            lastSearched: item.lastSearched || Date.now()
       }));
    }

    normalizeFavorites(favorites) {
        return favorites.forEach(item => ({
            title: item.title || '',
           favicon: item.favicon || '',
            url: item.url || '',
           pinned: item.pinned || false,
            lastModified: item.lastModified || Date.now(),
            order: item.order || 0
        }));
    }

    mergeSearchHistory(local, remote) {
        const normalizedLocal = this.normalizeSearchHistory(local);
        const normalizedRemote = this.normalizeSearchHistory(remote);

        const merged = new Map();

        // Process local entries
        normalizedLocal.forEach(item => {
            merged.set(item.term, item);
        });

        // Merge remote entries
        normalizedRemote.forEach(item => {
            const existingItem = merged.get(item.term);
            if (!existingItem || item.lastSearched > existingItem.lastSearched) {
                merged.set(item.term, item);
            }
        });

        return Array.from(merged.values()).sort((a, b) => b.lastSearched - a.lastSearched);
    }

    mergeFavorites(local, remote) {
        const normalizedLocal = this.normalizeFavorites(local);
        const normalizedRemote = this.normalizeFavorites(remote);

        const merged = new Map();

        // Process local entries
         normalizedLocal.forEach(item => {
            merged.set(item.url, item);
        });

        // Merge remote entries
        normalizedRemote.forEach(item => {
            const existingItem = merged.get(item.url);
            if (!existingItem || item.lastModified > existingItem.lastModified) {
                merged.set(item.url, item);
            }
        });

        return Array.from(merged.values())
            .sort((a, b) => {
                 // Sort by pinned status first
                if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
                // Then by order if available
                 if (a.order !== b.order) return (a.order || 0) - (b.order || 0);
                // Finally by title
                return (a.title || '').localeCompare(b.title || '');
           });
    }

    async syncSearchHistory() {
        try {
            const localData = JSON.parse(localStorage.getItem('searchHistory') || '[]')
                // .map(term => ({ term, lastSearched: Date.now() }));
                
            const remoteData = await this.readFile(this.filePaths.history);

            const mergedData = this.mergeSearchHistory(localData, remoteData);
            await this.writeFile(this.filePaths.history, mergedData);

            // Update local storage
            localStorage.setItem('searchHistory',
                JSON.stringify(mergedData.map(item => item.term)));

            return mergedData;
        } catch (error) {
            console.error('Failed to sync search history:', error);
            throw error;
        }
    }

    async syncFavorites() {
        try {
            const localData = JSON.parse(localStorage.getItem('mostVisited') || '[]');
            const remoteData = await this.readFile(this.filePaths.favorites) || [];

            const mergedData = this.mergeFavorites(localData, remoteData);
            await this.writeFile(this.filePaths.favorites, mergedData);

            // Update local storage
            localStorage.setItem('mostVisited', JSON.stringify(mergedData));

            return mergedData;
        } catch (error) {
            console.error('Failed to sync favorites:', error);
            throw error;
        }
    }
}

export default browserSyncManager;