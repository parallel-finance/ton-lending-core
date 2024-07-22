import { address, OpenedContract, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';

const setMockPrice = async (
    provider: NetworkProvider,
    pool: OpenedContract<Pool>,
    assetAddress: string,
    price: bigint,
) => {
    await sleep(2000);
    const asset = address(assetAddress);
    await pool.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'SetMockOraclePrice',
            asset,
            price,
        }
    );
}

export async function run(provider: NetworkProvider) {
    console.log('Set oracle price...')
    const pool = provider.open(await Pool.fromInit());

    await setMockPrice(provider, pool, 'EQCP_v_hh0uTHIG_j6jpynQhazw3m1ZyEPR_aQMQTAsHMPxA', toNano('2'));
    await setMockPrice(provider, pool, 'EQBqFJkn_DoBFcNPQ0ble53CD92X_XsDgPr1_WAajYceJMHi', toNano('0.016'));
    await setMockPrice(provider, pool, 'EQBdMo5ZwwVWhBMMSNbU9oNe3L5B8GBhl14OD8aR9am2lv2-', toNano('7.16'));
    await setMockPrice(provider, pool, 'EQAXwaSn8OPKA08QgSBPVGvP5n_stP9PhuRvynayN-pnjKXb', toNano('1'));
}
