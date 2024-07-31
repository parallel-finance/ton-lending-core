import { address, OpenedContract, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { getAddressSeqno, waitNextSeqno } from './utils';

const setMockPrice = async (
    provider: NetworkProvider,
    pool: OpenedContract<Pool>,
    assetAddress: string,
    price: bigint,
) => {
    const asset = address(assetAddress);
    const beforeSeqno = await getAddressSeqno(provider.sender().address!!);
    console.log(`Before seqno: ${beforeSeqno}`)
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
    await waitNextSeqno(provider.sender().address!!, beforeSeqno);
}

export async function run(provider: NetworkProvider) {
    console.log('Set oracle price...')
    const pool = provider.open(await Pool.fromInit());

    // MAS
    await setMockPrice(provider, pool, 'EQBe9prUeNqHJHRw4YWDZhXI91kiGaGTTHuCWIaY975Uw2AU', toNano('2'));
    // pTon
    await setMockPrice(provider, pool, 'EQBvOgGXLdZOysRTnw2UDc_KRwcD5HLVH139DZ3AnK04LcxH', toNano('7.16'));
    // NOT coin
    await setMockPrice(provider, pool, 'EQD8-IT-fOEuBqY5bG_NY3lcZTKnnKv-7_UuILidV2eCa4W-', toNano('0.013'));
    // USDT
    await setMockPrice(provider, pool, 'EQColXOG7C2X8x0ZFT-3Ot5sYknz-JbLnJzI1eVNldQlX2Bu', toNano('1'));
    // TON
    await setMockPrice(provider, pool, pool.address.toString(), toNano('6.58'));
}
