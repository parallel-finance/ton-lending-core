import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());

    await sleep(1000);
    const reserveLength = await pool.getReservesLength();
    console.log(`Current reserve length: ${reserveLength.toString()}`);
    for (let i = 0; i < reserveLength; i++) {
        await sleep(1000);
        console.log(`Reserve index: ${i}`);

        const reserveAddress = await pool.getReserveAddress(BigInt(i));
        console.log(`Reserve address: ${reserveAddress.toString()}`);

        await sleep(1000);
        const configuration = await pool.getReserveConfiguration(reserveAddress);
        console.log(`Reserve poolWalletAddress: ${configuration.poolWalletAddress.toString()}`);
        console.log(`Reserve configuration: ${JSON.stringify(configuration)}`)

        await sleep(1000);
        const reserveData = await pool.getReserveData(reserveAddress);
        console.log(`Reserve data: ${JSON.stringify(reserveData)}`);
    }
}
