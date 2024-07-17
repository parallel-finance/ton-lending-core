import { address, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    console.log('Set oracle price...')
    const pool = provider.open(await Pool.fromInit());
    await sleep(2000);

    const masAddress = address('EQCP_v_hh0uTHIG_j6jpynQhazw3m1ZyEPR_aQMQTAsHMPxA');
    await pool.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'SetMockOraclePrice',
            asset: masAddress,
            price: toNano('1'),
        }
    );
    await sleep(2000);

    const samAddress = address('EQAFy5Wqx0HmUVQFcSTNpceFAVa8WikjyIUvWxdbqd0BsE6D');
    await pool.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'SetMockOraclePrice',
            asset: samAddress,
            price: toNano('1'),
        }
    );
    await sleep(2000);
}
