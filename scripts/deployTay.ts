import { toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { buildOnchainMetadata } from './utils';
import { Tay } from '../wrappers/Tay';
import { MockTay } from '../wrappers/MockTay';

export async function run(provider: NetworkProvider) {
    const owner = provider.sender().address!!;
    const jettonParams = {
        name: 'Tonlayer Token',
        description: 'Tonlayer Token',
        // TODO: update image url
        image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
        symbol: 'TAY',
        decimals: '9',
    };
    // 1B
    let max_supply = 1000000000n * 10n ** 9n;
    let content = buildOnchainMetadata(jettonParams);

    const tay =
        provider.network() === 'testnet'
            ? provider.open(await MockTay.fromInit(owner, content, max_supply))
            : provider.open(await Tay.fromInit(owner, content, max_supply));

    await tay.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Deploy',
            queryId: 0n,
        },
    );

    // Testnet TAY: EQDyjWqVmjFiwCuElzbOYzluD52qH-0fhHh8n51b_ua1AF1f
    await provider.waitForDeploy(tay.address);
    console.log(`Deployed at ${tay.address.toString()}`);
}
