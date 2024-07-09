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
        symbol: 'SAM'
    };
    let max_supply = toNano(1000000n); // 🔴 Set the specific total supply in nano
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

    // EQBgTTj_q3OVw9a8qVukPpN0IChMH-ZcL7Vj-zXlRF6Llc_3 or kQBgTTj_q3OVw9a8qVukPpN0IChMH-ZcL7Vj-zXlRF6LlXR9
    await provider.waitForDeploy(sampleJetton.address);
    console.log(`Deployed at ${sampleJetton.address.toString()}`);
}
