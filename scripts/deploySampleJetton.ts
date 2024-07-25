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

    // SAM: EQDXzHrAAvH0oBVW3LEZd8dF6uGipG16r3GasIx0gKAAU_Qo
    // MAS: EQBe9prUeNqHJHRw4YWDZhXI91kiGaGTTHuCWIaY975Uw2AU
    // USDT: EQColXOG7C2X8x0ZFT-3Ot5sYknz-JbLnJzI1eVNldQlX2Bu
    // NOT: EQD8-IT-fOEuBqY5bG_NY3lcZTKnnKv-7_UuILidV2eCa4W-
    // pTON: EQBvOgGXLdZOysRTnw2UDc_KRwcD5HLVH139DZ3AnK04LcxH
    await provider.waitForDeploy(sampleJetton.address);
    console.log(`Deployed at ${sampleJetton.address.toString()}`);
}
