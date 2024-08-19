import { toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { buildOnchainMetadata } from './utils';
import { SampleJetton } from '../wrappers/SampleJetton';

export async function run(provider: NetworkProvider) {
    const owner = provider.sender().address!!;
    const jettonParams = {
        name: 'SampleJetton',
        description: 'Sample Jetton for testing purposes',
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'MAS',
        decimals: '9',
    };
    let max_supply = (1n << 120n) - 1n;
    let content = buildOnchainMetadata(jettonParams);

    const sampleJetton = provider.open(await SampleJetton.fromInit(owner, content, max_supply));

    await sampleJetton.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Deploy',
            queryId: 0n,
        }
    );

    // MAS: EQA3artTJWoOgxwbttoYSXFs4_ETzGMC54HyK8cdkanCSaBd
    await provider.waitForDeploy(sampleJetton.address);
    console.log(`Deployed at ${sampleJetton.address.toString()}`);
}
