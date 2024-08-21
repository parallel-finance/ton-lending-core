import { Config } from '@ton/blueprint';

process.setMaxListeners(30);

export const config: Config = {
    // It will use TonClient rather than TonClient v4 if we use custom network which will be failed to fetch the user health info
    network: {
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        type: 'testnet',
        version: 'v2',
        key: process.env.TON_CENTER_API_KEY, // Your API key here,
    },
    separateCompilables: true,
};
