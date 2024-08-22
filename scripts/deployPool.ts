import { OpenedContract, Sender, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { ACL } from '../helpers/constant';
import { waitForTx } from '../helpers/address';

async function sendWithRetry(pool: OpenedContract<Pool>, sender: Sender, value: bigint, message: any, retries = 10, delay = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            await pool.send(sender, { value }, message);
            return;
        } catch (error: any) {
            if (error.response && error.response.status === 429) {
                console.log(`429 error encountered. Retrying in ${delay}ms...`);
                console.log(error.response.data);
                await sleep(delay);
            } else {
                throw error;
            }
        }
    }
    throw new Error('Max retries reached');
}

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    console.log(`[${provider.network()}] Deploying pool`)

    await sendWithRetry(
        pool,
        provider.sender(),
        toNano('0.05'),
        {
            $$type: 'Deploy',
            queryId: 0n,
        }
    );
    await sleep(2000);
    // latest: EQDlTidB1AZqnPwrtgYoai88pgr_rA1ATzB0pKke2cuQR2rI
    await provider.waitForDeploy(pool.address);
    console.log(`Deployed at ${pool.address.toString()}`);

    await sendWithRetry(
        pool,
        provider.sender(),
        toNano('0.1'),
        {
            $$type: 'GrantRole',
            role: ACL.ASSET_LISTING_ADMIN_ROLE,
            admin: provider.sender().address!!,
        }
    );
    await waitForTx(provider, pool.address);
    console.log(
        `sender has the ASSET_LISTING_ADMIN_ROLE: `,
        await pool.getHasRole(ACL.ASSET_LISTING_ADMIN_ROLE, provider.sender().address!!),
    );
}
