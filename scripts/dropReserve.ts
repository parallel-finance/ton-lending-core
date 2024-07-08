import { address, toNano } from '@ton/core';
import { Pool, ReserveConfiguration } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());

    await pool.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'DropReserve',
            reserveIndex: 0n,
        }
    );

    await provider.waitForDeploy(pool.address);
}
