import { Address, address, beginCell, Cell, Slice, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { UserAccount } from '../build/Pool/tact_UserAccount';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    const poolAddress = pool.address;
    const providerAddress = Address.parse(provider.sender().address?.toString() || '');

    const amount = toNano("0.05");
    await pool.send(
        provider.sender(),
        {
            value: toNano('0.5'),
        },
        {
            $$type: 'BorrowTon',
            amount,
        },
    );

    const userAccountContract = provider.open(await UserAccount.fromInit(poolAddress ,providerAddress));
    let userAccount = await userAccountContract.getAccount();

    let i = 0;
    while (!userAccount.positionsDetail.get(poolAddress)?.borrow && i < 20) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log('Waiting for the user account to update...');
        userAccount = await userAccountContract.getAccount();
        i++;
    }

    console.log(`Supply Ton: ${amount.toString()} to Pool at ${pool.address.toString()}`);
}
