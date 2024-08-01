import { address, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';
import { getAddressSeqno, waitNextSeqno } from './utils';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    // USDT: decimal is 6
    const tokenAddress = address('EQColXOG7C2X8x0ZFT-3Ot5sYknz-JbLnJzI1eVNldQlX2Bu');
    const amount = 1000n * (10n ** 6n);
    const beforeSeqno = await getAddressSeqno(provider.sender().address!!);
    console.log(`Before seqno: ${beforeSeqno}`);
    await pool.send(
        provider.sender(),
        {
            value: toNano('0.25'),
        },
        {
            $$type: 'BorrowToken',
            tokenAddress,
            amount: amount,
        },
    );

    await waitNextSeqno(provider.sender().address!!, beforeSeqno);
}
