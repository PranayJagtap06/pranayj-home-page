// import browserSyncManager from "./bwsrsync";

// Suggestions Manager Class
class SearchSuggestionsManager {
    constructor(syncManager) {
        this.syncManager = syncManager;
        this.searchBar = document.querySelector('.search-bar');
        this.suggestionsContainer = document.createElement('div');
        this.suggestionsContainer.className = 'search-suggestions';
        this.searchBar.parentNode.appendChild(this.suggestionsContainer);

        this.currentEngine = 'duckduckgo';
        this.selectedIndex = -1;
        this.suggestions = [];
        this.recentSearches = [];
        this.debounceTimeout = null;

        // this.loadRecentSearches();
        this.setupEventListeners();

        // Use synced data if available
        if (this.syncManager && this.syncManager.isAuthenticated) {
            this.recentSearches = this.syncManager.searchHistory.map(item => item.term);
        } else {
            this.loadRecentSearches();
        }

    }

    // Initialize event listeners
    setupEventListeners() {
        this.searchBar.addEventListener('input', () => this.handleInput());
        this.searchBar.addEventListener('keydown', (e) => this.handleKeydown(e));
        document.addEventListener('click', (e) => this.handleClickOutside(e));
    }

    // Load recent searches from localStorage
    loadRecentSearches() {
        this.recentSearches = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    }

    // Save recent searches to localStorage
    async saveRecentSearch(query) {
        if (query) {
            this.recentSearches = [
                query,
                ...this.recentSearches.filter(s => s !== query)
            ].slice(0, 10);
            localStorage.setItem('searchHistory', JSON.stringify(this.recentSearches));

            // Sync to cloud if available
            if (this.syncManager && this.syncManager.isAuthenticated) {
                try {
                    await this.syncManager.writeFile(
                        this.syncManager.filePaths.history,
                        this.recentSearches
                    );
                } catch (error) {
                    console.warn('Failed to sync search term:', error);
                }
            }
        }
    }

    // Handle input changes
    async handleInput() {
        const query = this.searchBar.value.trim();

        // Clear previous timeout
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }

        if (query.length < 2) {
            this.hideSuggestions();
            return;
        }

        this.debounceTimeout = setTimeout(async () => {
            // const recentMatches = this.getRecentMatches(query);
            // const internetSuggestions = await this.fetchSuggestions(query);
            // this.suggestions = [...recentMatches, ...internetSuggestions];
            // this.showSuggestions();

            try {
                const internetSuggestions = await this.fetchSuggestions(query);
                const recentMatches = this.getRecentMatches(query);

                // // Use internet suggestions or fallback to recent searches
                // this.suggestions = internetSuggestions.length > 0 
                //     ? [...recentMatches, ...internetSuggestions] 
                //     : this.getFallbackSuggestions(query);

                // Combine suggestions, prioritizing recent matches
                this.suggestions = [
                    ...recentMatches,
                    ...internetSuggestions.filter(
                        suggestion =>
                            !recentMatches.some(recent => recent.text === suggestion.text)
                    )
                ].slice(0, 10); // Limit to 10 suggestions

                // Show suggestions if we have any
                if (this.suggestions.length > 0) {
                    this.showSuggestions();
                } else {
                    this.hideSuggestions();
                }
            } catch (error) {
                console.error('Suggestions error:', error);
                this.suggestions = this.getFallbackSuggestions(query);
                // this.showSuggestions();
                this.hideSuggestions();
            }
        }, 300);
    }

    // Get matching recent searches
    getRecentMatches(query) {
        return this.recentSearches
            .filter(search => search.toLowerCase().includes(query.toLowerCase()))
            .map(search => ({
                text: search,
                type: 'recent',
                icon: '🕒'
            }));
    }

    // Fetch suggestions from search engines
    async fetchSuggestions(query) {
        // const endpoints = {
        //     google: `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`,
        //     duckduckgo: `https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`,
        //     bing: `https://api.bing.com/qsonhs.aspx?q=${encodeURIComponent(query)}`
        // };

        // try {
        //     const response = await fetch(endpoints[this.currentEngine],
        //         // {
        //         //     method: 'GET',
        //         //     mode: 'cors',
        //         //     headers: {
        //         //         'Accept': 'application/json'
        //         //     }
        //         // }
        //     );

        //     if (!response.ok) {
        //         console.warn(`Failed to fetch suggestions from ${this.currentEngine}`);
        //         return [];
        //     }

        //     const data = await response.json();

        //     // Parse response based on search engine
        //     switch (this.currentEngine) {
        //         case 'google':
        //             return (data[1] || []).map(item => ({
        //                 text: item,
        //                 type: 'suggestion',
        //                 icon: '🔍'
        //             }));
        //         case 'duckduckgo':
        //             return data.map(item => ({
        //                 text: item.phrase,
        //                 type: 'suggestion',
        //                 icon: '🔍'
        //             }));
        //         case 'bing':
        //             return data.AS.Results[0].Suggests.map(item => ({
        //                 text: item.Txt,
        //                 type: 'suggestion',
        //                 icon: '🔍'
        //             }));
        //         default:
        //             return [];
        //     }
        // } catch (error) {
        //     console.error('Error fetching suggestions:', error);
        //     return [];
        // }

        try {
            // Use Netlify function instead of direct API calls
            const response = await fetch(
                `/.netlify/functions/suggestions?query=${encodeURIComponent(query)}&engine=${this.currentEngine}`
            );

            if (!response.ok) {
                throw new Error('Suggestions API request failed');
            }

            const suggestions = await response.json();

            if (suggestions.error) {
                throw new Error(suggestions.error);
            }

            return suggestions;

        } catch (error) {
            console.error('Failed to fetch suggestions:', error);
            return this.getFallbackSuggestions(query);
        }
    }

    // Show suggestions in the UI
    showSuggestions() {
        if (this.suggestions.length === 0) {
            this.hideSuggestions();
            return;
        }

        const html = this.suggestions.map((suggestion, index) => `
            <div class="suggestion-item ${index === this.selectedIndex ? 'selected' : ''}" 
                 data-index="${index}">
                <span class="suggestion-icon">${suggestion.icon}</span>
                <span class="suggestion-text">${this.highlightMatch(suggestion.text)}</span>
                ${suggestion.type === 'recent' ?
                '<button class="remove-suggestion">×</button>' : ''}
            </div>
        `).join('');

        this.suggestionsContainer.innerHTML = html;
        this.suggestionsContainer.style.display = 'block';

        // Add click listeners
        this.suggestionsContainer.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => this.selectSuggestion(parseInt(item.dataset.index)));
        });

        this.suggestionsContainer.querySelectorAll('.remove-suggestion').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.parentElement.dataset.index);
                this.removeRecentSearch(index);
            });
        });
    }

    // Highlight matching text in suggestions
    highlightMatch(text) {
        const query = this.searchBar.value.trim().toLowerCase();
        const index = text.toLowerCase().indexOf(query);
        if (index === -1) return text;

        return text.slice(0, index) +
            `<strong>${text.slice(index, index + query.length)}</strong>` +
            text.slice(index + query.length);
    }

    // Handle keyboard navigation
    handleKeydown(e) {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.selectedIndex = Math.min(this.selectedIndex + 1, this.suggestions.length - 1);
                this.showSuggestions();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.selectedIndex = Math.max(this.selectedIndex - 1, -1);
                this.showSuggestions();
                break;
            case 'Enter':
                if (this.selectedIndex >= 0) {
                    e.preventDefault();
                    this.selectSuggestion(this.selectedIndex);
                }
                break;
            case 'Escape':
                this.hideSuggestions();
                break;
        }
    }

    // Select a suggestion
    selectSuggestion(index) {
        const suggestion = this.suggestions[index];
        if (suggestion) {
            this.searchBar.value = suggestion.text;
            this.saveRecentSearch(suggestion.text);
            this.performSearch(suggestion.text);
        }
    }

    // saveRecentSearch(query) {
    //     if (query) {
    //         // Remove duplicates and limit to 10 recent searches
    //         this.recentSearches = [
    //             query,
    //             ...this.recentSearches.filter(s => s !== query)
    //         ].slice(0, 10);
    //         localStorage.setItem('searchHistory', JSON.stringify(this.recentSearches));
    //     }
    // }

    // Fallback method if internet suggestions fail
    getFallbackSuggestions(query) {
        return this.recentSearches
            .filter(search => search.toLowerCase().includes(query.toLowerCase()))
            .map(search => ({
                text: search,
                type: 'recent',
                icon: '🕒'
            }));
    }

    // Remove a recent search
    removeRecentSearch(index) {
        const suggestion = this.suggestions[index];
        if (suggestion && suggestion.type === 'recent') {
            this.recentSearches = this.recentSearches.filter(s => s !== suggestion.text);
            localStorage.setItem('searchHistory', JSON.stringify(this.recentSearches));
            this.suggestions.splice(index, 1);
            this.showSuggestions();
        }
    }

    // Perform the search
    performSearch(query) {
        const searchEngineUrls = {
            duckduckgo: 'https://duckduckgo.com/?q=',
            google: 'https://www.google.com/search?q=',
            bing: 'https://www.bing.com/search?q='
        };

        window.location.href = searchEngineUrls[this.currentEngine] + encodeURIComponent(query);
    }

    // Hide suggestions
    hideSuggestions() {
        this.suggestionsContainer.style.display = 'none';
        this.selectedIndex = -1;
    }

    // Handle clicks outside the search area
    handleClickOutside(e) {
        if (!this.searchBar.contains(e.target) &&
            !this.suggestionsContainer.contains(e.target)) {
            this.hideSuggestions();
        }
    }

    // Update current search engine
    setSearchEngine(engine) {
        this.currentEngine = engine;
        if (this.searchBar.value.trim()) {
            this.handleInput();
        }
    }
}

let browserSync;
let suggestionsManager;

document.addEventListener('DOMContentLoaded', async function () {
    // Initialize BrowserSyncManager
    browserSync = new browserSyncManager();
    try {
        await browserSync.authenticate();
    } catch (error) {
        console.warn('Failed to initialize sync:', error);
        // Continue without sync functionality
    }
    const searchBar = document.querySelector('.search-bar');
    const searchEngines = document.querySelector('.search-engines');
    const searchEngineFavicon = document.querySelector('.search-engine-favicon');
    const recentSearches = document.querySelector('.recent-searches');
    const mostVisited = document.querySelector('.most-visited');
    suggestionsManager = new SearchSuggestionsManager(browserSync);

    // Search engine functionality
    const searchEngineData = {
        duckduckgo: {
            favicon: 'https://duckduckgo.com/favicon.ico',
            url: 'https://duckduckgo.com/?q='
        },
        google: {
            favicon: 'https://www.google.com/favicon.ico',
            url: 'https://www.google.com/search?q='
        },
        bing: {
            favicon: 'https://www.bing.com/favicon.ico',
            url: 'https://www.bing.com/search?q='
        }
    };

    let currentEngine = 'duckduckgo';
    let searchHistory = JSON.parse(localStorage.getItem('searchHistory') || '[]');

    searchBar.addEventListener('focus', () => {
        searchEngines.style.display = 'block';
    });

    document.addEventListener('click', (e) => {
        if (!searchBar.contains(e.target) && !searchEngines.contains(e.target)) {
            searchEngines.style.display = 'none';
        }
        if (!searchBar.contains(e.target) && !recentSearches.contains(e.target)) {
            recentSearches.style.display = 'none';
        }
    });

    document.querySelectorAll('.search-engine-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.search-engine-option').forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
            currentEngine = option.dataset.engine;
            searchEngineFavicon.src = searchEngineData[currentEngine].favicon;
            suggestionsManager.setSearchEngine(currentEngine);
        });
    });

    // Search functionality
    searchBar.addEventListener('input', () => {
        const query = searchBar.value.trim();
        if (query) {
            const matchingSearches = searchHistory.filter(s =>
                s.toLowerCase().includes(query.toLowerCase())
            ).slice(0, 5);

            if (matchingSearches.length > 0) {
                recentSearches.innerHTML = matchingSearches.map(search =>
                    `<div class="recent-search-item">${search}</div>`
                ).join('');
                recentSearches.style.display = 'block';
            } else {
                recentSearches.style.display = 'none';
            }
        } else {
            recentSearches.style.display = 'none';
        }
    });

    searchBar.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = searchBar.value.trim();
            // if (query) {
            //     searchHistory = [query, ...searchHistory.filter(s => s !== query)].slice(0, 10);
            //     localStorage.setItem('searchHistory', JSON.stringify(searchHistory));
            //     window.location.href = searchEngineData[currentEngine].url + encodeURIComponent(query);
            // }

            if (query) {
                // Use the SearchSuggestionsManager method instead of previous implementation
                suggestionsManager.saveRecentSearch(query);
                suggestionsManager.performSearch(query);
            }
        }
    });

    // Most visited sites functionality
    async function updateMostVisited() {
        let sites;
        if (browserSync && browserSync.isAuthenticated) {
            try {
                sites = await browserSync.readFile(browserSync.filePaths.favorites) || [];
            } catch {
                sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
            }
        } else {
            sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
        }
        // const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
        const sortedSites = sites.sort((a, b) => (b.pinned || 0) - (a.pinned || 0));

        mostVisited.innerHTML = sortedSites.map((site, index) => `
            <div class="site-item-container">
                <div class="site-item ${site.pinned ? 'pinned' : ''}" title="${site.title}" draggable="true" data-index="${index}">
                    <img src="${site.favicon}" alt="${site.title}" class="site-favicon" onclick="window.location.href='${site.url}'">
                    <div class="site-actions">
                        <button class="site-action-btn remove-site" title="Remove">❌</button>
                    </div>
                </div>
                <div class="site-title">${site.title}</div>
            </div>
        `).join('');

        // Add the "+" button at the end
        mostVisited.innerHTML += `
            <button class="add-favorite-site" title="Add a new site">
                <i class="fas fa-plus"></i>
            </button>
        `;

        // Add event listener for adding new site
        // document.querySelector('.add-favorite-site').addEventListener('click', () => {
        //     const url = prompt('Enter the website URL:');
        //     if (url) {
        //         try {
        //             const siteDomain = new URL(url).hostname;
        //             const newSite = {
        //                 title: siteDomain.replace(/^www\./, ''),
        //                 favicon: `https://${siteDomain}/favicon.ico`,
        //                 url: url,
        //                 pinned: false
        //             };

        //             const currentSites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
        //             localStorage.setItem('mostVisited', JSON.stringify([...currentSites, newSite]));
        //             updateMostVisited();
        //         } catch (e) {
        //             alert('Please enter a valid URL');
        //         }
        //     }
        // });

        document.querySelectorAll('.remove-site').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.closest('.site-item').dataset.index);
                removeSite(index);
            });
        });

        // const siteItems = document.querySelectorAll('.site-item[draggable="true"]');
        // siteItems.forEach((item) => {
        //     item.addEventListener('dragstart', dragStart);
        //     item.addEventListener('dragover', dragOver);
        //     item.addEventListener('drop', drop);
        // });

        // Add event listeners
        addDragAndDropListeners();
        document.querySelector('.add-favorite-site').addEventListener('click', addNewSite);

    }

    // updateMostVisited();

    async function removeSite(index) {
        if (browserSync && browserSync.isAuthenticated) {
            try {
                const sites = await browserSync.readFile(browserSync.filePaths.favorites) || [];
                sites.splice(index, 1);
                await browserSync.writeFile(browserSync.filePaths.favorites, sites);
            } catch (error) {
                console.error('Failed to remove site from Dropbox:', error);
                // Fallback to local storage
                const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
                sites.splice(index, 1);
                localStorage.setItem('mostVisited', JSON.stringify(sites));
            }
        } else {
            const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
            sites.splice(index, 1);
            localStorage.setItem('mostVisited', JSON.stringify(sites));
        }
        updateMostVisited();

        // const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
        // if (index >= 0 && index < sites.length) {
        //     sites.splice(index, 1);
        //     localStorage.setItem('mostVisited', JSON.stringify(sites));
        //     updateMostVisited();
        // }
    }

    function addDragAndDropListeners() {
        const siteItems = document.querySelectorAll('.site-item-container');
        let draggedItem = null;
        let draggedItemIndex = null;
        let placeholder = null;

        siteItems.forEach(item => {
            // Prevent drag from starting on buttons or images
            item.querySelector('.site-favicon').addEventListener('mousedown', e => e.stopPropagation());
            item.querySelector('.site-actions').addEventListener('mousedown', e => e.stopPropagation());

            item.addEventListener('dragstart', function (e) {
                // draggedElement = item;
                // e.dataTransfer.effectAllowed = 'move';
                // draggedElement.classList.add('dragging');

                draggedItem = this;
                draggedItemIndex = parseInt(this.dataset.index);

                // Create and style placeholder
                placeholder = this.cloneNode(true);
                placeholder.classList.add('placeholder');
                placeholder.style.opacity = '0.3';

                // Style dragged item
                setTimeout(() => {
                    this.style.opacity = '0.5';
                    this.classList.add('dragging');
                }, 0);

                // Set drag image to transparent
                const transparent = document.createElement('div');
                e.dataTransfer.setDragImage(transparent, 0, 0);
            });

            item.addEventListener('dragover', function (e) {
                // e.preventDefault();
                // e.dataTransfer.dropEffect = 'move';
                // const currentHoveredElement = e.target.closest('.site-item');
                // if (currentHoveredElement && currentHoveredElement !== draggedElement) {
                //     mostVisited.insertBefore(draggedElement, currentHoveredElement.nextSibling);
                // }

                e.preventDefault();
                if (this === draggedItem) return;

                const rect = this.getBoundingClientRect();
                const mouseX = e.clientX;
                const itemCenterX = rect.left + (rect.width / 2);

                if (mouseX < itemCenterX) {
                    if (this.previousElementSibling !== draggedItem) {
                        this.parentNode.insertBefore(draggedItem, this);
                    }
                } else {
                    if (this.nextElementSibling !== draggedItem) {
                        this.parentNode.insertBefore(draggedItem, this.nextElementSibling);
                    }
                }
            });

            // item.addEventListener('drop', () => {
            //     const updatedOrder = Array.from(mostVisited.querySelectorAll('.site-item')).map(el => {
            //         return JSON.parse(localStorage.getItem('mostVisited') || '[]')[el.dataset.index];
            //     });

            //     localStorage.setItem('mostVisited', JSON.stringify(updatedOrder));
            //     updateMostVisited();
            // });

            item.addEventListener('dragend', function () {
                // draggedElement.classList.remove('dragging');
                // draggedElement = null;

                this.style.opacity = '1';
                this.classList.remove('dragging');
                if (placeholder && placeholder.parentNode) {
                    placeholder.parentNode.removeChild(placeholder);
                }
                updateSiteOrder();
            });

            // Touch events for mobile
            item.addEventListener('touchstart', function (e) {
                if (e.target.closest('.site-actions')) return;

                draggedItem = this;
                draggedItemIndex = parseInt(this.dataset.index);
                this.classList.add('dragging');

                const touch = e.touches[0];
                const rect = this.getBoundingClientRect();
                this.touchOffset = {
                    x: touch.clientX - rect.left,
                    y: touch.clientY - rect.top
                };
            });

            item.addEventListener('touchmove', function (e) {
                if (!draggedItem) return;
                e.preventDefault();

                const touch = e.touches[0];
                const x = touch.clientX - this.touchOffset.x;
                const y = touch.clientY - this.touchOffset.y;

                draggedItem.style.position = 'fixed';
                draggedItem.style.left = x + 'px';
                draggedItem.style.top = y + 'px';

                // Find the element we're hovering over
                const elementsBelow = document.elementsFromPoint(touch.clientX, touch.clientY);
                const hoverElement = elementsBelow.find(el =>
                    el.classList.contains('site-item') && el !== draggedItem
                );

                if (hoverElement) {
                    const rect = hoverElement.getBoundingClientRect();
                    if (touch.clientX < rect.left + (rect.width / 2)) {
                        hoverElement.parentNode.insertBefore(draggedItem, hoverElement);
                    } else {
                        hoverElement.parentNode.insertBefore(draggedItem, hoverElement.nextElementSibling);
                    }
                }
            });

            item.addEventListener('touchend', function () {
                if (!draggedItem) return;

                draggedItem.style.position = '';
                draggedItem.style.left = '';
                draggedItem.style.top = '';
                draggedItem.classList.remove('dragging');

                updateSiteOrder();
                draggedItem = null;
            });
        });
    }

    async function addNewSite() {
        const url = prompt('Enter the website URL:');
        if (url) {
            try {
                const siteDomain = new URL(url).hostname;
                const newSite = {
                    title: siteDomain.replace(/^www\./, ''),
                    favicon: `https://${siteDomain}/favicon.ico`,
                    url: url,
                    pinned: false
                };

                if (browserSync && browserSync.isAuthenticated) {
                    const currentSites = await browserSync.readFile(browserSync.filePaths.favorites) || [];
                    currentSites.push(newSite);
                    await browserSync.writeFile(browserSync.filePaths.favorites, currentSites);
                } else {
                    const currentSites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
                    localStorage.setItem('mostVisited', JSON.stringify([...currentSites, newSite]));
                }
                // const currentSites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
                // localStorage.setItem('mostVisited', JSON.stringify([...currentSites, newSite]));
                updateMostVisited();
            } catch {
                alert('Please enter a valid URL');
            }
        }
    }

    async function updateSiteOrder() {
        const newOrder = Array.from(mostVisited.querySelectorAll('.site-item'))
            .map(item => parseInt(item.dataset.index))
            .filter(index => !isNaN(index));

        if (browserSync && browserSync.isAuthenticated) {
            try {
                const sites = await browserSync.readFile(browserSync.filePaths.favorites) || [];
                const reorderedSites = newOrder.map(index => sites[index]).filter(Boolean);
                await browserSync.writeFile(browserSync.filePaths.favorites, reorderedSites);
            } catch (error) {
                console.error('Failed to update site order in Dropbox:', error);
                // Fallback to local storage
                const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
                const reorderedSites = newOrder.map(index => sites[index]).filter(Boolean);
                localStorage.setItem('mostVisited', JSON.stringify(reorderedSites));
            }
        } else {
            const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
            const reorderedSites = newOrder.map(index => sites[index]).filter(Boolean);
            localStorage.setItem('mostVisited', JSON.stringify(reorderedSites));
        }

        // const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
        // const newOrder = Array.from(mostVisited.querySelectorAll('.site-item')).map(item =>
        //     sites[parseInt(item.dataset.index)]
        // ).filter(Boolean);
        // localStorage.setItem('mostVisited', JSON.stringify(newOrder));
        updateMostVisited();
    }

    let draggedIndex = null;

    function dragStart(e) {
        draggedIndex = parseInt(e.target.dataset.index);
        e.dataTransfer.setData('text/plain', 'dragged');
    }

    function dragOver(e) {
        e.preventDefault();
    }

    function drop(e) {
        e.preventDefault();
        const targetIndex = parseInt(e.target.closest('.site-item').dataset.index);

        if (draggedIndex !== null && draggedIndex !== targetIndex) {
            const sites = JSON.parse(localStorage.getItem('mostVisited') || '[]');
            const draggedSite = sites.splice(draggedIndex, 1)[0];
            sites.splice(targetIndex, 0, draggedSite);
            localStorage.setItem('mostVisited', JSON.stringify(sites));
            updateMostVisited();
        }
    }

    // enableTouchReorder();
    updateMostVisited();

});

