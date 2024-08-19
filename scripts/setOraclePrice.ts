import { address, OpenedContract, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { getAddressSeqno, waitNextSeqno } from './utils';
import { TESTNET_ADDRESS } from '../helpers/constant';

const setMockPrice = async (
    provider: NetworkProvider,
    pool: OpenedContract<Pool>,
    assetAddress: string,
    price: bigint,
) => {
    const asset = address(assetAddress);
    const beforeSeqno = await getAddressSeqno(provider.sender().address!!);
    console.log(`Before seqno: ${beforeSeqno}`);
    await pool.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'SetMockOraclePrice',
            asset,
            price,
        },
    );
    await waitNextSeqno(provider.sender().address!!, beforeSeqno);
};

export async function run(provider: NetworkProvider) {
    console.log('Set oracle price...');
    const pool = provider.open(Pool.fromAddress(address(TESTNET_ADDRESS.pool)));

    // MAS
    await setMockPrice(provider, pool, TESTNET_ADDRESS.MAS, toNano('2'));
    // pTon
    await setMockPrice(provider, pool, TESTNET_ADDRESS.pTON, toNano('7.16'));
    // NOT coin
    await setMockPrice(provider, pool, TESTNET_ADDRESS.NOT, toNano('0.013'));
    // USDT
    await setMockPrice(provider, pool, TESTNET_ADDRESS.USDT, toNano('1'));
    // TON
    await setMockPrice(provider, pool, pool.address.toString(), toNano('6.58'));
}
