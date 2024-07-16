import { address, toNano } from '@ton/core';
import { Pool, ReserveConfiguration } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const poolAddress = address('EQBD3bhuWfqt4R4fJNR0VFCla3xMJqSFKDtrAhxybOiyzjKn');
    // It's the current version's address
    // const pool = provider.open(await Pool.fromInit());
    const pool = provider.open(await Pool.fromAddress(poolAddress));

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

    const currentLength = await pool.getReservesLength();
    console.log(`Current reserve length: ${currentLength.toString()}`);
    const reserveAddress = await pool.getReserveAddress(0n);
    console.log(`Reserve address: ${reserveAddress.toString()}`);
    // const configuration = await pool.getReserveConfiguration(0n);
}
