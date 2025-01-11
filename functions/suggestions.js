// functions/suggestions.js - Netlify serverless function for search suggestions
exports.handler = async function (event) {
    const { query, engine = 'duckduckgo' } = event.queryStringParameters;

    // Define endpoints for different search engines
    const endpoints = {
        duckduckgo: `https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`,
        google: `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`,
        bing: `https://api.bing.com/qsonhs.aspx?q=${encodeURIComponent(query)}`
    };

    try {
        const response = await fetch(endpoints[engine]);
        const data = await response.json();

        // Parse response based on search engine
        let suggestions;
        switch (engine) {
            case 'duckduckgo':
                suggestions = data.map(item => ({
                    text: item.phrase,
                    type: 'suggestion',
                    icon: '🔍'
                }));
                break;

            case 'google':
                suggestions = (data[1] || []).map(item => ({
                    text: item,
                    type: 'suggestion',
                    icon: '🔍'
                }));
                break;

            case 'bing':
                suggestions = data.AS.Results[0].Suggests.map(item => ({
                    text: item.Txt,
                    type: 'suggestion',
                    icon: '🔍'
                }));
                break;

            default:
                suggestions = [];
        }

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*" // Be more specific in production
            },
            body: JSON.stringify(suggestions)
        };

    } catch (error) {
        console.error('Suggestion fetch error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "Failed fetching suggestions",
                details: error.message
            })
        };
    }
};