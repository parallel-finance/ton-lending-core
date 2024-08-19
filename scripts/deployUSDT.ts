import { toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { buildOnchainMetadata } from './utils';
import { SampleJetton } from '../wrappers/SampleJetton';

export async function run(provider: NetworkProvider) {
    const owner = provider.sender().address!!;
    const jettonParams = {
        "name": "Tether USD",
        "description": "Tether Token for Tether USD",
        "symbol": "USD₮",
        "decimals": "6",
        "image": "https://cache.tonapi.io/imgproxy/T3PB4s7oprNVaJkwqbGg54nexKE0zzKhcrPv8jcWYzU/rs:fill:200:200:1/g:no/aHR0cHM6Ly90ZXRoZXIudG8vaW1hZ2VzL2xvZ29DaXJjbGUucG5n.webp",
    }

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

    // EQBBo3or9J_bQ9G9BLM5oLpp2Xk6eB00djrP7tXDmByYISCw
    await provider.waitForDeploy(sampleJetton.address);
    console.log(`Deployed at ${sampleJetton.address.toString()}`);
}
