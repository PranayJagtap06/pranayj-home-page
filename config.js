// config.js

const config = {
    DROPBOX_API_CONFIG: {
        clientId: '',
        clientSecret: '',
    }
};

const loadConfig = () => {
    // if (window.DROPBOX_CLIENT_ID && window.DROPBOX_CLIENT_SECRET) {
    //     config.DROPBOX_API_CONFIG.clientId = window.DROPBOX_CLIENT_ID ||
    //         window.config?.DROPBOX_API_CONFIG?.clientId ||
    //         '';
    //     config.DROPBOX_API_CONFIG.clientSecret = window.DROPBOX_CLIENT_SECRET ||
    //         window.config?.DROPBOX_API_CONFIG?.clientSecret ||
    //         '';
    if (process.env.DROPBOX_CLIENT_ID && process.env.DROPBOX_CLIENT_SECRET) {
        config.DROPBOX_API_CONFIG.clientId = process.env.DROPBOX_CLIENT_ID ||
            '';
        config.DROPBOX_API_CONFIG.clientSecret = process.env.DROPBOX_CLIENT_SECRET ||
            '';

        // console.log('Loaded Dropbox Config:', {
        //     clientId: config.DROPBOX_API_CONFIG.clientId ? 'Present' : 'Missing',
        //     clientSecret: config.DROPBOX_API_CONFIG.clientSecret ? 'Present' : 'Missing'
        // });

        // console.group('Dropbox Config Loading');
        // console.log('Window ClientId:', process.env.DROPBOX_CLIENT_ID);
        // console.log('Final ClientId:', config.DROPBOX_API_CONFIG.clientId);
        // console.log('Window ClientSecret:', process.env.DROPBOX_CLIENT_SECRET ? 'Present' : 'Missing');
        // console.groupEnd();

        // console.log('Dropbox Config Loading:', {
        //     windowClientId: process.env.DROPBOX_CLIENT_ID,
        //     metaEnvClientId: import.meta.env?.VITE_DROPBOX_CLIENT_ID,
        //     finalClientId: config.DROPBOX_API_CONFIG.clientId,

        //     windowClientSecret: process.env.DROPBOX_CLIENT_SECRET ? 'Present' : 'Missing',
        //     metaEnvClientSecret: import.meta.env?.VITE_DROPBOX_CLIENT_SECRET ? 'Present' : 'Missing',
        // });


        window.config = config;
    } else {
        console.log('Waiting for Dropbox config...');
        setTimeout(loadConfig, 100);
    }
}
loadConfig();

export default config;