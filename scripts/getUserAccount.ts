import { Address } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { Pool } from '../build/Pool/tact_Pool';
import { UserAccount } from '../build/Pool/tact_UserAccount';

export async function run(provider: NetworkProvider, args: string[]) {
    const providerAddress = Address.parse(provider.sender().address?.toString() || '');
    const pool = provider.open(await Pool.fromInit());
    const poolAddress = pool.address;

    const userAccountContract = provider.open(await UserAccount.fromInit(poolAddress ,providerAddress));
    const userAccount = await userAccountContract.getAccount();
    console.log(`User Account Contract: ${userAccountContract.address.toString()}`);
    const { positionsLength, positions, positionsDetail } = userAccount;
    console.log(`User Account: ${providerAddress.toString()}`);
    console.log(`Positions Length: ${positionsLength}`);
    console.log(`Position: ${positions.get(0n)?.toString()}`);
    const positionDetail = positionsDetail.get(positions.get(0n)!!);
    console.log(`Supply: ${positionDetail?.supply.toString()}`);
    console.log(`Borrow: ${positionDetail?.borrow.toString()}`);
}
