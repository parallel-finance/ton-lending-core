import { toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { ACL } from '../helpers/constant';
import { waitNextSeqno } from './utils';
import { waitForTx } from '../helpers/address';

export async function run(provider: NetworkProvider) {
    console.log('Deploying pool...');
    const pool = provider.open(await Pool.fromInit());
    await sleep(2000);

    await pool.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Deploy',
            queryId: 0n,
        },
    );
    await sleep(2000);
    // latest: EQAQCgea8PVFW0jUIQvvGAZu9G-KsrO-Q3RO0R50Svg8tMXN
    await provider.waitForDeploy(pool.address);
    console.log(`Deployed at ${pool.address.toString()}`);

    await pool.send(
        provider.sender(),
        {
            value: toNano('0.1'),
        },
        {
            $$type: 'GrantRole',
            role: ACL.ASSET_LISTING_ADMIN_ROLE,
            admin: provider.sender().address!!,
        },
    );
    await waitForTx(provider, pool.address);
    console.log(
        `sender has the ASSET_LISTING_ADMIN_ROLE: `,
        await pool.getHasRole(ACL.ASSET_LISTING_ADMIN_ROLE, provider.sender().address!!),
    );
}
