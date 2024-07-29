import { getHttpV4Endpoint, Network } from '@orbs-network/ton-access';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { Address, TonClient, TonClient4 } from '@ton/ton';

// only user address
export const getAddressSeqno = async (provider: NetworkProvider, address: Address) => {
    const client = provider.api();
    if (client instanceof TonClient) {
        return (await client.runMethod(address, 'seqno')).stack.readBigNumber();
    }
    if (client instanceof TonClient4) {
        const latestBlock = await client.getLastBlock();
        return (await client.runMethod(latestBlock.last.seqno, address, 'seqno')).reader.readBigNumber();
    }
};

export const getAddressBalance = async (provider: NetworkProvider, address: Address) => {
    const client = provider.api();
    if (client instanceof TonClient) {
        return (await client.getContractState(address)).balance;
    }
    if (client instanceof TonClient4) {
        return (await client.provider(address).getState()).balance;
    }
};

export const getAddressState = async (provider: NetworkProvider, address: Address) => {
    return await provider.api().provider(address).getState();
};

export const waitForTx = async (provider: NetworkProvider, sender: Address, usingOrbsRpc?: boolean) => {
    let client: TonClient | TonClient4 = provider.api();
    if (usingOrbsRpc) {
        client = new TonClient4({ endpoint: await getHttpV4Endpoint({ network: provider.network() as Network }) });
    }
    const hash = (await getAddressState(provider, sender)).last?.hash;

    let currentHash = hash;
    while (hash == currentHash) {
        console.log(`Waiting for sender stateHash update...`);
        await sleep(1500);
        currentHash = (await client.provider(sender).getState()).last?.hash;
    }

    console.log(``);
};
