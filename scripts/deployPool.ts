import { toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function run(provider: NetworkProvider) {
    console.log('Deploying pool...')
    const pool = provider.open(await Pool.fromInit());
    await sleep(2000);

    await pool.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Deploy',
            queryId: 0n,
        }
    );
    await sleep(2000);
    // latest: EQDtBATSpYPnbTit8CwFcTNLWS9fHMDdhwq7yRALGQ6SAbYP
    await provider.waitForDeploy(pool.address);
    console.log(`Deployed at ${pool.address.toString()}`);
}
