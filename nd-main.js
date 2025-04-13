// main.js
import BrowserSyncManager from './nd-bwsrSync.js'; // Use default import

async function run() {
    console.log('Initializing Browser Sync Manager...');
    const syncManager = new BrowserSyncManager();

    const initialized = await syncManager.initialize();

    if (initialized) {
        console.log('Manager initialized successfully with existing auth.');
    } else {
        console.log('Initialization incomplete. Authentication might be required.');
        // Attempt manual authentication if initialization failed due to auth
        if (!syncManager.isAuthenticated) {
            console.log('Attempting manual authentication...');
            const authSuccess = await syncManager.authenticateManually();
            if (!authSuccess) {
                console.error('Manual authentication failed. Exiting.');
                return; // Exit if auth fails
            }
            console.log('Manual authentication successful.');
        } else {
            console.error('Initialization failed for reasons other than auth. Exiting.');
            return; // Exit for other init failures
        }
    }

    // Now the manager should be authenticated
    if (!syncManager.isAuthenticated) {
        console.error("Manager is not authenticated even after attempting auth. Exiting.");
        return;
    }

    console.log('\n--- Starting Sync ---');
    await syncManager.syncData();
    console.log('--- Sync Attempt Finished ---');

    // --- Example Operations ---
    console.log('\n--- Performing Example Operations ---');

    // Example: Add a search history item
    const currentHistory = await syncManager.getArrayFromCache(syncManager.filePaths.history);
    const newHistoryItem = { term: `node-test-${Date.now()}`, lastSearched: Date.now() };
    console.log(`Adding history item: ${newHistoryItem.term}`);
    await syncManager.writeFile(syncManager.filePaths.history, [...currentHistory, newHistoryItem]);

    // Example: Add a favorite
    const currentFavorites = await syncManager.getArrayFromCache(syncManager.filePaths.favorites);
    const newFavorite = {
        title: `Node Test Site ${Date.now()}`,
        url: `https://example.com/node/${Date.now()}`,
        favicon: '',
        pinned: false,
        lastModified: Date.now(),
        order: currentFavorites.length // Append to end
    };
    console.log(`Adding favorite: ${newFavorite.title}`);
    await syncManager.writeFile(syncManager.filePaths.favorites, [...currentFavorites, newFavorite]);

    // Example: Read history after add
    const updatedHistory = await syncManager.readFile(syncManager.filePaths.history); // Use readFile to potentially get from Dropbox
    console.log('\nUpdated History (first 5):', updatedHistory?.slice(0, 5));

    // Example: Delete the added history item  (if found)
    if (updatedHistory?.find(h => h.term === newHistoryItem.term)) {
        console.log(`Deleting history item: ${newHistoryItem.term}`);
        await syncManager.deleteItem(syncManager.filePaths.history, newHistoryItem.term);
        const historyAfterDelete = await syncManager.readFile(syncManager.filePaths.history);
        console.log('History after delete (first 5):', historyAfterDelete?.slice(0, 5));
    }

    // Example: Export favorites cache
    console.log('\nExporting favorites cache...');
    const exportResult = await syncManager.exportCachedArrayToFile(syncManager.filePaths.favorites, 'favorites_export.json');
    console.log(exportResult.message);

    console.log('\n--- Operations Finished ---');

    // Keep the script running briefly to allow background checks/queue processing
    console.log('Script finished. Waiting a few seconds for any queued operations...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('Exiting.');
}

run().catch(error => {
    console.error("\nUnhandled error in main execution:", error);
    process.exit(1); // Exit with error code
});