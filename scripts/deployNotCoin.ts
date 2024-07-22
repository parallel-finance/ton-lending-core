import { toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { buildOnchainMetadata } from './utils';
import { SampleJetton } from '../wrappers/SampleJetton';

export async function run(provider: NetworkProvider) {
    const owner = provider.sender().address!!;
    const jettonParams = {
        "name": "Notcoin",
        "description": "Notcoin is a token that is not a coin.",
        "symbol": "NOT",
        "decimals": "9",
        "image": "https://cache.tonapi.io/imgproxy/4KCMNm34jZLXt0rqeFm4rH-BK4FoK76EVX9r0cCIGDg/rs:fill:200:200:1/g:no/aHR0cHM6Ly9jZG4uam9pbmNvbW11bml0eS54eXovY2xpY2tlci9ub3RfbG9nby5wbmc.webp"
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

    // EQBqFJkn_DoBFcNPQ0ble53CD92X_XsDgPr1_WAajYceJMHi
    await provider.waitForDeploy(sampleJetton.address);
    console.log(`Deployed at ${sampleJetton.address.toString()}`);
}
