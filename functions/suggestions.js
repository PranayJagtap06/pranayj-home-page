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
        console.log(`Fetching suggestions for query: ${query}, engine: ${engine}`);
        const response = await fetch(endpoints[engine], {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        if (!response.ok) {
            console.error(`Failed to fetch suggestions. Status: ${response.status}, Engine: ${engine}`);
            return {
                statusCode: response.status,
                body: JSON.stringify({
                    error: `Failed to fetch suggestions. Status: ${response.status}`,
                    engine
                })
            };
        }

        const data = await response.json();
        console.log('Raw response data:', JSON.stringify(data));

        // Parse response based on search engine
        let suggestions;
        switch (engine) {
            case 'duckduckgo':
                suggestions = data.map(item => {
                    if (typeof item == 'string') {
                        return {
                            text: item,
                            type: 'suggestion',
                            icon: '🔍'
                        };
                    } else {
                        // console.log('Foreach:', item);
                        return item.map(text => ({
                            text: text,
                            type: 'suggestion',
                            icon: '🔍'
                        }));
                    }
                }).flat();
                break;

            case 'google':
                suggestions = (data[1] || []).map(item => ({
                    text: item,
                    type: 'suggestion',
                    icon: '🔍'
                }));
                break;

            case 'bing':
                suggestions = ((data?.AS?.Results?.[0]?.Suggests) || []).map(item => ({
                    text: item?.Txt || item,
                    type: 'suggestion',
                    icon: '🔍'
                }));
                break;

            default:
                suggestions = [];
        }

        // Filter out empty suggestions
        // suggestions = suggestions.filter(suggestion => 
        //     suggestion.text && suggestion.text.trim() !== ''
        // );

        console.log('Processed suggestions:', JSON.stringify(suggestions));

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
                details: error.message,
                engine
            })
        };
    }
};