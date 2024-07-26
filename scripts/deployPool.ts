import { toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';

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
    // latest: EQD4H49qDN-F95mhBMdq3uSu2oOQkShC_9GMgqoKV8D3Ingd
    await provider.waitForDeploy(pool.address);
    console.log(`Deployed at ${pool.address.toString()}`);
}
