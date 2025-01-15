// const dotenv = require('dotenv');
// const result = dotenv.config();
// const { Dropbox } = require('dropbox');
// const http = require('http');
// const url = require('url');
// const crypto = require('crypto'); // Import crypto module for PKCE

// console.log('Dotenv Load Result:', result);
// console.log('Process Env:', {
//     DROPBOX_CLIENT_ID: process.env.DROPBOX_CLIENT_ID,
//     DROPBOX_CLIENT_SECRET: process.env.DROPBOX_CLIENT_SECRET,
// });

// let client;

// async function initializeClient() {
//     client = new Dropbox({ clientId: process.env.DROPBOX_CLIENT_ID });
// }

// // Function to generate a random string
// function generateRandomString(length) {
//     return crypto.randomBytes(length).toString('hex').slice(0,length);
// }

// // Function to generate code challenge
// function generateCodeChallenge(codeVerifier) {
//     const sha256 = crypto.createHash('sha256').update(codeVerifier).digest('base64');
//     return sha256.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// }

// // Authentication method
// async function authenticate() {
//     try {
//         if (!client) {
//             await initializeClient();
//         }
//         // Generate code verifier and challenge for PKCE
//         const codeVerifier = generateRandomString(128);
//         const codeChallenge = generateCodeChallenge(codeVerifier);
//         const scopes = ["account_info.read", "files.metadata.read", "files.content.write", "files.content.read"];

//         // console.log('bjs-scope is array: ', Array.isArray(scopes));
//         // console.log('bjs-scope: ', scopes);

//         // Generate authentication URL with PKCE
//         const authUrl = client.auth.getAuthenticationUrl(
//             'http://localhost:8080/', // redirectUri
//             null, // state
//             'code', // authType
//             'offline', // tokenAccessType
//             scopes, // scope
//             'none', // includeGrantedScopes
//             { code_challenge: codeChallenge, code_challenge_method: 'S256' } // options
//         );

//         console.log('Please visit this URL to authenticate:', authUrl);

//         // Start a server to handle the callback
//         return new Promise((resolve, reject) => {
//             const server = http.createServer(async (req, res) => {
//                 const parsedUrl = url.parse(req.url, true);

//                 if (parsedUrl.pathname === '/') {
//                     const code = parsedUrl.query.code;

//                     if (code) {
//                         try {
//                             const tokenResponse = await client.auth.getAccessTokenFromCode(
//                                 'http://localhost:8080/',
//                                 code,
//                                 null,
//                                 { code_verifier: codeVerifier }
//                             );
//                             const {access_token} = tokenResponse;

//                             client = new Dropbox({ accessToken: access_token });

//                             console.log('Successfully authenticated with Dropbox');
//                             res.end('Authentication successful! You can close this window.');
//                             server.close();
//                             resolve(true);
//                         } catch(err){
//                              console.error('Failed to retrieve access token from Dropbox', err);
//                              res.end('Authentication failed. Please try again.');
//                              server.close();
//                              resolve(false);
//                         }
//                     } else {
//                         console.error('Failed to retrieve code from URL');
//                         res.end('Authentication failed. Please try again.');
//                         server.close();
//                         resolve(false);
//                     }
//                 }
//             });

//             server.listen(8080, () => {
//                 console.log('Waiting for authentication callback on http://localhost:8080/');
//             });
//         });
//     } catch (error) {
//         console.error('Dropbox authentication failed:', error);
//         return false;
//     }
// }

// authenticate();
// module.exports = {
//     authenticate,
//     initializeClient
// };


const dotenv = require('dotenv');
const result = dotenv.config();
const { Dropbox } = require('dropbox');
const http = require('http');
const url = require('url');
const crypto = require('crypto');

console.log('Dotenv Load Result:', result);
console.log('Process Env:', {
    DROPBOX_CLIENT_ID: process.env.DROPBOX_CLIENT_ID,
    DROPBOX_CLIENT_SECRET: process.env.DROPBOX_CLIENT_SECRET,
});

let client;

async function initializeClient() {
    client = new Dropbox({ 
        clientId: process.env.DROPBOX_CLIENT_ID,
        clientSecret: process.env.DROPBOX_CLIENT_SECRET 
    });
}

function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex').slice(0,length);
}

function generateCodeChallenge(codeVerifier) {
    const sha256 = crypto.createHash('sha256').update(codeVerifier).digest('base64');
    return sha256.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function authenticate() {
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

        const authUrl = await client.auth.getAuthenticationUrl(
            'http://localhost:8080/',
            null,
            'code',
            'offline',
            scopes,
            'none',
            false  // Set PKCE to false since we're using client secret
        );

        console.log('\nPlease visit this URL to authenticate:');
        console.log(authUrl);
        console.log('\nWaiting for authentication...\n');

        return new Promise((resolve, reject) => {
            const server = http.createServer(async (req, res) => {
                const parsedUrl = url.parse(req.url, true);

                if (parsedUrl.pathname === '/') {
                    const code = parsedUrl.query.code;

                    if (code) {
                        try {
                            client.auth.setClientSecret(process.env.DROPBOX_CLIENT_SECRET);
                            const tokenResponse = await client.auth.getAccessTokenFromCode(
                                'http://localhost:8080/',
                                code
                            );

                            const { access_token, refresh_token } = tokenResponse.result;

                            client = new Dropbox({ 
                                accessToken: access_token,
                                refreshToken: refresh_token,
                                clientId: process.env.DROPBOX_CLIENT_ID,
                                clientSecret: process.env.DROPBOX_CLIENT_SECRET
                            });

                            console.log('Successfully authenticated with Dropbox!');
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end('Authentication successful! You can close this window.');
                            server.close();
                            resolve(true);
                        } catch(err) {
                            console.error('Failed to retrieve access token from Dropbox:', err);
                            res.writeHead(400, { 'Content-Type': 'text/html' });
                            res.end('Authentication failed. Please try again.');
                            server.close();
                            resolve(false);
                        }
                    } else {
                        console.error('Failed to retrieve code from URL');
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end('Authentication failed. Please try again.');
                        server.close();
                        resolve(false);
                    }
                }
            });

            server.listen(8080, () => {
                console.log('Local server is running at http://localhost:8080/');
            });
        });
    } catch (error) {
        console.error('Dropbox authentication failed:', error);
        return false;
    }
}

authenticate().then((result) => {
    if (result) {
        console.log('Authentication process completed successfully');
    } else {
        console.log('Authentication process failed');
    }
}).catch((error) => {
    console.error('Authentication process encountered an error:', error);
});

module.exports = {
    authenticate,
    initializeClient
};

// debug-env.js
// import { Dropbox } from 'dropbox';
// import { createServer } from 'http';
// import { parse } from 'url';
// import { randomBytes, createHash } from 'crypto';
// import config from './config.js';

// console.log('DropBox ID,Secret:', {
//     DROPBOX_CLIENT_ID: config.DROPBOX_API_CONFIG.clientId,
//     DROPBOX_CLIENT_SECRET: config.DROPBOX_API_CONFIG.clientSecret,
// });

// let client;

// export const initializeClient = async () => {
//     client = new Dropbox({ 
//         clientId: config.DROPBOX_API_CONFIG.clientId,
//         clientSecret: config.DROPBOX_API_CONFIG.clientSecret
//     });
// }

// function generateRandomString(length) {
//     return randomBytes(length).toString('hex').slice(0,length);
// }

// function generateCodeChallenge(codeVerifier) {
//     const sha256 = createHash('sha256').update(codeVerifier).digest('base64');
//     return sha256.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// }

// export const authenticate = async() => {
//     try {
//         if (!client) {
//             await initializeClient();
//         }
//         const codeVerifier = generateRandomString(128);
//         const codeChallenge = generateCodeChallenge(codeVerifier);
        
//         const scopes = [
//             "account_info.read",
//             "files.metadata.read",
//             "files.content.write",
//             "files.content.read"
//         ];

//         const authUrl = await client.auth.getAuthenticationUrl(
//             'http://localhost:8080/',
//             null,
//             'code',
//             'offline',
//             scopes,
//             'none',
//             false  // Set PKCE to false since we're using client secret
//         );

//         console.log('\nPlease visit this URL to authenticate:');
//         console.log(authUrl);
//         console.log('\nWaiting for authentication...\n');

//         return new Promise((resolve, reject) => {
//             const server = createServer(async (req, res) => {
//                 const parsedUrl = parse(req.url, true);

//                 if (parsedUrl.pathname === '/') {
//                     const code = parsedUrl.query.code;

//                     if (code) {
//                         try {
//                             client.auth.setClientSecret(config.DROPBOX_API_CONFIG.clientSecret);
//                             const tokenResponse = await client.auth.getAccessTokenFromCode(
//                                 'http://localhost:8080/',
//                                 code
//                             );

//                             const { access_token, refresh_token } = tokenResponse.result;

//                             client = new Dropbox({ 
//                                 accessToken: access_token,
//                                 refreshToken: refresh_token,
//                                 clientId: config.DROPBOX_API_CONFIG.clientId,
//                                 clientSecret: config.DROPBOX_API_CONFIG.clientSecret
//                             });

//                             console.log('Successfully authenticated with Dropbox!');
//                             res.writeHead(200, { 'Content-Type': 'text/html' });
//                             res.end('Authentication successful! You can close this window.');
//                             server.close();
//                             resolve(true);
//                         } catch(err) {
//                             console.error('Failed to retrieve access token from Dropbox:', err);
//                             res.writeHead(400, { 'Content-Type': 'text/html' });
//                             res.end('Authentication failed. Please try again.');
//                             server.close();
//                             resolve(false);
//                         }
//                     } else {
//                         console.error('Failed to retrieve code from URL');
//                         res.writeHead(400, { 'Content-Type': 'text/html' });
//                         res.end('Authentication failed. Please try again.');
//                         server.close();
//                         resolve(false);
//                     }
//                 }
//             });

//             server.listen(8080, () => {
//                 console.log('Local server is running at http://localhost:8080/');
//             });
//         });
//     } catch (error) {
//         console.error('Dropbox authentication failed:', error);
//         return false;
//     }
// }

// // authenticate().then((result) => {
// //     if (result) {
// //         console.log('Authentication process completed successfully');
// //     } else {
// //         console.log('Authentication process failed');
// //     }
// // }).catch((error) => {
// //     console.error('Authentication process encountered an error:', error);
// // });

// export default {
//     authenticate,
//     initializeClient
// };
