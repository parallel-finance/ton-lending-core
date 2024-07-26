import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const senderAddress = provider.sender().address!!;
    const accountId = senderAddress.toRawString();
    console.log(`accountId: ${accountId}`);
    const api = `https://testnet.tonapi.io/v2/accounts/${encodeURIComponent(accountId)}/jettons?currencies=USD`
    console.log(`api: ${api}`);
    const response = await fetch(api);
    console.log(response.status);
    console.log(response.body);
    // console.log(JSON.stringify(response));
}
