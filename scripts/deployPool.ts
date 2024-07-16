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
    // latest: EQAc4cOJOD_xftw0yzTUPviPpc3v24c_bJsXQPeipl1bKsqO
    await provider.waitForDeploy(pool.address);
    console.log(`Deployed at ${pool.address.toString()}`);
}
