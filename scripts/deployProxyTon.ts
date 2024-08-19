import { toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { buildOnchainMetadata } from './utils';
import { SampleJetton } from '../wrappers/SampleJetton';

export async function run(provider: NetworkProvider) {
    const owner = provider.sender().address!!;
    const jettonParams = {
        "name": "Proxy TON",
        "description": "Proxy contract for TON",
        "symbol": "pTON",
        "decimals": "9",
        "image": "https://cache.tonapi.io/imgproxy/X7T-fLahBBVIxXacXAqrsCHIgFgTQE3Jt2HAdnc5_Mc/rs:fill:200:200:1/g:no/aHR0cHM6Ly9zdGF0aWMuc3Rvbi5maS9sb2dvL3Rvbl9zeW1ib2wucG5n.webp",
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

    // EQBAnuhcK0cHhCsLa8B_-J2_yM_62MakfI2a8iNqpK1rEtf3
    await provider.waitForDeploy(sampleJetton.address);
    console.log(`Deployed at ${sampleJetton.address.toString()}`);
}
