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

    await setMockPrice(provider, pool, 'EQBe9prUeNqHJHRw4YWDZhXI91kiGaGTTHuCWIaY975Uw2AU', toNano('2'));
    await setMockPrice(provider, pool, 'EQBvOgGXLdZOysRTnw2UDc_KRwcD5HLVH139DZ3AnK04LcxH', toNano('0.016'));
    await setMockPrice(provider, pool, 'EQD8-IT-fOEuBqY5bG_NY3lcZTKnnKv-7_UuILidV2eCa4W-', toNano('7.16'));
    await setMockPrice(provider, pool, 'EQColXOG7C2X8x0ZFT-3Ot5sYknz-JbLnJzI1eVNldQlX2Bu', toNano('1'));
    await setMockPrice(provider, pool, pool.address.toString(), toNano('6.58'));
}
