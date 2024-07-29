import { Address, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';
import { UserAccount } from '../build/Pool/tact_UserAccount';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    const poolAddress = pool.address;
    const providerAddress = Address.parse(provider.sender().address?.toString() || '');

    const amount = toNano('0.1');
    await pool.send(
        provider.sender(),
        {
            value: toNano('0.35'),
        },
        {
            $$type: 'RepayTon',
            amount,
        },
    );

    const userAccountContract = await UserAccount.fromInit(poolAddress, providerAddress);

    await provider.waitForDeploy(userAccountContract.address);
}
