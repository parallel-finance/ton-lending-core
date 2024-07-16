import { toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());

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

    // latest: EQBD3bhuWfqt4R4fJNR0VFCla3xMJqSFKDtrAhxybOiyzjKn
    await provider.waitForDeploy(pool.address);
    console.log(`Deployed at ${pool.address.toString()}`);
}
